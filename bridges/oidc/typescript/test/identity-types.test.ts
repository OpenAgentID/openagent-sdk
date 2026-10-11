import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { exportJWK, generateKeyPair } from 'jose';
import { assertAgentIdentity, identityRoot, sameIdentityBinding, type VerifiedAgentIdentity } from '../src/identity-types.js';

let rootDid: string, did: string;
const ownerRoot = `did:oas:openagent:hmr:${randomBytes(32).toString('hex')}`;
const owner = { issuer: 'https://auth.life.one', subject: randomBytes(16).toString('hex') };

beforeAll(async () => {
  rootDid = `did:oas:openagent:agent:${(await exportJWK((await generateKeyPair('EdDSA')).publicKey)).x}`;
  did = `did:oas:openagent:agent:instance:${(await exportJWK((await generateKeyPair('EdDSA')).publicKey)).x}`;
});

function self(): VerifiedAgentIdentity {
  return { did, owner: null, root: { kind: 'self', did: rootDid,
    authorizationId: randomBytes(16).toString('hex'), revision: randomBytes(16).toString('hex') },
  lineage: [rootDid, did], expiresAt: Math.floor(Date.now() / 1000) + 300 };
}

function owned(): VerifiedAgentIdentity {
  return { did, owner, lineage: [ownerRoot, did], expiresAt: Math.floor(Date.now() / 1000) + 300 };
}

describe('verified OIDC root boundary', () => {
  it('defaults to owned roots and emits an explicit LifeID discriminator for historical owned results', () => {
    const identity = owned();
    expect(() => assertAgentIdentity(identity)).not.toThrow();
    expect(identityRoot(identity)).toEqual({ kind: 'lifeid', did: ownerRoot });
    expect(sameIdentityBinding(identity, { ...identity, root: { kind: 'lifeid', did: ownerRoot } })).toBe(true);
    expect(() => assertAgentIdentity(self())).toThrow('disabled');
  });

  it('accepts a self root and its signed-chain descendant only with explicit server opt-in', () => {
    const descendant = self();
    expect(() => assertAgentIdentity(descendant, did, true)).not.toThrow();
    expect(() => assertAgentIdentity({ ...descendant, did: rootDid, lineage: [rootDid] }, rootDid, true)).not.toThrow();
  });

  it.each<[string, Record<string, unknown>]>([
    ['unknown mode', { root: { kind: 'untrusted', did: 'invalid' } }],
    ['missing self authorization', { root: undefined }],
    ['null root', { root: null }],
    ['missing authorization id', { root: { kind: 'self', authorizationId: '' } }],
    ['oversized authorization id', { root: { kind: 'self', authorizationId: 'a'.repeat(513) } }],
    ['blank revision', { root: { kind: 'self', revision: ' ' } }],
    ['oversized revision', { root: { kind: 'self', revision: 'a'.repeat(513) } }],
    ['expired identity', { expiresAt: 0 }],
    ['non-integral expiry', { expiresAt: Math.floor(Date.now() / 1000) + 300.5 }],
  ])('rejects %s in a callback result', (_label, patch) => {
    const identity = self();
    const changed = { ...identity, ...patch,
      ...(patch.root && typeof patch.root === 'object' ? { root: { ...identity.root, ...patch.root } } : {}) };
    expect(() => assertAgentIdentity(changed as VerifiedAgentIdentity, did, true)).toThrow();
  });

  it('requires a valid agent root and exact first/last DID bindings', () => {
    const identity = self();
    const root = identity.root!;
    expect(() => assertAgentIdentity({ ...identity, root: { ...root, did } } as VerifiedAgentIdentity, did, true)).toThrow();
    expect(() => assertAgentIdentity({ ...identity, root: { ...root, did: ownerRoot }, lineage: [ownerRoot, did] } as VerifiedAgentIdentity, did, true)).toThrow();
    expect(() => assertAgentIdentity(identity, rootDid, true)).toThrow();
    expect(() => assertAgentIdentity({ ...identity, lineage: [rootDid] }, did, true)).toThrow();
  });

  it('rejects invalid, oversized, or repeated identifiers anywhere in the lineage', () => {
    const identity = self();
    for (const lineage of [[rootDid, 'not-a-did', did], [rootDid, `${did}${'a'.repeat(513)}`, did], [rootDid, rootDid, did]]) {
      expect(() => assertAgentIdentity({ ...identity, lineage }, did, true)).toThrow();
    }
  });

  it('permits at most 17 distinct lineage DIDs', () => {
    const identity = self();
    const intermediate = Array.from({ length: 15 }, () => `did:oas:openagent:agent:${randomBytes(32).toString('hex')}`);
    expect(() => assertAgentIdentity({ ...identity, lineage: [rootDid, ...intermediate, did] }, did, true)).not.toThrow();
    expect(() => assertAgentIdentity({ ...identity, lineage: [rootDid, ...intermediate,
      `did:oas:openagent:agent:${randomBytes(32).toString('hex')}`, did] }, did, true)).toThrow();
  });

  it('refuses owner/mode confusion and requires a person or organization root for owned mode', () => {
    const identity = self();
    expect(() => assertAgentIdentity({ ...identity, owner } as VerifiedAgentIdentity, did, true)).toThrow();
    expect(() => assertAgentIdentity({ ...owned(), owner: null } as VerifiedAgentIdentity, did, true)).toThrow();
    expect(() => assertAgentIdentity({ ...owned(), lineage: [rootDid, did] }, did, true)).toThrow();
    expect(() => assertAgentIdentity({ ...owned(), lineage: [did] }, did, true)).toThrow();
  });

  it('compares the complete self-root authorization and the complete LifeID owner/root binding', () => {
    const identity = self();
    if (identity.owner !== null) throw new Error('Expected self fixture');
    expect(sameIdentityBinding(identity, structuredClone(identity))).toBe(true);
    for (const root of [
      { ...identity.root, authorizationId: randomBytes(16).toString('hex') },
      { ...identity.root, revision: randomBytes(16).toString('hex') },
      { ...identity.root, did },
    ]) expect(sameIdentityBinding(identity, { ...identity, root })).toBe(false);
    expect(sameIdentityBinding(identity, owned())).toBe(false);
    expect(sameIdentityBinding(owned(), identity)).toBe(false);
    const ownedIdentity = owned();
    expect(sameIdentityBinding(ownedIdentity, { ...ownedIdentity, owner: { ...owner, subject: 'changed-owner' } })).toBe(false);
    expect(sameIdentityBinding(ownedIdentity, { ...ownedIdentity,
      root: { kind: 'lifeid', did: `did:oas:openagent:ao:${randomBytes(32).toString('hex')}` } })).toBe(false);
  });
});
