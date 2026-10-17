import { randomUUID } from 'node:crypto';
import { decodeJwt, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  IdentityVerificationError,
  IdentityVerifier,
  assertVerifiedIdentity,
  type IdentityVerifierConfig,
  type RevocationCheck,
  type SelfRootAuthorization,
} from '../src/identity-verification.js';

const now = 1_790_000_000;
const audience = 'https://relying.example';
const nonce = 'server-issued-single-use-challenge';
const owner = { issuer: 'https://auth.life.one', subject: 'user_authorized', organizationId: 'org_authorized' };

async function fixture(algorithm: 'EdDSA' | 'RS256' = 'EdDSA', legacy = false,
  rootKind: 'hmr' | 'mhr' | 'ao' | 'enr' | 'agent' = 'hmr') {
  const root = legacy ? `did:l1fe:${rootKind}:owner` : `did:oas:openagent:${rootKind}:owner`;
  const parent = legacy ? 'did:l1fe:agent:parent' : 'did:oas:openagent:agent:parent';
  const leaf = legacy ? 'did:l1fe:agent:worker' : 'did:oas:openagent:agent:worker';
  const entries = await Promise.all([root, parent, leaf].map(async (did) => {
    const keys = await generateKeyPair(algorithm);
    return { did, ...keys, jwk: await exportJWK(keys.publicKey) };
  }));
  const revoked = new Set<string>();
  const checks: RevocationCheck[] = [];
  const consumed = new Set<string>();
  const config: IdentityVerifierConfig = {
    now: () => now,
    async resolveDid(did) {
      const entry = entries.find((candidate) => candidate.did === did);
      return entry ? { did, verificationMethods: [{ id: `${did}#signing`, publicKeyJwk: entry.jwk,
        purposes: did === leaf ? ['authentication'] as const : ['capabilityDelegation'] as const }] } : null;
    },
    async authorizeOwner(did) { return did === root ? owner : null; },
    async checkRevocation(check) {
      checks.push(check);
      return { revoked: revoked.has(check.did) || revoked.has(check.credentialId ?? ''), checkedAt: now };
    },
    replay: {
      async consume(claim) {
        const id = `${claim.issuer}:${claim.tokenId}`;
        const challenge = `${claim.audience}:${claim.nonce}`;
        if (consumed.has(id) || consumed.has(challenge)) return false;
        consumed.add(id);
        consumed.add(challenge);
        return true;
      },
    },
  };
  async function sign(issuer: string, subject: string, typ: string, overrides: JWTPayload = {}) {
    const key = entries.find((entry) => entry.did === issuer)!;
    return new SignJWT({
      iss: issuer, sub: subject, aud: audience, iat: now - 10, nbf: now - 10,
      exp: now + (typ === 'oaid-proof+jwt' ? 100 : 200), jti: randomUUID(),
      ...(typ === 'oaid-proof+jwt' ? { nonce, kind: 'agent' } : {}), ...overrides,
    }).setProtectedHeader({ alg: algorithm, kid: `${issuer}#signing`, typ }).sign(key.privateKey);
  }
  const delegations = [await sign(root, parent, 'oaid-delegation+jwt'), await sign(parent, leaf, 'oaid-delegation+jwt')];
  const token = await sign(leaf, leaf, 'oaid-proof+jwt');
  config.resolveDelegations = async (did, aud) => {
    if (did !== leaf || aud !== audience) throw new Error('Unknown authority query');
    return delegations;
  };
  return { root, parent, leaf, config, revoked, checks, sign, entries, proof: { token, delegations } };
}

async function selfFixture(algorithm: 'EdDSA' | 'RS256' = 'EdDSA', legacy = false) {
  const f = await fixture(algorithm, legacy, 'agent');
  const authorizations = new Map<string, SelfRootAuthorization>([[f.root, {
    did: f.root, audience, authorizationId: randomUUID(), revision: randomUUID(),
    issuedAt: now - 20, notBefore: now - 20, expiresAt: now + 300, checkedAt: now,
  }]]);
  const resolve = f.config.resolveDid;
  f.config.resolveDid = async (did) => {
    const document = await resolve(did);
    return document && did === f.root ? { ...document, verificationMethods:
      document.verificationMethods.map((method) => ({ ...method,
        purposes: ['authentication', 'capabilityDelegation'] as const })) } : document;
  };
  f.config.authorizeOwner = async () => { throw new Error('Self-root may not manufacture a human owner'); };
  f.config.authorizeSelfRoot = async (did, options) => {
    expect(options).toEqual({ audience });
    return authorizations.get(did) ?? null;
  };
  f.config.resolveDelegations = async (did, aud) => {
    if (aud !== audience) throw new Error('Wrong audience');
    if (did === f.root) return [];
    if (did === f.leaf) return f.proof.delegations;
    throw new Error('Unknown agent');
  };
  const direct = { token: await f.sign(f.root, f.root, 'oaid-proof+jwt'), delegations: [] };
  return { ...f, authorizations, direct };
}

describe('IdentityVerifier real signed identity proofs', () => {
  it.each(['EdDSA', 'RS256'] as const)('verifies %s possession, full lineage and approved owner', async (algorithm) => {
    const f = await fixture(algorithm);
    const result = await new IdentityVerifier(f.config).verify(f.proof, { audience, nonce });
    expect(result).toEqual({ did: f.leaf, owner, root: { kind: 'lifeid', did: f.root },
      lineage: [f.root, f.parent, f.leaf], expiresAt: now + 100 });
    expect(new Set(f.checks.map((check) => check.did))).toEqual(new Set([f.root, f.parent, f.leaf]));
    expect(f.checks.filter((check) => check.credentialId)).toHaveLength(3);
  });

  it('reads legacy DIDs without rewriting the identity or signing key identifier', async () => {
    const f = await fixture('EdDSA', true);
    const result = await new IdentityVerifier(f.config).verify(f.proof, { audience, nonce });
    expect(result.did).toBe('did:l1fe:agent:worker');
    expect(result.lineage).toEqual([f.root, f.parent, f.leaf]);
  });

  it('rejects a tampered payload despite otherwise matching DID/key/owner', async () => {
    const f = await fixture();
    const parts = f.proof.token.split('.');
    const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    parts[1] = Buffer.from(JSON.stringify({ ...claims, nonce: 'forged' })).toString('base64url');
    await expect(new IdentityVerifier(f.config).verify({ ...f.proof, token: parts.join('.') },
      { audience, nonce: 'forged' })).rejects.toMatchObject({ code: 'invalid_proof' });
  });

  it('rejects an unrelated real signing key under the authorized kid', async () => {
    const f = await fixture();
    const attacker = await generateKeyPair('EdDSA');
    const token = await new SignJWT({ iss: f.leaf, sub: f.leaf, aud: audience, iat: now, nbf: now,
      exp: now + 60, jti: randomUUID(), nonce, kind: 'agent' })
      .setProtectedHeader({ alg: 'EdDSA', kid: `${f.leaf}#signing`, typ: 'oaid-proof+jwt' }).sign(attacker.privateKey);
    await expect(new IdentityVerifier(f.config).verify({ ...f.proof, token }, { audience, nonce }))
      .rejects.toMatchObject({ code: 'invalid_proof' });
  });

  it.each([
    ['leaf', ['assertionMethod']],
    ['leaf', ['capabilityDelegation']],
    ['root', ['assertionMethod']],
    ['root', ['authentication']],
    ['parent', ['assertionMethod']],
  ] as const)('rejects a correctly signed proof when the %s key has only %s purpose', async (link, purposes) => {
    const f = await fixture();
    const resolve = f.config.resolveDid;
    f.config.resolveDid = async (did) => {
      const document = await resolve(did);
      return document && did === f[link] ? { ...document,
        verificationMethods: document.verificationMethods.map((method) => ({ ...method, purposes })) } : document;
    };
    await expect(new IdentityVerifier(f.config).verify(f.proof, { audience, nonce }))
      .rejects.toMatchObject({ code: 'invalid_proof', message: 'Signing key is not authorized for this identity verification purpose' });
  });

  it('fails closed when an authoritative method omits its purpose authorization', async () => {
    const f = await fixture();
    const resolve = f.config.resolveDid;
    f.config.resolveDid = async (did) => {
      const document = await resolve(did);
      if (document && did === f.leaf) {
        const malformed = JSON.parse(JSON.stringify(document));
        delete malformed.verificationMethods[0].purposes;
        return malformed;
      }
      return document;
    };
    await expect(new IdentityVerifier(f.config).verify(f.proof, { audience, nonce }))
      .rejects.toMatchObject({ code: 'invalid_proof', message: 'Signing key is not authorized for this identity verification purpose' });
  });

  it('rejects an arbitrary root without a real person/org owner authority', async () => {
    const f = await fixture();
    f.config.authorizeOwner = async () => null;
    await expect(new IdentityVerifier(f.config).verify(f.proof, { audience, nonce }))
      .rejects.toMatchObject({ code: 'untrusted_owner' });
  });

  it.each(['hmr', 'mhr', 'ao', 'enr'] as const)('accepts an approved signed %s owner root', async (kind) => {
    const f = await fixture('EdDSA', false, kind);
    const result = await new IdentityVerifier(f.config).verify(f.proof, { audience, nonce });
    expect(result.owner).toEqual(owner);
    expect(result.lineage[0]).toBe(f.root);
  });

  it('rejects an agent as the owner root even when an overly broad callback approves it', async () => {
    const f = await fixture('EdDSA', false, 'agent');
    await expect(new IdentityVerifier(f.config).verify(f.proof, { audience, nonce }))
      .rejects.toMatchObject({ code: 'untrusted_owner' });
  });

  it('rejects an incomplete chain and an authoritative document for another DID', async () => {
    const f = await fixture();
    await expect(new IdentityVerifier(f.config).verify({ ...f.proof, delegations: f.proof.delegations.slice(1) },
      { audience, nonce })).rejects.toMatchObject({ code: 'untrusted_owner' });
    const resolve = f.config.resolveDid;
    f.config.resolveDid = async (did) => {
      const document = await resolve(did);
      return document ? { ...document, did: f.root } : null;
    };
    await expect(new IdentityVerifier(f.config).verify(f.proof, { audience, nonce }))
      .rejects.toMatchObject({ code: 'invalid_proof' });
  });

  it.each(['root', 'parent', 'leaf'] as const)('rejects revocation of the %s identity', async (link) => {
    const f = await fixture();
    f.revoked.add(f[link]);
    await expect(new IdentityVerifier(f.config).verify(f.proof, { audience, nonce }))
      .rejects.toMatchObject({ code: 'revoked' });
  });

  it('checks delegation and possession credential revocation independently of DID status', async () => {
    const f = await fixture();
    f.revoked.add(decodeJwt(f.proof.delegations[0]!).jti!);
    await expect(new IdentityVerifier(f.config).verify(f.proof, { audience, nonce }))
      .rejects.toMatchObject({ code: 'revoked' });
    f.revoked.clear();
    f.revoked.add(decodeJwt(f.proof.token).jti!);
    await expect(new IdentityVerifier(f.config).verify(f.proof, { audience, nonce }))
      .rejects.toMatchObject({ code: 'revoked' });
  });

  it('refuses embedded request keys and symmetric algorithm confusion', async () => {
    const f = await fixture();
    const key = f.entries.find((entry) => entry.did === f.leaf)!;
    const payload = decodeJwt(f.proof.token);
    const embedded = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'EdDSA', kid: `${f.leaf}#signing`, typ: 'oaid-proof+jwt', jwk: key.jwk })
      .sign(key.privateKey);
    await expect(new IdentityVerifier(f.config).verify({ ...f.proof, token: embedded }, { audience, nonce }))
      .rejects.toMatchObject({ code: 'invalid_proof' });
    const symmetric = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256', kid: `${f.leaf}#signing`, typ: 'oaid-proof+jwt' })
      .sign(new Uint8Array(32).fill(42));
    await expect(new IdentityVerifier(f.config).verify({ ...f.proof, token: symmetric }, { audience, nonce }))
      .rejects.toMatchObject({ code: 'invalid_proof' });
  });

  it('fails closed for unavailable or stale revocation authority', async () => {
    const f = await fixture();
    const offline = new Error('Authority offline');
    f.config.checkRevocation = async () => { throw offline; };
    const refusal = await new IdentityVerifier(f.config).verify(f.proof, { audience, nonce }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(IdentityVerificationError);
    expect(refusal).toMatchObject({ code: 'authority_unavailable', message: 'Identity authority is unavailable' });
    expect((refusal as Error).cause).toBe(offline);
    f.config.checkRevocation = async () => ({ revoked: false, checkedAt: now - 61 });
    await expect(new IdentityVerifier(f.config).verify(f.proof, { audience, nonce }))
      .rejects.toMatchObject({ code: 'authority_unavailable' });
  });

  it('rejects expired, overlong and future possession proofs', async () => {
    const f = await fixture();
    for (const claims of [
      { iat: now - 100, nbf: now - 100, exp: now - 1 },
      { iat: now - 10, nbf: now - 10, exp: now + 1000 },
      { iat: now + 1, nbf: now + 1, exp: now + 30 },
    ]) {
      const token = await f.sign(f.leaf, f.leaf, 'oaid-proof+jwt', claims);
      await expect(new IdentityVerifier(f.config).verify({ ...f.proof, token }, { audience, nonce }))
        .rejects.toMatchObject({ code: 'invalid_proof' });
    }
  });

  it('rejects a delegation that extends parent lifetime', async () => {
    const f = await fixture();
    const extended = await f.sign(f.parent, f.leaf, 'oaid-delegation+jwt', { exp: now + 201 });
    await expect(new IdentityVerifier(f.config).verify({ ...f.proof,
      delegations: [f.proof.delegations[0]!, extended] }, { audience, nonce }))
      .rejects.toMatchObject({ code: 'invalid_proof' });
  });

  it('rejects wrong audience, nonce and array audience ambiguity', async () => {
    const f = await fixture();
    for (const options of [{ audience: 'https://other.example', nonce }, { audience, nonce: 'other-nonce' }]) {
      await expect(new IdentityVerifier(f.config).verify(f.proof, options)).rejects.toMatchObject({ code: 'invalid_proof' });
    }
    const token = await f.sign(f.leaf, f.leaf, 'oaid-proof+jwt', { aud: [audience, 'https://other.example'] });
    await expect(new IdentityVerifier(f.config).verify({ ...f.proof, token }, { audience, nonce }))
      .rejects.toMatchObject({ code: 'invalid_proof' });
  });

  it('atomically rejects reused proof and reused server challenge', async () => {
    const f = await fixture();
    const verifier = new IdentityVerifier(f.config);
    await verifier.verify(f.proof, { audience, nonce });
    await expect(verifier.verify(f.proof, { audience, nonce })).rejects.toMatchObject({ code: 'replayed' });
    const token = await f.sign(f.leaf, f.leaf, 'oaid-proof+jwt');
    await expect(verifier.verify({ ...f.proof, token }, { audience, nonce })).rejects.toMatchObject({ code: 'replayed' });
  });

  it('rechecks current signed chain and revocation at code redemption without possession replay', async () => {
    const f = await fixture();
    const verifier = new IdentityVerifier(f.config);
    await verifier.verify(f.proof, { audience, nonce });
    expect((await verifier.resolve(f.leaf, { audience })).lineage).toEqual([f.root, f.parent, f.leaf]);
    f.revoked.add(f.parent);
    await expect(verifier.resolve(f.leaf, { audience })).rejects.toMatchObject({ code: 'revoked' });
  });

  it('requires every trust authority and refuses resolve without an authoritative lineage source', async () => {
    expect(() => new IdentityVerifier({} as IdentityVerifierConfig)).toThrow(TypeError);
    const f = await fixture();
    expect(() => new IdentityVerifier({ ...f.config, maxDepth: 17 })).toThrow(TypeError);
    expect(() => new IdentityVerifier({ ...f.config, maxDepth: 0 })).toThrow(TypeError);
    delete f.config.resolveDelegations;
    await expect(new IdentityVerifier(f.config).resolve(f.leaf, { audience }))
      .rejects.toMatchObject({ code: 'authority_unavailable' });
  });
});

describe('authoritatively registered self-root identities', () => {
  it.each(['EdDSA', 'RS256'] as const)('verifies %s direct possession with a current grant and no human owner', async (algorithm) => {
    const f = await selfFixture(algorithm);
    const grant = f.authorizations.get(f.root)!;
    const identity = await new IdentityVerifier(f.config).verify(f.direct, { audience, nonce });
    expect(identity).toEqual({ did: f.root, owner: null, root: { kind: 'self', did: f.root,
      authorizationId: grant.authorizationId, revision: grant.revision }, lineage: [f.root], expiresAt: now + 100 });
    expect(f.checks).toContainEqual({ did: f.root });
    expect(f.checks).toContainEqual({ did: f.root, credentialId: grant.authorizationId });
    expect(f.checks).toContainEqual({ did: f.root, issuerDid: f.root, credentialId: decodeJwt(f.direct.token).jti });
  });

  it('preserves exact legacy self-root and descendant DIDs with real signed delegations', async () => {
    const f = await selfFixture('EdDSA', true);
    const identity = await new IdentityVerifier(f.config).verify(f.proof, { audience, nonce });
    expect(identity.did).toBe(f.leaf);
    expect(identity.owner).toBeNull();
    expect(identity.root).toMatchObject({ kind: 'self', did: f.root });
    expect(identity.lineage).toEqual([f.root, f.parent, f.leaf]);
  });

  it('denies empty-chain possession by default and ignores caller-declared self-root metadata', async () => {
    const f = await selfFixture();
    delete f.config.authorizeSelfRoot;
    const callerClaim = { ...f.direct, owner: null, root: { kind: 'self', did: f.root,
      authorizationId: randomUUID(), revision: randomUUID() } };
    await expect(new IdentityVerifier(f.config).verify(callerClaim, { audience, nonce }))
      .rejects.toMatchObject({ code: 'untrusted_owner' });
  });

  it('never falls back from denied LifeID ownership to an overbroad self-root authority', async () => {
    const f = await fixture();
    f.config.authorizeOwner = async () => null;
    f.config.authorizeSelfRoot = async () => { throw new Error('Human roots cannot use self authority'); };
    await expect(new IdentityVerifier(f.config).verify(f.proof, { audience, nonce }))
      .rejects.toMatchObject({ code: 'untrusted_owner' });
  });

  it.each([
    ['another DID', { did: 'did:oas:openagent:agent:other' }, 'untrusted_owner'],
    ['another audience', { audience: 'https://other.example' }, 'untrusted_owner'],
    ['blank authorization', { authorizationId: ' ' }, 'untrusted_owner'],
    ['oversized authorization', { authorizationId: 'a'.repeat(513) }, 'untrusted_owner'],
    ['blank revision', { revision: '' }, 'untrusted_owner'],
    ['oversized revision', { revision: 'r'.repeat(513) }, 'untrusted_owner'],
    ['future issuance', { issuedAt: now + 1, notBefore: now + 1 }, 'untrusted_owner'],
    ['inactive registration', { notBefore: now + 1 }, 'untrusted_owner'],
    ['expired registration', { expiresAt: now }, 'untrusted_owner'],
    ['fractional expiry', { expiresAt: now + 0.5 }, 'untrusted_owner'],
    ['inverted lifetime', { issuedAt: now - 10, notBefore: now - 20 }, 'untrusted_owner'],
    ['check before registration', { checkedAt: now - 21 }, 'untrusted_owner'],
    ['stale authority', { issuedAt: now - 120, notBefore: now - 120, checkedAt: now - 61 }, 'authority_unavailable'],
    ['future authority check', { checkedAt: now + 1 }, 'authority_unavailable'],
  ] as const)('rejects a genuine signed proof with %s grant state', async (_label, changes, code) => {
    const f = await selfFixture();
    f.authorizations.set(f.root, { ...f.authorizations.get(f.root)!, ...changes });
    await expect(new IdentityVerifier(f.config).verify(f.direct, { audience, nonce })).rejects.toMatchObject({ code });
  });

  it('denies withdrawn or unavailable authoritative registrations', async () => {
    const f = await selfFixture();
    f.authorizations.delete(f.root);
    await expect(new IdentityVerifier(f.config).verify(f.direct, { audience, nonce }))
      .rejects.toMatchObject({ code: 'untrusted_owner' });
    f.config.authorizeSelfRoot = async () => { throw new Error('Authority offline'); };
    await expect(new IdentityVerifier(f.config).verify(f.direct, { audience, nonce }))
      .rejects.toMatchObject({ code: 'authority_unavailable' });
  });

  it.each(['root', 'authorization', 'proof', 'delegation', 'parent', 'leaf'] as const)
    ('rejects current %s revocation in a self-root hierarchy', async (kind) => {
      const f = await selfFixture();
      const revoked = kind === 'authorization' ? f.authorizations.get(f.root)!.authorizationId :
        kind === 'proof' ? decodeJwt(f.direct.token).jti! :
        kind === 'delegation' ? decodeJwt(f.proof.delegations[0]!).jti! : f[kind];
      f.revoked.add(revoked);
      const proof = ['delegation', 'parent', 'leaf'].includes(kind) ? f.proof : f.direct;
      await expect(new IdentityVerifier(f.config).verify(proof, { audience, nonce }))
        .rejects.toMatchObject({ code: 'revoked' });
    });

  it('requires an authoritative importable authentication key even without a possession token', async () => {
    const f = await selfFixture();
    const resolve = f.config.resolveDid;
    for (const condition of ['missing', 'other-did', 'assertion-only', 'malformed-key', 'private-key', 'duplicate-kid']) {
      f.config.resolveDid = async (did) => {
        const document = await resolve(did);
        if (!document || did !== f.root) return document;
        if (condition === 'missing') return null;
        if (condition === 'other-did') return { ...document, did: f.leaf };
        const method = document.verificationMethods[0]!;
        if (condition === 'assertion-only') return { ...document,
          verificationMethods: [{ ...method, purposes: ['assertionMethod'] }] };
        if (condition === 'malformed-key') return { ...document,
          verificationMethods: [{ ...method, publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: 'bad' } }] };
        if (condition === 'private-key') return { ...document,
          verificationMethods: [{ ...method, publicKeyJwk: { ...method.publicKeyJwk, d: 'private' } }] };
        return { ...document, verificationMethods: [method, method] };
      };
      await expect(new IdentityVerifier(f.config).verifyLineage(f.root, [], { audience }))
        .rejects.toMatchObject({ code: 'invalid_proof' });
    }
  });

  it('preserves separately verified assertion evidence for an owned lineage', async () => {
    const f = await fixture();
    const resolve = f.config.resolveDid;
    f.config.resolveDid = async (did) => {
      const document = await resolve(did);
      return document && did === f.leaf ? { ...document, verificationMethods:
        document.verificationMethods.map((method) => ({ ...method, purposes: ['assertionMethod'] as const })) } : document;
    };
    expect((await new IdentityVerifier(f.config).verifyLineage(f.leaf, f.proof.delegations, { audience })).owner)
      .toEqual(owner);
    await expect(new IdentityVerifier(f.config).verify(f.proof, { audience, nonce }))
      .rejects.toMatchObject({ code: 'invalid_proof' });
  });

  it('requires capabilityDelegation authorization for a self-root signed descendant', async () => {
    const f = await selfFixture();
    const resolve = f.config.resolveDid;
    f.config.resolveDid = async (did) => {
      const document = await resolve(did);
      return document && did === f.root ? { ...document, verificationMethods:
        document.verificationMethods.map((method) => ({ ...method, purposes: ['authentication'] as const })) } : document;
    };
    await expect(new IdentityVerifier(f.config).verify(f.proof, { audience, nonce }))
      .rejects.toMatchObject({ code: 'invalid_proof' });
  });

  it('bounds proof and descendant lifetimes to the authoritative registration', async () => {
    const f = await selfFixture();
    const grant = f.authorizations.get(f.root)!;
    f.authorizations.set(f.root, { ...grant, expiresAt: now + 60 });
    await expect(new IdentityVerifier(f.config).verify(f.direct, { audience, nonce }))
      .rejects.toMatchObject({ code: 'invalid_proof' });
    f.authorizations.set(f.root, { ...grant, expiresAt: now + 150 });
    await expect(new IdentityVerifier(f.config).verify(f.proof, { audience, nonce }))
      .rejects.toMatchObject({ code: 'invalid_proof' });
    f.authorizations.set(f.root, grant);
    const predating = await f.sign(f.root, f.root, 'oaid-proof+jwt', { iat: now - 21, nbf: now - 21 });
    await expect(new IdentityVerifier(f.config).verify({ token: predating, delegations: [] }, { audience, nonce }))
      .rejects.toMatchObject({ code: 'invalid_proof' });
  });

  it('retains atomic nonce and JTI replay refusal under concurrent self-root possession', async () => {
    const f = await selfFixture();
    const verifier = new IdentityVerifier(f.config);
    const results = await Promise.allSettled([
      verifier.verify(f.direct, { audience, nonce }), verifier.verify(f.direct, { audience, nonce }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((result) => result.status === 'rejected');
    expect(failure).toMatchObject({ status: 'rejected', reason: { code: 'replayed' } });
    const freshToken = await f.sign(f.root, f.root, 'oaid-proof+jwt');
    await expect(verifier.verify({ token: freshToken, delegations: [] }, { audience, nonce }))
      .rejects.toMatchObject({ code: 'replayed' });
  });

  it('rechecks current zero-chain authority and binds policy revision without possession replay', async () => {
    const f = await selfFixture();
    const verifier = new IdentityVerifier(f.config);
    await verifier.verify(f.direct, { audience, nonce });
    expect((await verifier.resolve(f.root, { audience })).lineage).toEqual([f.root]);
    f.authorizations.set(f.root, { ...f.authorizations.get(f.root)!, revision: randomUUID() });
    expect((await verifier.resolve(f.root, { audience })).root).toMatchObject({
      kind: 'self', revision: f.authorizations.get(f.root)!.revision,
    });
    f.authorizations.delete(f.root);
    await expect(verifier.resolve(f.root, { audience })).rejects.toMatchObject({ code: 'untrusted_owner' });
  });

  it('exports strict verdict validation while preserving historical owned results', async () => {
    const f = await selfFixture();
    const self = await new IdentityVerifier(f.config).verifyLineage(f.root, [], { audience });
    expect(() => assertVerifiedIdentity(self, f.root, now)).not.toThrow();
    for (const changed of [
      { ...self, root: undefined }, { ...self, owner }, { ...self, root: { ...self.root, kind: 'lifeid' } },
      { ...self, root: { ...self.root, did: f.leaf } }, { ...self, root: { ...self.root, authorizationId: '' } },
      { ...self, root: { ...self.root, revision: ' ' } }, { ...self, expiresAt: now },
    ]) expect(() => assertVerifiedIdentity(changed, f.root, now)).toThrow();
    const owned = await fixture();
    const identity = await new IdentityVerifier(owned.config).verifyLineage(owned.leaf, owned.proof.delegations, { audience });
    const { root: _root, ...historical } = identity;
    expect(() => assertVerifiedIdentity(historical, owned.leaf, now)).not.toThrow();
    expect(() => assertVerifiedIdentity({ ...identity, owner: null }, owned.leaf, now)).toThrow();
  });
});
