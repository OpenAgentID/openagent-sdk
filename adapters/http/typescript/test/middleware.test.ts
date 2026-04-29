import { describe, it, expect, beforeEach } from 'vitest';
import { createOpenAgentHandler, type MiddlewareOptions } from '../src/middleware.js';
import { InMemorySessionStore, PROTOCOL_VERSION } from '../src/server.js';

describe('middleware', () => {
  let store: InMemorySessionStore;
  const baseOptions: MiddlewareOptions = {
    serverDid: 'did:oas:l1fe:service:test',
    verifySignature: async () => true,
  };

  beforeEach(() => {
    store = new InMemorySessionStore();
  });

  describe('createOpenAgentHandler', () => {
    it('handles discovery GET', async () => {
      const { handle } = createOpenAgentHandler({ ...baseOptions, store });
      const req = new Request('http://localhost/.well-known/openagent', {
        method: 'GET',
      });
      const result = await handle(req);
      expect(result).toBeInstanceOf(Response);
      const resp = result as Response;
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.server_did).toBe('did:oas:l1fe:service:test');
    });

    it('handles present POST', async () => {
      const { handle } = createOpenAgentHandler({ ...baseOptions, store });
      const presentBody = {
        version: PROTOCOL_VERSION,
        did: 'did:oas:l1fe:agent:alice',
        did_document: '{}',
        ephemeral_public_key: btoa(String.fromCharCode(...new Uint8Array(32))),
      };
      const req = new Request('http://localhost/.well-known/openagent/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(presentBody),
      });
      const result = await handle(req);
      expect(result).toBeInstanceOf(Response);
      const resp = result as Response;
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.session_id).toBeTruthy();
      expect(body.nonce).toBeTruthy();
    });

    it('handles prove POST with valid signature', async () => {
      const { handle } = createOpenAgentHandler({ ...baseOptions, store });

      // First, PRESENT to get a challenge.
      const presentBody = {
        version: PROTOCOL_VERSION,
        did: 'did:oas:l1fe:agent:alice',
        did_document: '{}',
        ephemeral_public_key: btoa(String.fromCharCode(...new Uint8Array(32))),
      };
      const presentReq = new Request('http://localhost/.well-known/openagent/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(presentBody),
      });
      const presentResult = await handle(presentReq) as Response;
      const challenge = await presentResult.json();

      // Then, PROVE.
      const proveBody = {
        session_id: challenge.session_id,
        signature: 'AAAA',
        did: 'did:oas:l1fe:agent:alice',
      };
      const proveReq = new Request('http://localhost/.well-known/openagent/auth/prove', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(proveBody),
      });
      const proveResult = await handle(proveReq) as Response;
      expect(proveResult.status).toBe(200);
      const established = await proveResult.json();
      expect(established.session_id).toBe(challenge.session_id);
    });

    it('rejects unauthenticated requests to non-well-known paths', async () => {
      const { handle } = createOpenAgentHandler({ ...baseOptions, store });
      const req = new Request('http://localhost/api/tools', { method: 'GET' });
      const result = await handle(req);
      // Should be an AuthResult, not a Response.
      expect(result).not.toBeInstanceOf(Response);
      expect((result as { authenticated: boolean }).authenticated).toBe(false);
    });

    it('authenticates requests with valid session', async () => {
      const { handle } = createOpenAgentHandler({ ...baseOptions, store });

      // Set up an established session.
      await store.put({
        id: 'sess-valid',
        state: 'established',
        initiatorDid: 'did:oas:l1fe:agent:alice',
        responderDid: 'did:oas:l1fe:service:test',
        nonce: 'test',
        createdAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 300,
        capabilities: [],
      });

      const req = new Request('http://localhost/api/tools', {
        method: 'GET',
        headers: { 'x-openagent-session': 'sess-valid' },
      });
      const result = await handle(req);
      expect(result).not.toBeInstanceOf(Response);
      expect((result as { authenticated: boolean }).authenticated).toBe(true);
      expect((result as { peerDid: string }).peerDid).toBe('did:oas:l1fe:agent:alice');
    });
  });
});
