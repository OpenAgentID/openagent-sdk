import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { encode } from 'cborg';
import { act_verify } from '@openagentid/crypto-wasm';
import express from 'express';
import { act, setActCryptoBinding } from '../src/act.js';
import { requireActExpress, withAct } from '../src/middleware.js';

// Real generated signatures and the published 0.1.1 verifier. The SDK must
// also work with the already-installed WASM release, without a clock adapter.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const key = new Uint8Array(Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url'));
const policy = { issuer: 'urn:example:compatibility', audience: 'urn:example:receiver',
  trustedKeys: [key], scopes: ['docs:page:read'] };
const subject = 'did:oas:example:agent:compatibility';
function mint(changes: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { jti: randomUUID(), sub: subject, iss: policy.issuer, aud: policy.audience,
    iat: now, nbf: now, exp: now + 60, tenant_id: 'local-example', scope: policy.scopes, ...changes };
  const bytes = encode(claims);
  return encode({ v: 1, alg: 'Ed25519', claims: bytes,
    sig: new Uint8Array(sign(null, bytes, privateKey)) });
}
function verifier(token: Uint8Array) {
  return act.verify(token).trustedKeys([key]).issuer(policy.issuer)
    .forAudience(policy.audience).requireScopes(policy.scopes);
}
const authorization = (token: Uint8Array) => `Bearer ${Buffer.from(token).toString('base64url')}`;

describe('published WASM with real signatures', () => {
  beforeEach(() => setActCryptoBinding({ act_verify }));
  afterEach(() => vi.restoreAllMocks());

  it('verifies using the default receiver clock', async () => {
    expect((await verifier(mint()).run()).sub).toBe(subject);
  });

  it('resolves a fresh clock when reusing a fluent verifier', async () => {
    const initial = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(initial);
    const reusable = verifier(mint());
    await expect(reusable.run()).resolves.toHaveProperty('sub', subject);
    clock.mockReturnValue(initial + 120_000);
    await expect(reusable.run()).rejects.toThrow(/expired/);
  });

  it('rejects signed expiry, not-before, issuer, audience and scope violations', async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const [changes, reason] of [
      [{ iat: now - 120, nbf: now - 120, exp: now - 60 }, /expired/],
      [{ nbf: now + 30 }, /not valid until/i],
      [{ iss: 'urn:example:other' }, /issuer/],
      [{ aud: 'urn:example:other' }, /audience/],
      [{ scope: ['docs:page:other'] }, /scope/],
    ] as const) await expect(verifier(mint(changes)).run()).rejects.toThrow(reason);
  });

  it('rejects a valid signature from a different key and altered signed bytes', async () => {
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' });
    await expect(verifier(mint()).trustedKeys([Buffer.from(other.x!, 'base64url')]).run())
      .rejects.toThrow(/signature/);
    const token = mint();
    token[token.length - 1] ^= 1;
    await expect(verifier(token).run()).rejects.toThrow();
  });

  it('rejects invalid host clock and leeway options before verification', async () => {
    for (const time of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(verifier(mint()).atTime(time).run()).rejects.toThrow(/safe integer/);
      await expect(verifier(mint()).withLeeway(time).run()).rejects.toThrow(/safe integer/);
    }
  });

  it('Fetch middleware preserves the body and reevaluates expiry on each request', async () => {
    const initial = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(initial);
    const token = mint();
    let calls = 0;
    const handler = withAct(policy, async (req, claims) => {
      calls++;
      return Response.json({ subject: claims.sub, body: await req.text() });
    });
    const request = () => new Request('https://example.invalid/tool', {
      method: 'POST', headers: { authorization: authorization(token) }, body: 'actual request body',
    });
    const accepted = await handler(request());
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ subject, body: 'actual request body' });
    clock.mockReturnValue(initial + 120_000);
    expect((await handler(request())).status).toBe(401);
    expect(calls).toBe(1);
  });

  it('does not authorize a signed proof-of-possession token as an unbound bearer', async () => {
    const token = mint({ cnf: { key_fingerprint: 'a'.repeat(64), alg: 'Ed25519' } });
    // The token's signature is valid; authorization still needs the bound proof.
    expect((await verifier(token).run()).cnf).toBeDefined();
    let invoked = false;
    const handler = withAct(policy, () => { invoked = true; return new Response('must not run'); });
    const response = await handler(new Request('https://example.invalid/tool', {
      headers: { authorization: authorization(token) },
    }));
    expect(response.status).toBe(401);
    expect(invoked).toBe(false);
  });

  it('Express middleware verifies a real HTTP request and blocks an expired token', async () => {
    const app = express();
    app.use(requireActExpress(policy));
    app.use(express.json());
    app.post('/tool', (req, res) => res.json({ subject: req.actClaims.sub, input: req.body }));
    const server = createServer(app).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP port');
    try {
      const send = (token: Uint8Array) => fetch(`http://127.0.0.1:${address.port}/tool`, {
        method: 'POST', headers: { authorization: authorization(token), 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'real request' }),
      });
      const accepted = await send(mint());
      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toEqual({ subject, input: { message: 'real request' } });
      const now = Math.floor(Date.now() / 1000);
      const expired = await send(mint({ iat: now - 120, nbf: now - 120, exp: now - 60 }));
      expect(expired.status).toBe(401);
      expect((await expired.json()).error).toContain('expired');
      const bound = await send(mint({ cnf: { key_fingerprint: 'a'.repeat(64), alg: 'Ed25519' } }));
      expect(bound.status).toBe(401);
      expect((await bound.json()).error).toContain('bound proof');
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
