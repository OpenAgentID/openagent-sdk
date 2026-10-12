import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemorySessionStore, createServerConfig, handleDiscovery, handleChallenge,
  handleProve, authenticateRequest, CoreAuthError,
} from '../src/server.js';
import { verifyNodeSignature } from '../src/node.js';
import { makeIdentity } from './crypto-fixture.js';
import { buildOpenAgentHeader } from '../src/headers.js';

describe('real HTTP identity authentication', () => {
  const identity = makeIdentity();
  const config = createServerConfig('https://api.example.com', { resolveIdentityKey: identity.resolve });
  let store: InMemorySessionStore;
  beforeEach(() => { store = new InMemorySessionStore(); });

  it('publishes discovery and binds a real signed identity to its session', async () => {
    expect(handleDiscovery(config).auth_endpoint).toBe('/.well-known/openagent/auth');
    const challenge = await handleChallenge(config, store);
    const verified = await handleProve(config, store, await identity.proof(challenge), verifyNodeSignature);
    expect(verified.did).toBe(identity.did);
    const request = new Request('https://api.example.com/tools', {
      headers: { authorization: buildOpenAgentHeader(verified.session_token) },
    });
    expect(await authenticateRequest(request, store, identity.resolve)).toMatchObject({ authenticated: true, peerDid: identity.did });
    expect(await authenticateRequest(request, store, async () => null)).toMatchObject({ authenticated: false });
    expect(await store.get(verified.session_token)).toBeUndefined();
  });

  it.each(['ed25519', 'secp256k1'] as const)('verifies actual %s signatures', async keyType => {
    const agent = makeIdentity(keyType);
    const cfg = createServerConfig(config.origin, { resolveIdentityKey: agent.resolve });
    const challenge = await handleChallenge(cfg, store);
    const proof = await agent.proof(challenge);
    expect((await handleProve(cfg, store, proof, verifyNodeSignature)).did).toBe(agent.did);
    await expect(handleProve(cfg, store, proof, verifyNodeSignature)).rejects.toThrow(/replay/);
  });

  it('admits exactly one of 20 simultaneous proofs before asynchronous verification', async () => {
    const challenge = await handleChallenge(config, store);
    const proof = await identity.proof(challenge);
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => handleProve(config, store, proof,
      async params => { await new Promise(resolve => setTimeout(resolve, 5)); return verifyNodeSignature(params); })));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(19);
  });

  it('rejects a valid attacker signature claiming the pinned DID', async () => {
    const attacker = makeIdentity();
    const challenge = await handleChallenge(config, store);
    await expect(handleProve(config, store, await attacker.proof(challenge), verifyNodeSignature)).rejects.toThrow(/key/);
    await expect(handleProve(config, store, await identity.proof(challenge), verifyNodeSignature)).rejects.toThrow(/replay/);
  });

  it('rejects wrong DID, altered signature and algorithm confusion', async () => {
    for (const change of ['did', 'signature', 'algorithm']) {
      const challenge = await handleChallenge(config, store);
      const proof = await identity.proof(challenge);
      if (change === 'did') proof.did = 'did:oas:example:agent:other';
      if (change === 'signature') {
        const bytes = Buffer.from(proof.signature, 'base64url'); bytes[0] = bytes[0]! ^ 1;
        proof.signature = bytes.toString('base64url');
      }
      if (change === 'algorithm') proof.key_type = 'secp256k1';
      await expect(handleProve(config, store, proof, verifyNodeSignature)).rejects.toThrow(CoreAuthError);
    }
  });

  it('fails closed on resolver/verifier outages and consumes the challenge', async () => {
    for (const failedAuthority of ['resolver', 'verifier']) {
      const cfg = failedAuthority === 'resolver' ? { ...config, resolveIdentityKey: async () => { throw new Error('offline'); } } : config;
      const challenge = await handleChallenge(cfg, store);
      const proof = await identity.proof(challenge);
      await expect(handleProve(cfg, store, proof, failedAuthority === 'verifier' ? async () => { throw new Error('offline'); } : verifyNodeSignature)).rejects.toThrow(CoreAuthError);
      expect(await store.get(challenge.nonce)).toBeUndefined();
    }
  });

  it('rejects expired challenges and established records used as nonces', async () => {
    const challenge = await handleChallenge(config, store);
    const pending = (await store.get(challenge.nonce))!;
    await store.put({ ...pending, expiresAt: 1 });
    await expect(handleProve(config, store, await identity.proof(challenge), verifyNodeSignature)).rejects.toThrow(/expired/);
    const next = await handleChallenge(config, store);
    await store.put({ ...(await store.get(next.nonce))!, state: 'established' });
    await expect(handleProve(config, store, await identity.proof(next), verifyNodeSignature)).rejects.toThrow(/replay/);
  });

  it('rejects missing credentials, conflicting tokens and caller DID substitution', async () => {
    const challenge = await handleChallenge(config, store);
    const verified = await handleProve(config, store, await identity.proof(challenge), verifyNodeSignature);
    for (const headers of [ {},
      { authorization: 'Bearer unsupported', 'x-openagent-session': verified.session_token },
      { authorization: buildOpenAgentHeader(verified.session_token), 'x-openagent-session': 'other' },
      { authorization: buildOpenAgentHeader(verified.session_token), 'x-openagent-did': 'did:oas:example:agent:other' },
    ]) {
      expect((await authenticateRequest(new Request(config.origin, { headers }), store)).authenticated).toBe(false);
    }
  });

  it('consumes malformed answers and rejects challenges issued by another service', async () => {
    const malformed = await handleChallenge(config, store);
    await expect(handleProve(config, store, { nonce: malformed.nonce }, verifyNodeSignature)).rejects.toThrow();
    expect(await store.get(malformed.nonce)).toBeUndefined();
    const challenge = await handleChallenge(config, store);
    await expect(handleProve({ ...config, origin: 'https://other.example.com' }, store,
      await identity.proof(challenge), verifyNodeSignature)).rejects.toThrow(/origin/);
  });

  it('uses the issued realm even if configuration changes before proof', async () => {
    const cfg = { ...config, realm: 'original' };
    const challenge = await handleChallenge(cfg, store);
    cfg.realm = 'changed';
    expect((await handleProve(cfg, store, await identity.proof(challenge), verifyNodeSignature)).did).toBe(identity.did);
  });
});
