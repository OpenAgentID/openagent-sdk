import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemorySessionStore,
  createServerConfig,
  handleDiscovery,
  handlePresent,
  handleProve,
  authenticateRequest,
  OaapServerError,
  PROTOCOL_VERSION,
} from '../src/server.js';
import { HEADER_OPENAGENT_SESSION } from '../src/headers.js';

describe('server', () => {
  let store: InMemorySessionStore;
  const config = createServerConfig('did:oas:l1fe:service:test');

  beforeEach(() => {
    store = new InMemorySessionStore();
  });

  describe('handleDiscovery', () => {
    it('returns a valid discovery document', () => {
      const doc = handleDiscovery(config);
      expect(doc.server_did).toBe('did:oas:l1fe:service:test');
      expect(doc.supported_versions).toContain(PROTOCOL_VERSION);
      expect(doc.auth_endpoint).toBe('/.well-known/openagent/auth');
      expect(doc.required_conformance_level).toBe('L2');
    });
  });

  describe('handlePresent', () => {
    const validPresent = {
      version: PROTOCOL_VERSION,
      did: 'did:oas:l1fe:agent:alice',
      did_document: '{}',
      ephemeral_public_key: btoa(String.fromCharCode(...new Uint8Array(32))),
    };

    it('returns a challenge for a valid PRESENT', async () => {
      const challenge = await handlePresent(config, store, validPresent);
      expect(challenge.session_id).toBeTruthy();
      expect(challenge.nonce).toBeTruthy();
      expect(challenge.responder_did).toBe(config.serverDid);
      expect(challenge.expires_at).toBeGreaterThan(0);
    });

    it('rejects unsupported protocol version', async () => {
      await expect(
        handlePresent(config, store, { ...validPresent, version: 99 }),
      ).rejects.toThrow(OaapServerError);
    });

    it('rejects invalid DID', async () => {
      await expect(
        handlePresent(config, store, { ...validPresent, did: 'not-a-did' }),
      ).rejects.toThrow(OaapServerError);
    });

    it('stores the session', async () => {
      const challenge = await handlePresent(config, store, validPresent);
      const session = await store.get(challenge.session_id);
      expect(session).toBeDefined();
      expect(session?.state).toBe('awaiting_proof');
      expect(session?.initiatorDid).toBe('did:oas:l1fe:agent:alice');
    });
  });

  describe('handleProve', () => {
    it('rejects unknown session', async () => {
      const prove = { session_id: 'nonexistent', signature: 'AAAA', did: 'did:oas:test:agent:x' };
      const verifyFn = async () => true;
      await expect(handleProve(config, store, prove, verifyFn)).rejects.toThrow(
        OaapServerError,
      );
    });

    it('rejects DID mismatch', async () => {
      const validPresent = {
        version: PROTOCOL_VERSION,
        did: 'did:oas:l1fe:agent:alice',
        did_document: '{}',
        ephemeral_public_key: btoa(String.fromCharCode(...new Uint8Array(32))),
      };
      const challenge = await handlePresent(config, store, validPresent);

      const prove = {
        session_id: challenge.session_id,
        signature: 'AAAA',
        did: 'did:oas:l1fe:agent:bob',
      };
      const verifyFn = async () => true;
      await expect(handleProve(config, store, prove, verifyFn)).rejects.toThrow(
        /DID mismatch/,
      );
    });

    it('rejects failed signature verification', async () => {
      const validPresent = {
        version: PROTOCOL_VERSION,
        did: 'did:oas:l1fe:agent:alice',
        did_document: '{}',
        ephemeral_public_key: btoa(String.fromCharCode(...new Uint8Array(32))),
      };
      const challenge = await handlePresent(config, store, validPresent);

      const prove = {
        session_id: challenge.session_id,
        signature: 'AAAA',
        did: 'did:oas:l1fe:agent:alice',
      };
      const verifyFn = async () => false;
      await expect(handleProve(config, store, prove, verifyFn)).rejects.toThrow(
        /Signature verification failed/,
      );
    });

    it('establishes session on valid proof', async () => {
      const validPresent = {
        version: PROTOCOL_VERSION,
        did: 'did:oas:l1fe:agent:alice',
        did_document: '{}',
        ephemeral_public_key: btoa(String.fromCharCode(...new Uint8Array(32))),
      };
      const challenge = await handlePresent(config, store, validPresent);

      const prove = {
        session_id: challenge.session_id,
        signature: 'AAAA',
        did: 'did:oas:l1fe:agent:alice',
      };
      const verifyFn = async () => true;
      const established = await handleProve(config, store, prove, verifyFn);

      expect(established.session_id).toBe(challenge.session_id);
      expect(established.expires_at).toBeGreaterThan(0);

      const session = await store.get(challenge.session_id);
      expect(session?.state).toBe('established');
    });
  });

  describe('authenticateRequest', () => {
    it('rejects request without session header', async () => {
      const req = new Request('http://localhost/api/tools');
      const result = await authenticateRequest(req, store);
      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('Missing');
    });

    it('rejects unknown session', async () => {
      const req = new Request('http://localhost/api/tools', {
        headers: { [HEADER_OPENAGENT_SESSION]: 'unknown-session' },
      });
      const result = await authenticateRequest(req, store);
      expect(result.authenticated).toBe(false);
    });

    it('authenticates valid session', async () => {
      // Create an established session directly.
      await store.put({
        id: 'sess-valid',
        state: 'established',
        initiatorDid: 'did:oas:l1fe:agent:alice',
        responderDid: config.serverDid,
        nonce: 'test',
        createdAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 300,
        capabilities: [],
      });

      const req = new Request('http://localhost/api/tools', {
        headers: { [HEADER_OPENAGENT_SESSION]: 'sess-valid' },
      });
      const result = await authenticateRequest(req, store);
      expect(result.authenticated).toBe(true);
      expect(result.peerDid).toBe('did:oas:l1fe:agent:alice');
    });

    it('rejects expired session', async () => {
      await store.put({
        id: 'sess-expired',
        state: 'established',
        initiatorDid: 'did:oas:l1fe:agent:alice',
        responderDid: config.serverDid,
        nonce: 'test',
        createdAt: Math.floor(Date.now() / 1000) - 600,
        expiresAt: Math.floor(Date.now() / 1000) - 1,
        capabilities: [],
      });

      const req = new Request('http://localhost/api/tools', {
        headers: { [HEADER_OPENAGENT_SESSION]: 'sess-expired' },
      });
      const result = await authenticateRequest(req, store);
      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('expired');
    });
  });
});
