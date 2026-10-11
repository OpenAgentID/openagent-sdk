import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT, type KeyLike } from 'jose';
import type { Adapter, AdapterPayload } from 'oidc-provider';
import { createAgentOidcProvider, type AgentOidcProvider, type AgentOidcProviderOptions } from '../src/provider.js';
import type { AgentIdentityProof, AgentOwner, VerifiedAgentIdentity } from '../src/identity-types.js';

/** Disposable test storage implements the complete provider adapter contract. */
function testStorage() {
  const records = new Map<string, { payload: AdapterPayload; expires: number }>();
  return class implements Adapter {
    constructor(private readonly model: string) {}
    private key(id: string) { return `${this.model}:${id}`; }
    async upsert(id: string, payload: AdapterPayload, expiresIn = 3600) {
      records.set(this.key(id), { payload: structuredClone(payload), expires: Date.now() + expiresIn * 1000 });
    }
    async find(id: string) {
      const record = records.get(this.key(id));
      if (!record || record.expires <= Date.now()) return undefined;
      return structuredClone(record.payload);
    }
    async findByUid(uid: string) {
      for (const [key, record] of records) if (key.startsWith(`${this.model}:`) && record.payload.uid === uid) {
        return this.find(key.slice(this.model.length + 1));
      }
      return undefined;
    }
    async findByUserCode(userCode: string) {
      for (const [key, record] of records) if (key.startsWith(`${this.model}:`) && record.payload.userCode === userCode) {
        return this.find(key.slice(this.model.length + 1));
      }
      return undefined;
    }
    async consume(id: string) {
      const record = records.get(this.key(id));
      if (record) record.payload.consumed = Math.floor(Date.now() / 1000);
    }
    async destroy(id: string) { records.delete(this.key(id)); }
    async revokeByGrantId(grantId: string) {
      for (const [key, record] of records) if (record.payload.grantId === grantId) records.delete(key);
    }
  };
}

class Browser {
  private readonly cookies = new Map<string, string>();
  async fetch(url: string, init: RequestInit = {}) {
    const response = await fetch(url, {
      ...init, redirect: 'manual', headers: {
        ...Object.fromEntries(new Headers(init.headers)),
        Cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      },
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator), value = pair.slice(separator + 1);
      if (value) this.cookies.set(name, value); else this.cookies.delete(name);
    }
    return response;
  }
}

let rsa: { privateKey: KeyLike; publicKey: KeyLike };
let ed: { privateKey: KeyLike; publicKey: KeyLike };
const servers: Server[] = [];

beforeAll(async () => {
  rsa = await generateKeyPair('RS256');
  ed = await generateKeyPair('EdDSA');
});
afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
});

async function listen(server: Server) {
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP test server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

async function fixture(kind: 'agent' | 'agent:instance' = 'agent') {
  let provider: AgentOidcProvider;
  let callbackQuery: URLSearchParams | undefined;
  const rpOrigin = await listen(createServer((req, res) => {
    callbackQuery = new URL(req.url!, 'http://127.0.0.1').searchParams;
    res.end('OIDC callback received');
  }));
  const signingJwk = { ...await exportJWK(rsa.privateKey), kid: 'provider-rsa', alg: 'RS256', use: 'sig' };
  const ownerJwk = { ...await exportJWK(rsa.publicKey), kid: 'owner-rsa', alg: 'RS256', use: 'sig' };
  const issuer = await listen(createServer((req, res) => {
    void (async () => {
      if (req.url === '/owner/jwks') {
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [ownerJwk] })); return;
      }
      if (req.url?.startsWith('/interaction/')) {
        if (req.method === 'GET') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(await provider.interaction(req, res))); return;
        }
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 128 * 1024) throw new Error('Interaction request too large');
        }
        await provider.completeInteraction(req, res, JSON.parse(body)); return;
      }
      provider.callback()(req, res);
    })().catch(() => { res.statusCode = 403; res.end(JSON.stringify({ error: 'access_denied' })); });
  }));
  const publicJwk = await exportJWK(ed.publicKey);
  const did = `did:oas:openagent:${kind}:${publicJwk.x}`;
  const rootDid = `did:oas:openagent:hmr:${createHash('sha256').update(ownerJwk.n!).digest('hex')}`;
  const owner: AgentOwner = { issuer, subject: randomBytes(16).toString('hex'), organizationId: randomBytes(16).toString('hex') };
  const consumed = new Set<string>();
  let revoked = false;
  let currentOwner = owner;
  const delegation = await new SignJWT({ owner })
    .setProtectedHeader({ alg: 'RS256', kid: 'owner-rsa' }).setIssuer(rootDid).setSubject(did)
    .setAudience(issuer).setIssuedAt().setExpirationTime('5m').sign(rsa.privateKey);
  const resolveIdentity = async (requestedDid: string): Promise<VerifiedAgentIdentity> => {
    if (revoked || requestedDid !== did) throw new Error('Agent identity is revoked or unknown');
    const { payload } = await jwtVerify(delegation, rsa.publicKey, { issuer: rootDid, subject: did, audience: issuer, algorithms: ['RS256'] });
    if (JSON.stringify(payload.owner) !== JSON.stringify(currentOwner)) throw new Error('Owner authority no longer matches');
    return { did, owner: currentOwner, lineage: [rootDid, did], expiresAt: payload.exp! };
  };
  const options: AgentOidcProviderOptions = {
    issuer, mode: 'test', persistent: false, adapter: testStorage(),
    clients: [{ client_id: 'registered-rp', redirect_uris: [`${rpOrigin}/callback`], token_endpoint_auth_method: 'none' }],
    cookieKeys: [randomBytes(32).toString('base64url')], jwks: { keys: [signingJwk] },
    lifeId: { issuer, audience: 'owner-federation', jwksUri: `${issuer}/owner/jwks`, test: true }, requireLifeId: true,
    resolveIdentity,
    async verifyAgent(proof, context) {
      if (proof.delegations.length !== 1 || proof.delegations[0] !== delegation) throw new Error('Unknown owner chain');
      const { payload } = await jwtVerify(proof.token, ed.publicKey, {
        issuer: did, subject: did, audience: context.audience, algorithms: ['EdDSA'], requiredClaims: ['jti', 'exp'],
      });
      if (payload.nonce !== context.nonce || consumed.has(payload.jti!)) throw new Error('Invalid or replayed possession');
      const identity = await resolveIdentity(did);
      consumed.add(payload.jti!);
      return { ...identity, expiresAt: Math.min(identity.expiresAt, payload.exp!) };
    },
  };
  provider = await createAgentOidcProvider(options);
  const humanToken = (subject = owner.subject, audience = 'owner-federation', key = rsa.privateKey) => new SignJWT({
    kind: 'human', organization_id: owner.organizationId,
  }).setProtectedHeader({ alg: 'RS256', kid: 'owner-rsa' }).setIssuer(issuer).setSubject(subject)
    .setAudience(audience).setIssuedAt().setExpirationTime('5m').sign(key);
  const proof = async (nonce: string, audience = issuer): Promise<AgentIdentityProof> => ({
    token: await new SignJWT({ nonce }).setProtectedHeader({ alg: 'EdDSA', kid: 'agent-ed25519' })
      .setIssuer(did).setSubject(did).setAudience(audience).setJti(randomBytes(16).toString('hex'))
      .setIssuedAt().setExpirationTime('5m').sign(ed.privateKey), delegations: [delegation],
  });
  return {
    provider, issuer, rpOrigin, options, owner, did, humanToken, proof,
    revoke: () => { revoked = true; }, changeOwner: () => { currentOwner = { ...owner, subject: randomBytes(16).toString('hex') }; },
    callbackQuery: () => callbackQuery,
  };
}

async function authorize(f: Awaited<ReturnType<typeof fixture>>, settings: { proofAudience?: string; humanSubject?: string; humanAudience?: string } = {}) {
  const browser = new Browser();
  const verifier = randomBytes(32).toString('base64url');
  const nonce = randomBytes(16).toString('hex'), state = randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_id: 'registered-rp', redirect_uri: `${f.rpOrigin}/callback`, response_type: 'code', scope: 'openid profile',
    nonce, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  });
  const start = await browser.fetch(`${f.issuer}/authorize?${params}`);
  expect(start.status).toBe(303);
  const interactionUrl = new URL(start.headers.get('location')!, f.issuer).href;
  const interaction = await (await browser.fetch(interactionUrl)).json();
  const completion = await browser.fetch(interactionUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ proof: await f.proof(interaction.nonce, settings.proofAudience), consent: true,
      lifeIdToken: await f.humanToken(settings.humanSubject, settings.humanAudience) }),
  });
  if (completion.status !== 303) return { completion, browser, verifier, nonce, state, code: undefined };
  const resumed = await browser.fetch(new URL(completion.headers.get('location')!, f.issuer).href);
  expect([302, 303]).toContain(resumed.status);
  const callback = new URL(resumed.headers.get('location')!, f.issuer);
  expect(callback.origin).toBe(f.rpOrigin);
  await fetch(callback);
  expect(f.callbackQuery()?.get('state')).toBe(state);
  const code = f.callbackQuery()?.get('code')!;
  expect(code).toBeTruthy();
  return { completion, browser, verifier, nonce, state, code };
}

function redeem(f: Awaited<ReturnType<typeof fixture>>, code: string, verifier: string) {
  return fetch(`${f.issuer}/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'registered-rp',
      redirect_uri: `${f.rpOrigin}/callback`, code, code_verifier: verifier }),
  });
}

describe('agent OIDC provider over HTTP', () => {
  it.each(['agent', 'agent:instance'] as const)('serves discovery/public JWKS and completes an ordinary RP code/PKCE/UserInfo flow for %s', async (kind) => {
    const f = await fixture(kind);
    const discovery = await (await fetch(`${f.issuer}/.well-known/openid-configuration`)).json();
    expect(discovery.issuer).toBe(f.issuer);
    expect(discovery.code_challenge_methods_supported).toEqual(['S256']);
    const jwks = await (await fetch(discovery.jwks_uri)).json();
    expect(jwks.keys).toHaveLength(1); expect(jwks.keys[0].d).toBeUndefined();
    const flow = await authorize(f);
    const response = await redeem(f, flow.code!, flow.verifier);
    expect(response.status).toBe(200);
    const tokens = await response.json();
    const { payload } = await jwtVerify(tokens.id_token, createLocalJWKSet(jwks), {
      issuer: f.issuer, audience: 'registered-rp', algorithms: ['RS256'],
    });
    expect(payload.sub).toBe(f.did); expect(payload.nonce).toBe(flow.nonce); expect(payload.kind).toBe('agent');
    const userinfo = await fetch(discovery.userinfo_endpoint, { headers: { authorization: `Bearer ${tokens.access_token}` } });
    expect(userinfo.status).toBe(200);
    expect((await userinfo.json()).owner).toEqual(f.owner);
    f.revoke();
    const revoked = await fetch(discovery.userinfo_endpoint, { headers: { authorization: `Bearer ${tokens.access_token}` } });
    expect(revoked.status).toBe(401);
  });

  it('rejects wrong PKCE, allows the right verifier, then rejects authorization code replay', async () => {
    const f = await fixture(), flow = await authorize(f);
    const wrong = await redeem(f, flow.code!, randomBytes(32).toString('base64url'));
    expect(wrong.status).toBe(400); expect((await wrong.json()).error).toBe('invalid_grant');
    expect((await redeem(f, flow.code!, flow.verifier)).status).toBe(200);
    const replay = await redeem(f, flow.code!, flow.verifier);
    expect(replay.status).toBe(400); expect((await replay.json()).error).toBe('invalid_grant');
  });

  it('rejects a signed possession proof for the wrong audience', async () => {
    const f = await fixture(), flow = await authorize(f, { proofAudience: 'https://unrelated-rp.example' });
    expect(flow.completion.status).toBe(403); expect(flow.code).toBeUndefined();
  });

  it('rejects a valid LifeID token belonging to a different human', async () => {
    const f = await fixture(), flow = await authorize(f, { humanSubject: randomBytes(16).toString('hex') });
    expect(flow.completion.status).toBe(403);
  });

  it('rejects a LifeID assertion for the wrong federation audience', async () => {
    const f = await fixture(), flow = await authorize(f, { humanAudience: 'different-client' });
    expect(flow.completion.status).toBe(403);
  });

  it('rechecks revocation between authorization and code redemption', async () => {
    const f = await fixture(), flow = await authorize(f); f.revoke();
    const response = await redeem(f, flow.code!, flow.verifier);
    expect(response.status).toBe(400); expect((await response.json()).error).toBe('invalid_grant');
  });

  it('refuses an ownership change before code redemption', async () => {
    const f = await fixture(), flow = await authorize(f); f.changeOwner();
    expect((await redeem(f, flow.code!, flow.verifier)).status).toBe(400);
  });

  it('requires production persistence, real private signing keys and cookie keys', async () => {
    const f = await fixture();
    await expect(createAgentOidcProvider({ ...f.options, mode: 'production', issuer: 'https://identity.example' })).rejects.toThrow('persistent');
    await expect(createAgentOidcProvider({ ...f.options, cookieKeys: [] })).rejects.toThrow('cookie');
    await expect(createAgentOidcProvider({ ...f.options, jwks: { keys: [await exportJWK(rsa.publicKey)] } })).rejects.toThrow('Private');
  });
});
