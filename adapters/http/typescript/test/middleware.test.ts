import { describe, it, expect, beforeEach } from 'vitest';
import { createOpenAgentHandler } from '../src/middleware.js';
import { InMemorySessionStore, type StoredSession } from '../src/server.js';
import { buildOpenAgentHeader } from '../src/headers.js';

describe('middleware', () => {
  let store: InMemorySessionStore;
  const baseOptions = {
    serverDid: 'https://api.example.com',
    verifySignature: async () => true,
  } as const;

  beforeEach(() => {
    store = new InMemorySessionStore();
  });

  it('serves the discovery document', async () => {
    const { handle } = createOpenAgentHandler({ ...baseOptions, store });
    const result = (await handle(new Request('http://localhost/.well-known/openagent'))) as Response;
    expect(result.status).toBe(200);
    const doc = await result.json();
    expect(doc.server_did).toBe('https://api.example.com');
  });

  it('issues a challenge on the auth endpoint, then verifies a proof', async () => {
    const { handle } = createOpenAgentHandler({ ...baseOptions, store });

    const challengeReq = new Request('http://localhost/.well-known/openagent/auth', {
      method: 'POST',
    });
    const challengeResp = (await handle(challengeReq)) as Response;
    expect(challengeResp.status).toBe(200);
    const challenge = await challengeResp.json();
    expect(challenge.type).toBe('openagent-challenge-v1');

    const proveReq = new Request('http://localhost/.well-known/openagent/auth/prove', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        signature: 'c2ln',
        public_key: 'a2V5',
        key_type: 'ed25519',
        nonce: challenge.nonce,
      }),
    });
    const proveResp = (await handle(proveReq)) as Response;
    expect(proveResp.status).toBe(200);
    const verified = await proveResp.json();
    expect(verified.session_token).toBeTruthy();
  });

  it('rejects unauthenticated requests to non-well-known paths', async () => {
    const { handle } = createOpenAgentHandler({ ...baseOptions, store });
    const result = await handle(new Request('http://localhost/api/tools'));
    expect(result).not.toBeInstanceOf(Response);
    expect((result as { authenticated: boolean }).authenticated).toBe(false);
  });

  it('authenticates requests with a valid session token', async () => {
    const { handle } = createOpenAgentHandler({ ...baseOptions, store });

    const session: StoredSession = {
      id: 'sess-valid',
      state: 'established',
      initiatorDid: 'did:oas:l1fe:agent:alice',
      responderDid: 'https://api.example.com',
      nonce: 'test',
      challengeTimestamp: '2026-03-21T12:00:00Z',
      createdAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(Date.now() / 1000) + 300,
      capabilities: [],
    };
    await store.put(session);

    const req = new Request('http://localhost/api/tools', {
      headers: { authorization: buildOpenAgentHeader('sess-valid') },
    });
    const result = await handle(req);
    expect(result).not.toBeInstanceOf(Response);
    expect((result as { authenticated: boolean }).authenticated).toBe(true);
    expect((result as { peerDid: string }).peerDid).toBe('did:oas:l1fe:agent:alice');
  });
});
