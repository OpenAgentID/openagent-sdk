import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemorySessionStore,
  createServerConfig,
  handleDiscovery,
  handleChallenge,
  handleProve,
  authenticateRequest,
  CoreAuthError,
  type StoredSession,
} from '../src/server.js';
import { CHALLENGE_TYPE, canonicalChallengeBytes, type IdentityProof } from '../src/transport.js';
import { HEADER_OPENAGENT_SESSION, buildOpenAgentHeader } from '../src/headers.js';

function validProof(nonce: string): IdentityProof {
  return {
    signature: 'c2ln',
    public_key: 'a2V5',
    key_type: 'ed25519',
    nonce,
  };
}

describe('server', () => {
  let store: InMemorySessionStore;
  const config = createServerConfig('https://api.example.com');

  beforeEach(() => {
    store = new InMemorySessionStore();
  });

  describe('handleDiscovery', () => {
    it('returns a valid discovery document', () => {
      const doc = handleDiscovery(config);
      expect(doc.server_did).toBe('https://api.example.com');
      expect(doc.supported_versions).toContain(1);
      expect(doc.auth_endpoint).toBe('/.well-known/openagent/auth');
    });
  });

  describe('handleChallenge', () => {
    it('issues a spec-shaped challenge', async () => {
      const challenge = await handleChallenge(config, store);
      expect(challenge.type).toBe(CHALLENGE_TYPE);
      expect(challenge.nonce).toMatch(/^[0-9a-f]{64}$/);
      expect(challenge.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(challenge.origin).toBe('https://api.example.com');
      expect(challenge.realm).toBeUndefined();
    });

    it('stores a pending session keyed by the nonce', async () => {
      const challenge = await handleChallenge(config, store);
      const pending = await store.get(challenge.nonce);
      expect(pending).toBeDefined();
      expect(pending?.state).toBe('awaiting_proof');
      expect(pending?.challengeTimestamp).toBe(challenge.timestamp);
    });
  });

  describe('handleProve', () => {
    const acceptAll = async () => true;

    it('verifies a correct proof and issues a session token', async () => {
      const challenge = await handleChallenge(config, store);
      const verified = await handleProve(config, store, validProof(challenge.nonce), acceptAll);
      expect(verified.session_token).toBeTruthy();
      expect(verified.trust_tier).toBe('anonymous');
      expect(verified.session_expires).toMatch(/Z$/);
    });

    it('consumes the nonce so a second answer is replay', async () => {
      const challenge = await handleChallenge(config, store);
      await handleProve(config, store, validProof(challenge.nonce), acceptAll);
      await expect(
        handleProve(config, store, validProof(challenge.nonce), acceptAll),
      ).rejects.toThrow(CoreAuthError);
    });

    it('rejects and consumes a bad signature', async () => {
      const challenge = await handleChallenge(config, store);
      await expect(
        handleProve(config, store, validProof(challenge.nonce), async () => false),
      ).rejects.toThrow(CoreAuthError);
      // The nonce is consumed on failure: even a now-accepting verifier fails.
      await expect(
        handleProve(config, store, validProof(challenge.nonce), acceptAll),
      ).rejects.toThrow(CoreAuthError);
    });

    it('rejects a secp256k1 proof with a named reason', async () => {
      const challenge = await handleChallenge(config, store);
      const proof: IdentityProof = { ...validProof(challenge.nonce), key_type: 'secp256k1' };
      await expect(handleProve(config, store, proof, acceptAll)).rejects.toThrow(
        /ed25519 only/,
      );
    });

    it('rejects a nonce with no pending challenge', async () => {
      await expect(
        handleProve(config, store, validProof('f'.repeat(64)), acceptAll),
      ).rejects.toThrow(CoreAuthError);
    });
  });

  describe('canonical payload reconstruction', () => {
    it('rebuilds the exact signed challenge from the session record', async () => {
      const challenge = await handleChallenge(config, store);
      const pending = await store.get(challenge.nonce);
      expect(pending).toBeDefined();
      const rebuilt = canonicalChallengeBytes({
        type: CHALLENGE_TYPE,
        nonce: pending!.nonce,
        timestamp: pending!.challengeTimestamp,
        origin: pending!.responderDid,
      });
      const original = canonicalChallengeBytes(challenge);
      expect(rebuilt).toEqual(original);
    });
  });

  describe('authenticateRequest', () => {
    function establishedSession(id: string): StoredSession {
      return {
        id,
        state: 'established',
        initiatorDid: 'did:oas:l1fe:agent:alice',
        responderDid: 'https://api.example.com',
        nonce: 'n',
        challengeTimestamp: '2026-03-21T12:00:00Z',
        createdAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 300,
        capabilities: [],
      };
    }

    it('authenticates via Authorization: OpenAgent', async () => {
      await store.put(establishedSession('sess-1'));
      const req = new Request('http://localhost/api', {
        headers: { authorization: buildOpenAgentHeader('sess-1') },
      });
      const result = await authenticateRequest(req, store);
      expect(result.authenticated).toBe(true);
      expect(result.peerDid).toBe('did:oas:l1fe:agent:alice');
    });

    it('authenticates via the session header fallback', async () => {
      await store.put(establishedSession('sess-2'));
      const req = new Request('http://localhost/api', {
        headers: { [HEADER_OPENAGENT_SESSION]: 'sess-2' },
      });
      const result = await authenticateRequest(req, store);
      expect(result.authenticated).toBe(true);
    });

    it('rejects missing credentials', async () => {
      const result = await authenticateRequest(new Request('http://localhost/api'), store);
      expect(result.authenticated).toBe(false);
    });

    it('rejects and removes an expired session', async () => {
      const expired = establishedSession('sess-3');
      expired.expiresAt = Math.floor(Date.now() / 1000) - 10;
      await store.put(expired);
      const req = new Request('http://localhost/api', {
        headers: { [HEADER_OPENAGENT_SESSION]: 'sess-3' },
      });
      const result = await authenticateRequest(req, store);
      expect(result.authenticated).toBe(false);
      expect(await store.get('sess-3')).toBeUndefined();
    });
  });
});
