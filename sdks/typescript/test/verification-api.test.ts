import { randomUUID } from 'node:crypto';
import { decodeJwt, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { IdentityVerifier } from '../src/identity-verification.js';
import { createIdentityVerificationHandler, verifyIdentityRemote } from '../src/verification-api.js';

async function setup() {
  const now = Math.floor(Date.now() / 1000);
  const root = 'did:oas:openagent:hmr:owner';
  const did = 'did:oas:openagent:agent:worker';
  const audience = 'https://verification.example';
  const nonce = randomUUID();
  const rootKeys = await generateKeyPair('EdDSA');
  const agentKeys = await generateKeyPair('EdDSA');
  const rootJwk = await exportJWK(rootKeys.publicKey);
  const agentJwk = await exportJWK(agentKeys.publicKey);
  let revoked = false;
  let consumed = false;
  const verifier = new IdentityVerifier({
    async resolveDid(id) {
      const jwk = id === root ? rootJwk : id === did ? agentJwk : null;
      return jwk ? { did: id, verificationMethods: [{ id: `${id}#signing`, publicKeyJwk: jwk }] } : null;
    },
    async authorizeOwner(id) { return id === root ? { issuer: 'https://auth.life.one', subject: 'authorized-person' } : null; },
    async checkRevocation() { return { revoked, checkedAt: Math.floor(Date.now() / 1000) }; },
    replay: { async consume() { if (consumed) return false; consumed = true; return true; } },
  });
  const delegation = await new SignJWT({ iss: root, sub: did, aud: audience, iat: now - 1, nbf: now - 1,
    exp: now + 180, jti: randomUUID() }).setProtectedHeader({ alg: 'EdDSA', kid: `${root}#signing`, typ: 'oaid-delegation+jwt' })
    .sign(rootKeys.privateKey);
  const token = await new SignJWT({ iss: did, sub: did, aud: audience, iat: now, nbf: now,
    exp: now + 120, jti: randomUUID(), kind: 'agent', nonce })
    .setProtectedHeader({ alg: 'EdDSA', kid: `${did}#signing`, typ: 'oaid-proof+jwt' }).sign(agentKeys.privateKey);
  const proof = { token, delegations: [delegation] };
  const handler = createIdentityVerificationHandler(verifier, {
    audience,
    async resolveNonce(request) {
      if (request.headers.get('x-openagent-nonce') !== nonce) throw new Error('Unknown issued challenge');
      return nonce;
    },
  });
  const request = () => new Request(`${audience}/v1/identity/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-openagent-nonce': nonce }, body: JSON.stringify({ proof }),
  });
  return { did, root, audience, nonce, proof, handler, request, verifier, revoke: () => { revoked = true; } };
}

describe('WHATWG identity verification endpoint', () => {
  it('returns a real signed identity verdict with no-store and refuses reuse', async () => {
    const f = await setup();
    const response = await f.handler(f.request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const { identity } = await response.json();
    expect(identity.did).toBe(f.did);
    expect(identity.lineage).toEqual([f.root, f.did]);
    const replay = await f.handler(f.request());
    expect(replay.status).toBe(401);
    expect(await replay.json()).toEqual({ error: 'replayed' });
  });

  it('rejects revoked identity and unissued challenge without leaking internal errors', async () => {
    const f = await setup();
    f.revoke();
    const revoked = await f.handler(f.request());
    expect(revoked.status).toBe(401);
    expect(await revoked.json()).toEqual({ error: 'revoked' });
    const unknown = f.request();
    unknown.headers.set('x-openagent-nonce', 'attacker-selected');
    const refused = await f.handler(unknown);
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ error: 'authority_unavailable' });
  });

  it('requires POST JSON, bounds bytes and rejects request-selected trust options', async () => {
    const f = await setup();
    const get = await f.handler(new Request(`${f.audience}/v1/identity/verify`));
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    expect((await f.handler(new Request(f.audience, { method: 'POST', body: 'plain' }))).status).toBe(415);
    const handler = createIdentityVerificationHandler(f.verifier,
      { audience: f.audience, resolveNonce: async () => f.nonce, maxBodyBytes: 16 });
    expect((await handler(f.request())).status).toBe(413);
    const malicious = new Request(f.audience, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proof: f.proof, audience: 'https://attacker.example', owner: { subject: 'attacker' } }) });
    expect((await f.handler(malicious)).status).toBe(400);
  });
});

describe('remote identity verification SDK', () => {
  it('calls the real verifier through its HTTP handler with redirects and ambient cookies disabled', async () => {
    const f = await setup();
    const transport: typeof fetch = async (input, init) => {
      expect(init?.redirect).toBe('error');
      expect(init?.credentials).toBe('omit');
      return f.handler(new Request(input, init));
    };
    const identity = await verifyIdentityRemote(`${f.audience}/v1/identity/verify`, f.proof,
      { nonce: f.nonce, fetch: transport });
    expect(identity.did).toBe(f.did);
    expect(identity.owner.subject).toBe('authorized-person');
  });

  it('fails closed on a remote revocation verdict', async () => {
    const f = await setup();
    f.revoke();
    const transport: typeof fetch = async (input, init) => f.handler(new Request(input, init));
    await expect(verifyIdentityRemote(`${f.audience}/v1/identity/verify`, f.proof,
      { nonce: f.nonce, fetch: transport })).rejects.toMatchObject({ code: 'invalid_proof' });
  });

  it('rejects malformed successful verdicts instead of treating HTTP 200 as authentication', async () => {
    const f = await setup();
    const transport: typeof fetch = async (input, init) => {
      const result = await f.handler(new Request(input, init));
      const body = await result.json();
      body.identity.lineage = [f.root, 'did:oas:openagent:agent:other'];
      return Response.json(body);
    };
    await expect(verifyIdentityRemote(`${f.audience}/v1/identity/verify`, f.proof,
      { nonce: f.nonce, fetch: transport })).rejects.toMatchObject({ code: 'authority_unavailable' });
  });

  it('refuses a valid-shaped verdict for another agent despite a successful authority response', async () => {
    const f = await setup();
    const transport: typeof fetch = async (input, init) => {
      const result = await f.handler(new Request(input, init));
      expect(result.status).toBe(200);
      const body = await result.json();
      body.identity.did = 'did:oas:openagent:agent:other';
      body.identity.lineage[body.identity.lineage.length - 1] = body.identity.did;
      return Response.json(body);
    };
    await expect(verifyIdentityRemote(`${f.audience}/v1/identity/verify`, f.proof,
      { nonce: f.nonce, fetch: transport })).rejects.toMatchObject({ code: 'authority_unavailable' });
  });

  it('refuses a successful verdict that extends the submitted possession lifetime', async () => {
    const f = await setup();
    const transport: typeof fetch = async (input, init) => {
      const result = await f.handler(new Request(input, init));
      expect(result.status).toBe(200);
      const body = await result.json();
      body.identity.expiresAt = decodeJwt(f.proof.token).exp! + 1;
      return Response.json(body);
    };
    await expect(verifyIdentityRemote(`${f.audience}/v1/identity/verify`, f.proof,
      { nonce: f.nonce, fetch: transport })).rejects.toMatchObject({ code: 'authority_unavailable' });
  });

  it('refuses reuse under a different nonce before a stale successful verdict can be accepted', async () => {
    const f = await setup();
    const response = await f.handler(f.request());
    expect(response.status).toBe(200);
    const verdict = await response.json();
    let calls = 0;
    const transport: typeof fetch = async () => { calls++; return Response.json(verdict); };
    await expect(verifyIdentityRemote(`${f.audience}/v1/identity/verify`, f.proof,
      { nonce: randomUUID(), fetch: transport })).rejects.toMatchObject({ code: 'invalid_proof' });
    expect(calls).toBe(0);
  });

  it('bounds and validates source proof envelopes before sending them to the authority', async () => {
    const f = await setup();
    let calls = 0;
    const transport: typeof fetch = async () => { calls++; throw new Error('Invalid proof was sent'); };
    for (const proof of [
      null, [], {}, { token: 'not-a-jwt', delegations: [f.proof.delegations[0]] },
      { ...f.proof, delegations: [] }, { ...f.proof, delegations: Array(17).fill(f.proof.delegations[0]) },
      { ...f.proof, delegations: [null] }, { ...f.proof, token: 'a'.repeat(32_769) },
    ]) {
      await expect(verifyIdentityRemote(`${f.audience}/v1/identity/verify`, proof as unknown as typeof f.proof,
        { nonce: f.nonce, fetch: transport })).rejects.toMatchObject({ code: 'invalid_proof' });
    }
    expect(calls).toBe(0);
  });

  it('refuses non-HTTPS authority URLs before sending the proof', async () => {
    const f = await setup();
    await expect(verifyIdentityRemote('http://verification.example/verify', f.proof,
      { nonce: f.nonce })).rejects.toBeInstanceOf(TypeError);
    await expect(verifyIdentityRemote('https://user:password@verification.example/verify', f.proof,
      { nonce: f.nonce })).rejects.toBeInstanceOf(TypeError);
  });
});
