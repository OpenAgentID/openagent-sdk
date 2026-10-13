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

interface AuthorizationFixture {
  issuer: string;
  rpOrigin: string;
  proof: (nonce: string, audience?: string) => Promise<AgentIdentityProof>;
  humanToken?: (subject?: string, audience?: string) => Promise<string>;
  callbackQuery: () => URLSearchParams | undefined;
}

async function authorize(f: AuthorizationFixture, settings: {
  proofAudience?: string; humanSubject?: string; humanAudience?: string; lifeIdToken?: string; omitLifeId?: boolean;
} = {}) {
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
  const lifeIdToken = settings.lifeIdToken ?? (f.humanToken && !settings.omitLifeId
    ? await f.humanToken(settings.humanSubject, settings.humanAudience) : undefined);
  const completion = await browser.fetch(interactionUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ proof: await f.proof(interaction.nonce, settings.proofAudience), consent: true,
      ...(lifeIdToken !== undefined ? { lifeIdToken } : {}) }),
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

function redeem(f: Pick<AuthorizationFixture, 'issuer' | 'rpOrigin'>, code: string, verifier: string) {
  return fetch(`${f.issuer}/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'registered-rp',
      redirect_uri: `${f.rpOrigin}/callback`, code, code_verifier: verifier }),
  });
}

/** The server's authoritative policy record and every possession/delegation use real signing keys. */
async function selfFixture(settings: { descendant?: boolean; legacy?: boolean; allowSelfRooted?: boolean; standalone?: boolean } = {}) {
  let provider: AgentOidcProvider;
  let callbackQuery: URLSearchParams | undefined;
  let federationRequests = 0;
  const rpOrigin = await listen(createServer((req, res) => {
    callbackQuery = new URL(req.url!, 'http://127.0.0.1').searchParams;
    res.end('OIDC callback received');
  }));
  const ownerJwk = { ...await exportJWK(rsa.publicKey), kid: 'policy-rsa', alg: 'RS256', use: 'sig' };
  const issuer = await listen(createServer((req, res) => {
    void (async () => {
      if (req.url === '/owner/jwks') {
        federationRequests += 1;
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
  let rootKeys = await generateKeyPair('EdDSA');
  const leafKeys = settings.descendant ? await generateKeyPair('EdDSA') : rootKeys;
  const prefix = settings.legacy ? 'did:l1fe' : 'did:oas:openagent';
  let rootDid = `${prefix}:agent:${(await exportJWK(rootKeys.publicKey)).x}`;
  const did = settings.descendant
    ? `${prefix}:agent:instance:${(await exportJWK(leafKeys.publicKey)).x}` : rootDid;
  const ownedRootDid = `did:oas:openagent:hmr:${createHash('sha256').update(ownerJwk.n!).digest('hex')}`;
  const owner: AgentOwner = { issuer, subject: randomBytes(16).toString('hex') };
  let authorizationId = randomBytes(16).toString('hex');
  let revision = randomBytes(16).toString('hex');
  let authorized = true, revoked = false, owned = false, changeDuringLogin = false;
  const consumed = new Set<string>();
  const policyRecord = () => new SignJWT({ rootDid, authorizationId, revision })
    .setProtectedHeader({ alg: 'RS256', kid: 'policy-rsa' }).setIssuer(issuer).setSubject(rootDid)
    .setAudience(issuer).setIssuedAt().setExpirationTime('5m').sign(rsa.privateKey);
  let policyToken = await policyRecord();
  const signDelegation = () => new SignJWT({})
    .setProtectedHeader({ alg: 'EdDSA', kid: `${rootDid}#signing`, typ: 'oaid-delegation+jwt' })
    .setIssuer(rootDid).setSubject(did).setAudience(issuer).setJti(randomBytes(16).toString('hex'))
    .setIssuedAt().setNotBefore('0s').setExpirationTime('5m').sign(rootKeys.privateKey);
  let delegation = settings.descendant ? await signDelegation() : undefined;
  const ownedDelegation = await new SignJWT({ owner })
    .setProtectedHeader({ alg: 'RS256', kid: 'policy-rsa', typ: 'oaid-delegation+jwt' })
    .setIssuer(ownedRootDid).setSubject(did).setAudience(issuer).setIssuedAt().setExpirationTime('5m').sign(rsa.privateKey);
  const resolveIdentity = async (requestedDid: string): Promise<VerifiedAgentIdentity> => {
    if (requestedDid !== did || revoked) throw new Error('Unknown or revoked agent/root');
    if (owned) {
      const { payload } = await jwtVerify(ownedDelegation, rsa.publicKey, {
        issuer: ownedRootDid, subject: did, audience: issuer, algorithms: ['RS256'],
      });
      if (JSON.stringify(payload.owner) !== JSON.stringify(owner)) throw new Error('Unapproved owner');
      return { did, owner, root: { kind: 'lifeid', did: ownedRootDid }, lineage: [ownedRootDid, did], expiresAt: payload.exp! };
    }
    if (!authorized) throw new Error('Current self-root policy was withdrawn');
    const { payload: policy } = await jwtVerify(policyToken, rsa.publicKey, {
      issuer, subject: rootDid, audience: issuer, algorithms: ['RS256'], requiredClaims: ['exp', 'iat'],
    });
    if (policy.rootDid !== rootDid || policy.authorizationId !== authorizationId || policy.revision !== revision) {
      throw new Error('Current policy record does not authorize this root');
    }
    let expiresAt = policy.exp!;
    if (delegation) {
      const { payload } = await jwtVerify(delegation, rootKeys.publicKey, {
        issuer: rootDid, subject: did, audience: issuer, algorithms: ['EdDSA'],
      });
      expiresAt = Math.min(expiresAt, payload.exp!);
    } else if (did !== rootDid) throw new Error('Self-root descendant has no signed delegation');
    return { did, owner: null, root: { kind: 'self', did: rootDid, authorizationId, revision },
      lineage: delegation ? [rootDid, did] : [rootDid], expiresAt };
  };
  const options: AgentOidcProviderOptions = {
    issuer, mode: 'test', persistent: false, adapter: testStorage(),
    clients: [{ client_id: 'registered-rp', redirect_uris: [`${rpOrigin}/callback`],
      token_endpoint_auth_method: 'none', id_token_signed_response_alg: 'EdDSA' }],
    cookieKeys: [randomBytes(32).toString('base64url')],
    jwks: { keys: [{ ...await exportJWK(ed.privateKey), kid: 'self-provider-ed25519', alg: 'EdDSA', use: 'sig' }] },
    // Standalone self-hosting configures no LifeID federation at all.
    ...(settings.standalone ? {} : { lifeId: { issuer, audience: 'owner-federation', jwksUri: `${issuer}/owner/jwks`, test: true }, requireLifeId: true }),
    ...(settings.allowSelfRooted === false ? {} : { allowSelfRooted: true }), resolveIdentity,
    async verifyAgent(proof, context) {
      const expectedDelegations = owned ? [ownedDelegation] : delegation ? [delegation] : [];
      if (proof.delegations.length !== expectedDelegations.length
        || proof.delegations.some((value, index) => value !== expectedDelegations[index])) throw new Error('Unapproved signed chain');
      const { payload } = await jwtVerify(proof.token, leafKeys.publicKey, {
        issuer: did, subject: did, audience: context.audience, algorithms: ['EdDSA'], requiredClaims: ['exp', 'jti'],
      });
      if (payload.nonce !== context.nonce || consumed.has(payload.jti!)) throw new Error('Wrong or replayed proof');
      const identity = await resolveIdentity(did);
      consumed.add(payload.jti!);
      if (changeDuringLogin) {
        revision = randomBytes(16).toString('hex'); policyToken = await policyRecord();
      }
      return { ...identity, expiresAt: Math.min(identity.expiresAt, payload.exp!) };
    },
  };
  provider = await createAgentOidcProvider(options);
  return {
    issuer, rpOrigin, options, did, provider, callbackQuery: () => callbackQuery,
    federationRequests: () => federationRequests,
    identity: () => resolveIdentity(did),
    proof: async (nonce: string, audience = issuer): Promise<AgentIdentityProof> => ({
      token: await new SignJWT({ nonce }).setProtectedHeader({ alg: 'EdDSA', kid: `${did}#signing`, typ: 'oaid-proof+jwt' })
        .setIssuer(did).setSubject(did).setAudience(audience).setJti(randomBytes(16).toString('hex'))
        .setIssuedAt().setExpirationTime('5m').sign(leafKeys.privateKey),
      delegations: owned ? [ownedDelegation] : delegation ? [delegation] : [],
    }),
    ownerAssertion: () => new SignJWT({ kind: 'human' })
      .setProtectedHeader({ alg: 'RS256', kid: 'policy-rsa' }).setIssuer(issuer).setSubject(owner.subject)
      .setAudience('owner-federation').setIssuedAt().setExpirationTime('5m').sign(rsa.privateKey),
    async mutate(change: 'revoke' | 'withdraw' | 'revision' | 'authorization' | 'root' | 'mode') {
      if (change === 'revoke') revoked = true;
      if (change === 'withdraw') authorized = false;
      if (change === 'mode') owned = true;
      if (change === 'revision') revision = randomBytes(16).toString('hex');
      if (change === 'authorization') authorizationId = randomBytes(16).toString('hex');
      if (change === 'root') {
        rootKeys = await generateKeyPair('EdDSA');
        rootDid = `${prefix}:agent:${(await exportJWK(rootKeys.publicKey)).x}`;
        delegation = await signDelegation();
      }
      policyToken = await policyRecord();
    },
    changeDuringLogin: () => { changeDuringLogin = true; },
  };
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

  it('keeps LifeID mandatory for owned agents even when self-rooted agents are allowed', async () => {
    const f = await selfFixture(); await f.mutate('mode');
    expect((await authorize(f)).completion.status).toBe(403);
    const flow = await authorize({ ...f, humanToken: f.ownerAssertion });
    expect(flow.completion.status).toBe(303);
    const response = await redeem(f, flow.code!, flow.verifier);
    expect(response.status).toBe(200);
    const info = await fetch(`${f.issuer}/userinfo`, { headers: { authorization: `Bearer ${(await response.json()).access_token}` } });
    const identity = await info.json();
    expect(identity.owner).not.toBeNull(); expect(identity.root.kind).toBe('lifeid');
  });
});

describe('explicit self-rooted agent OIDC authentication', () => {
  it.each([
    { descendant: false, legacy: false }, { descendant: true, legacy: false }, { descendant: false, legacy: true },
  ])('completes real-key PKCE/token/UserInfo without a human assertion for %j', async (settings) => {
    const f = await selfFixture(settings), flow = await authorize(f);
    expect(flow.completion.status).toBe(303);
    const expected = await f.identity();
    const jwks = await (await fetch(`${f.issuer}/jwks`)).json();
    const response = await redeem(f, flow.code!, flow.verifier);
    expect(response.status).toBe(200);
    const tokens = await response.json();
    const { payload } = await jwtVerify(tokens.id_token, createLocalJWKSet(jwks), {
      issuer: f.issuer, audience: 'registered-rp', algorithms: ['EdDSA'],
    });
    expect(payload.sub).toBe(f.did); expect(payload.nonce).toBe(flow.nonce);
    expect(payload.owner).toBeNull(); expect(payload.root).toEqual(expected.root);
    expect(payload.lineage).toEqual(expected.lineage); expect(payload.exp).toBeLessThanOrEqual(expected.expiresAt);
    const info = await fetch(`${f.issuer}/userinfo`, { headers: { authorization: `Bearer ${tokens.access_token}` } });
    expect(info.status).toBe(200);
    const claims = await info.json();
    expect(claims.owner).toBeNull(); expect(claims.root).toEqual(expected.root); expect(claims.lineage).toEqual(expected.lineage);
  });

  it('authenticates a self-rooted agent on a standalone server with no LifeID configuration or federation requests', async () => {
    const f = await selfFixture({ standalone: true });
    expect(f.options.lifeId).toBeUndefined(); expect(f.options.requireLifeId).toBeUndefined();
    expect(f.options.allowSelfRooted).toBe(true);
    const flow = await authorize(f);
    expect(flow.completion.status).toBe(303);
    const expected = await f.identity();
    const jwks = await (await fetch(`${f.issuer}/jwks`)).json();
    const response = await redeem(f, flow.code!, flow.verifier);
    expect(response.status).toBe(200);
    const tokens = await response.json();
    const { payload } = await jwtVerify(tokens.id_token, createLocalJWKSet(jwks), {
      issuer: f.issuer, audience: 'registered-rp', algorithms: ['EdDSA'],
    });
    expect(payload.sub).toBe(f.did); expect(payload.nonce).toBe(flow.nonce);
    expect(payload.owner).toBeNull(); expect(payload.root).toEqual(expected.root);
    expect(payload.lineage).toEqual([f.did]);
    const info = await fetch(`${f.issuer}/userinfo`, { headers: { authorization: `Bearer ${tokens.access_token}` } });
    expect(info.status).toBe(200);
    expect((await info.json()).root).toEqual(expected.root);
    // A human assertion is still refused rather than silently ignored without federation.
    expect((await authorize(f, { lifeIdToken: await f.ownerAssertion() })).completion.status).toBe(403);
    expect(f.federationRequests()).toBe(0);
  });

  it('denies self roots when the server option is absent', async () => {
    const f = await selfFixture({ allowSelfRooted: false });
    expect(f.options.allowSelfRooted).toBeUndefined();
    const flow = await authorize(f);
    expect(flow.completion.status).toBe(403); expect(flow.code).toBeUndefined();
  });

  it('does not substitute a genuine human assertion for a self-rooted identity', async () => {
    const f = await selfFixture();
    expect((await authorize(f, { lifeIdToken: await f.ownerAssertion() })).completion.status).toBe(403);
  });

  it('denies a policy revision change between possession verification and login resolution', async () => {
    const f = await selfFixture(); f.changeDuringLogin();
    expect((await authorize(f)).completion.status).toBe(403);
  });

  it.each(['revoke', 'withdraw', 'revision', 'authorization', 'root', 'mode'] as const)(
    'invalidates a code when current self-root authority changes: %s', async (change) => {
      const f = await selfFixture({ descendant: true }), flow = await authorize(f);
      await f.mutate(change);
      const response = await redeem(f, flow.code!, flow.verifier);
      expect(response.status).toBe(400); expect((await response.json()).error).toBe('invalid_grant');
    });

  it.each(['revoke', 'withdraw', 'revision', 'authorization', 'root', 'mode'] as const)(
    'invalidates UserInfo when current self-root authority changes: %s', async (change) => {
      const f = await selfFixture({ descendant: true }), flow = await authorize(f);
      const response = await redeem(f, flow.code!, flow.verifier);
      expect(response.status).toBe(200);
      const { access_token: accessToken } = await response.json();
      await f.mutate(change);
      const info = await fetch(`${f.issuer}/userinfo`, { headers: { authorization: `Bearer ${accessToken}` } });
      expect(info.status).toBe(401);
    });
});
