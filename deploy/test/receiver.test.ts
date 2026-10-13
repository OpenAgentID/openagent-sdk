import { afterEach, describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import '../shared/node-binding.js';
import { handleAgentRequest } from '../shared/receiver.js';
import { createHandler } from '../aws-lambda/handler.js';
import { createReceiverServer } from '../docker/server.js';
import { GET, POST } from '../vercel-edge/app/api/agent/route.js';
import { signingFixture } from './fixture.js';

const request = (token: string, body?: string) => new Request('https://receiver.example/api/agent', {
  method: body === undefined ? 'GET' : 'POST',
  headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json',
    'x-openagent-did': 'did:oas:example:agent:spoofed', 'x-openagent-root': 'spoofed' },
  body,
});
afterEach(() => vi.restoreAllMocks());

describe('real ACT deployment receiver', () => {
  it('preserves an authenticated body and derives identity only from verified claims', async () => {
    const { env, did, mint } = signingFixture();
    const response = await handleAgentRequest(request(mint(), JSON.stringify({ message: 'actual signed agent request' })), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ did, tenant: 'test-tenant', message: 'actual signed agent request' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('fails closed for missing configuration, stub tokens, forged keys and altered envelopes', async () => {
    const { env, mint } = signingFixture();
    expect((await handleAgentRequest(request(mint()), {})).status).toBe(503);
    for (const token of ['stub:did:oas:example:agent:fake', signingFixture().mint(), 'not-valid-cbor']) {
      expect((await handleAgentRequest(request(token), env)).status).toBe(401);
    }
    const bytes = Buffer.from(mint(), 'base64url'); bytes[bytes.length - 1] ^= 1;
    expect((await handleAgentRequest(request(bytes.toString('base64url')), env)).status).toBe(401);
  });

  it('enforces actual issuer, audience, tenant, expiry, scope and PoP constraints', async () => {
    const { env, mint } = signingFixture();
    const now = Math.floor(Date.now() / 1000);
    for (const change of [
      { iss: 'other-issuer' }, { aud: 'other-audience' }, { tenant_id: 'other-tenant' },
      { scope: ['other:agent:read'] }, { iat: now - 60, nbf: now - 60, exp: now - 1 },
      { nbf: now + 60 }, { exp: now + 600 }, { cnf: { key_fingerprint: 'test-key', alg: 'Ed25519' } },
    ]) expect((await handleAgentRequest(request(mint(change)), env)).status).toBe(401);
  });

  it('applies current revocation policy and current time on every request', async () => {
    const { env, did, mint } = signingFixture();
    const token = mint({ jti: 'revoke-this-token' });
    expect((await handleAgentRequest(request(token), env)).status).toBe(200);
    expect((await handleAgentRequest(request(token), { ...env, OPENAGENT_REVOKED_TOKEN_IDS: '["revoke-this-token"]' })).status).toBe(401);
    expect((await handleAgentRequest(request(token), { ...env, OPENAGENT_REVOKED_SUBJECTS: JSON.stringify([did]) })).status).toBe(401);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000);
    expect((await handleAgentRequest(request(token), env)).status).toBe(401);
  });

  it('bounds the body and refuses unrecognized request shapes', async () => {
    const { env, mint } = signingFixture();
    expect((await handleAgentRequest(request(mint(), JSON.stringify({ message: 'x'.repeat(20_000) })), env)).status).toBe(413);
    expect((await handleAgentRequest(request(mint(), '{"message":"x","admin":true}'), env)).status).toBe(400);
  });

  it('accepts current and readable legacy agent identifiers without rewriting signed subjects', async () => {
    const { env, mint } = signingFixture();
    for (const did of ['did:oas:example:agent:one', 'did:oas:example:agent:instance:two',
      'did:l1fe:agent:one', 'did:l1fe:agent:instance:two']) {
      const response = await handleAgentRequest(request(mint({ sub: did })), env);
      expect(response.status).toBe(200);
      expect((await response.json()).did).toBe(did);
    }
    for (const sub of ['did:oas:agent:hmr:owner', 'did:oas:bad:namespace:agent:one', 'did:l1fe:hmr:owner']) {
      expect((await handleAgentRequest(request(mint({ sub })), env)).status).toBe(401);
    }
  });

  it('verifies a real HTTP POST through the Docker server and denies another tenant', async () => {
    const { env, did, mint } = signingFixture();
    const server = createReceiverServer(env).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing receiver port');
    try {
      const send = (token: string) => fetch(`http://127.0.0.1:${address.port}/api/agent`, {
        method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'HTTP round trip' }),
      });
      const response = await send(mint());
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ did, message: 'HTTP round trip' });
      expect((await send(mint({ tenant_id: 'other' }))).status).toBe(401);
    } finally { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); }
  });

  it('preserves API Gateway base64 bodies and denies invalid capabilities in Lambda', async () => {
    const { env, did, mint } = signingFixture();
    const handler = createHandler(env);
    const event = { httpMethod: 'POST', path: '/api/agent', headers: { authorization: 'Bearer ' + mint(),
      'content-type': 'application/json' }, body: Buffer.from('{"message":"Lambda round trip"}').toString('base64'), isBase64Encoded: true };
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({ did, message: 'Lambda round trip' });
    expect((await handler({ ...event, headers: { ...event.headers, authorization: 'Bearer stub:did:oas:example:agent:fake' } })).statusCode).toBe(401);
  });

  it('runs the actual Vercel route exports with the same packed SDK verifier', async () => {
    const { env, did, mint } = signingFixture();
    const original = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    Object.assign(process.env, env);
    try {
      expect((await GET(request(mint()))).status).toBe(200);
      const response = await POST(request(mint(), '{"message":"Vercel route"}'));
      expect(await response.json()).toMatchObject({ did, message: 'Vercel route' });
      delete process.env.OPENAGENT_PUBLIC_KEYS;
      expect((await GET(request(mint()))).status).toBe(503);
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
});
