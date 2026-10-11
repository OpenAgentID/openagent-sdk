import { randomUUID } from 'node:crypto';
import { decodeJwt, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  IdentityVerifier,
  type IdentityVerifierConfig,
  type RevocationCheck,
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
      return entry ? { did, verificationMethods: [{ id: `${did}#signing`, publicKeyJwk: entry.jwk }] } : null;
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

describe('IdentityVerifier real signed identity proofs', () => {
  it.each(['EdDSA', 'RS256'] as const)('verifies %s possession, full lineage and approved owner', async (algorithm) => {
    const f = await fixture(algorithm);
    const result = await new IdentityVerifier(f.config).verify(f.proof, { audience, nonce });
    expect(result).toEqual({ did: f.leaf, owner, lineage: [f.root, f.parent, f.leaf], expiresAt: now + 100 });
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
    f.config.checkRevocation = async () => { throw new Error('Authority offline'); };
    await expect(new IdentityVerifier(f.config).verify(f.proof, { audience, nonce }))
      .rejects.toMatchObject({ code: 'authority_unavailable' });
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
