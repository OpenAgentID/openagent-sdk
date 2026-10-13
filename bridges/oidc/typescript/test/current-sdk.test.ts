import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { IdentityVerifier, type AgentIdentityProof } from '@openagentid/sdk';
import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import type { Adapter, AdapterPayload } from 'oidc-provider';
import { expect, it } from 'vitest';
import { createAgentOidcProvider, type AgentOidcProvider, type AgentOidcProviderOptions } from '../src/provider.js';

/** Complete disposable oidc-provider persistence contract for this HTTP test. */
function storage() {
  const rows = new Map<string, { payload: AdapterPayload; expires: number }>();
  return class implements Adapter {
    constructor(private readonly model: string) {}
    async upsert(id: string, payload: AdapterPayload, seconds = 3600) { rows.set(`${this.model}:${id}`, { payload: structuredClone(payload), expires: Date.now() + seconds * 1000 }); }
    async find(id: string) { const row = rows.get(`${this.model}:${id}`); return row && row.expires > Date.now() ? structuredClone(row.payload) : undefined; }
    async findByUid(uid: string) { return this.match('uid', uid); }
    async findByUserCode(code: string) { return this.match('userCode', code); }
    private async match(field: 'uid' | 'userCode', value: string) {
      for (const [key, row] of rows) if (key.startsWith(`${this.model}:`) && row.payload[field] === value) return this.find(key.slice(this.model.length + 1));
      return undefined;
    }
    async consume(id: string) { const row = rows.get(`${this.model}:${id}`); if (row) row.payload.consumed = Math.floor(Date.now() / 1000); }
    async destroy(id: string) { rows.delete(`${this.model}:${id}`); }
    async revokeByGrantId(grantId: string) { for (const [key, row] of rows) if (row.payload.grantId === grantId) rows.delete(key); }
  };
}

it('uses the installed SDK IdentityVerifier for real OIDC code+PKCE, ID token, UserInfo and revocation', async () => {
  const servers: Server[] = [];
  const listen = async (server: Server) => {
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('HTTP bind failed');
    return `http://127.0.0.1:${address.port}`;
  };
  try {
    const rpOrigin = await listen(createServer((_request, response) => { response.end('Callback received'); }));
    let provider: AgentOidcProvider;
    const issued = new Set<string>();
    const issuer = await listen(createServer((request, response) => {
      void (async () => {
        if (request.url?.startsWith('/interaction/')) {
          if (request.method === 'GET') {
            const interaction = await provider.interaction(request, response);
            issued.add(interaction.nonce);
            response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(interaction));
          } else {
            let body = '';
            for await (const chunk of request) { body += chunk; if (body.length > 128 * 1024) throw new Error('Body too large'); }
            await provider.completeInteraction(request, response, JSON.parse(body));
          }
        } else provider.callback()(request, response);
      })().catch(() => { response.statusCode = 403; response.end('Access denied'); });
    }));
    const signing = await generateKeyPair('RS256');
    const keys = await generateKeyPair('EdDSA');
    const publicKeyJwk = await exportJWK(keys.publicKey);
    const did = `did:oas:integration:agent:${publicKeyJwk.x}`;
    const startTime = Math.floor(Date.now() / 1000) - 1;
    let revoked = false;
    const used = new Set<string>();
    const verifier = new IdentityVerifier({
      resolveDid: async requested => requested === did ? { did, verificationMethods: [{ id: `${did}#signing`, publicKeyJwk, purposes: ['authentication'] }] } : null,
      authorizeOwner: async () => null,
      authorizeSelfRoot: async (requested, context) => requested === did && context.audience === issuer ? {
        did, audience: issuer, authorizationId: 'explicit-test-registration', revision: '1',
        issuedAt: startTime, notBefore: startTime, expiresAt: startTime + 600, checkedAt: Math.floor(Date.now() / 1000),
      } : null,
      checkRevocation: async () => ({ revoked, checkedAt: Math.floor(Date.now() / 1000) }),
      resolveDelegations: async () => [],
      replay: { async consume(claim) {
        const key = `${claim.issuer}:${claim.tokenId}`;
        if (!issued.has(claim.nonce) || used.has(key) || claim.issuer !== did || claim.audience !== issuer) return false;
        issued.delete(claim.nonce); used.add(key); return true;
      } },
    });
    const options: AgentOidcProviderOptions = {
      issuer, mode: 'test', persistent: false, adapter: storage(), allowSelfRooted: true,
      cookieKeys: [randomBytes(32).toString('base64url')],
      clients: [{ client_id: 'sdk-rp', redirect_uris: [`${rpOrigin}/callback`], token_endpoint_auth_method: 'none' }],
      jwks: { keys: [{ ...await exportJWK(signing.privateKey), kid: 'oidc-signing', alg: 'RS256', use: 'sig' }] },
      // Actual SDK method contracts are assigned without casting or reimplementing verification.
      verifyAgent: (proof, context) => verifier.verify(proof, context),
      resolveIdentity: requested => verifier.resolve(requested, { audience: issuer }),
    };
    provider = await createAgentOidcProvider(options);
    const cookies = new Map<string, string>();
    const browser = async (url: string, init: RequestInit = {}) => {
      const response = await fetch(url, { ...init, redirect: 'manual', headers: {
        ...Object.fromEntries(new Headers(init.headers)), Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      } });
      for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(';')[0]; const offset = pair.indexOf('='); cookies.set(pair.slice(0, offset), pair.slice(offset + 1)); }
      return response;
    };
    const pkce = randomBytes(32).toString('base64url');
    const nonce = randomUUID();
    const state = randomUUID();
    const params = new URLSearchParams({ client_id: 'sdk-rp', redirect_uri: `${rpOrigin}/callback`, response_type: 'code', scope: 'openid profile',
      nonce, state, code_challenge: createHash('sha256').update(pkce).digest('base64url'), code_challenge_method: 'S256' });
    const authorization = await browser(`${issuer}/authorize?${params}`);
    expect(authorization.status).toBe(303);
    const interactionUrl = new URL(authorization.headers.get('location')!, issuer).href;
    const challenge = await (await browser(interactionUrl)).json();
    const proof: AgentIdentityProof = { delegations: [], token: await new SignJWT({ kind: 'agent', nonce: challenge.nonce })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'oaid-proof+jwt', kid: `${did}#signing` }).setIssuer(did).setSubject(did)
      .setAudience(issuer).setIssuedAt().setNotBefore('0s').setExpirationTime('60s').setJti(randomUUID()).sign(keys.privateKey) };
    const completion = await browser(interactionUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ proof, consent: true }) });
    expect(completion.status).toBe(303);
    await expect(verifier.verify(proof, { audience: issuer, nonce: challenge.nonce })).rejects.toMatchObject({ code: 'replayed' });
    const resumed = await browser(new URL(completion.headers.get('location')!, issuer).href);
    const callback = new URL(resumed.headers.get('location')!, issuer);
    expect(callback.origin).toBe(rpOrigin);
    expect(callback.searchParams.get('state')).toBe(state);
    expect((await fetch(callback)).status).toBe(200);
    const redeem = () => fetch(`${issuer}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
      client_id: 'sdk-rp', grant_type: 'authorization_code', redirect_uri: `${rpOrigin}/callback`, code: callback.searchParams.get('code')!, code_verifier: pkce,
    }) });
    const tokenResponse = await redeem();
    expect(tokenResponse.status).toBe(200);
    const tokens = await tokenResponse.json();
    const jwks = await (await fetch(`${issuer}/jwks`)).json();
    const { payload } = await jwtVerify(tokens.id_token, createLocalJWKSet(jwks), { issuer, audience: 'sdk-rp', algorithms: ['RS256'] });
    expect(payload.sub).toBe(did);
    expect(payload.nonce).toBe(nonce);
    expect(payload.root).toMatchObject({ kind: 'self', did });
    const userInfo = () => fetch(`${issuer}/userinfo`, { headers: { authorization: `Bearer ${tokens.access_token}` } });
    expect((await (await userInfo()).json()).sub).toBe(did);
    revoked = true;
    await expect(verifier.resolve(did, { audience: issuer })).rejects.toMatchObject({ code: 'revoked' });
    expect((await userInfo()).status).toBe(401);
    expect((await redeem()).status).toBe(400);
  } finally {
    await Promise.all(servers.map(server => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
    })));
  }
}, 30_000);
