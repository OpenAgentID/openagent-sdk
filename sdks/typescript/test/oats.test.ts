import { describe, expect, it } from 'vitest';
import { createPrivateKey, sign } from 'node:crypto';
import { base58 } from '@scure/base';
import { exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import { IdentityVerifier, type IdentityVerifierConfig } from '../src/identity-verification.js';
import {
  OatsError,
  OATS_WEIGHTS,
  VerifiedOatsScorer,
  createOatsEvidenceVerifier,
  oatsMeetsThreshold,
  type OatsCredential,
  type OatsEvidenceType,
  type OatsEvidenceVerifier,
} from '../src/oats.js';

const ROOT = 'did:oas:test:hmr:owner';
const ISSUER = 'did:oas:test:agent:auditor';
const SUBJECT = 'did:oas:test:agent:subject';
const AUDIENCE = 'urn:openagentid:oats';
const NOW = Date.parse('2026-10-11T12:00:00Z');
const UNIX_NOW = NOW / 1000;

async function fixture() {
  // Every proof uses a newly generated keypair, including the owner OIDC token.
  const root = await generateKeyPair('EdDSA');
  const issuer = await generateKeyPair('EdDSA', { extractable: true });
  const subject = await generateKeyPair('EdDSA');
  const lifeId = await generateKeyPair('EdDSA');
  const keys = new Map([
    [ROOT, await exportJWK(root.publicKey)],
    [ISSUER, await exportJWK(issuer.publicKey)],
    [SUBJECT, await exportJWK(subject.publicKey)],
  ]);
  const revokedDids = new Set<string>();
  const revokedCredentials = new Set<string>();
  let ownerActive = true;
  let checks = 0;
  const ownerToken = await new SignJWT({}).setProtectedHeader({ alg: 'EdDSA' })
    .setIssuer('https://auth.life.one').setSubject('signed-test-owner').setAudience(AUDIENCE)
    .setIssuedAt(UNIX_NOW - 10).setExpirationTime(UNIX_NOW + 3600).sign(lifeId.privateKey);
  const identityConfig: IdentityVerifierConfig = {
    resolveDid: async (did) => {
      const publicKeyJwk = keys.get(did);
      return publicKeyJwk ? { did, verificationMethods: [{ id: `${did}#signing`, publicKeyJwk,
        purposes: did === ROOT ? ['capabilityDelegation'] as const : ['assertionMethod'] as const }] } : null;
    },
    authorizeOwner: async (did) => {
      if (did !== ROOT || !ownerActive) return null;
      const { payload } = await jwtVerify(ownerToken, lifeId.publicKey, {
        issuer: 'https://auth.life.one', audience: AUDIENCE, algorithms: ['EdDSA'], currentDate: new Date(NOW),
      });
      return { issuer: payload.iss!, subject: payload.sub! };
    },
    checkRevocation: async ({ did, credentialId }) => ({
      revoked: revokedDids.has(did) || (credentialId !== undefined && revokedCredentials.has(credentialId)),
      checkedAt: UNIX_NOW,
    }),
    // OATS uses verifyLineage; it never invokes possession or its replay store.
    replay: { consume: async () => { throw new Error('OATS must not consume a possession challenge'); } },
    now: () => UNIX_NOW,
  };
  const verifier = new IdentityVerifier(identityConfig);
  async function delegation(child: string, id: string) {
    return new SignJWT({}).setProtectedHeader({ alg: 'EdDSA', typ: 'oaid-delegation+jwt', kid: `${ROOT}#signing` })
      .setIssuer(ROOT).setSubject(child).setAudience(AUDIENCE).setJti(id)
      .setIssuedAt(UNIX_NOW - 60).setNotBefore(UNIX_NOW - 60).setExpirationTime(UNIX_NOW + 3600).sign(root.privateKey);
  }
  const issuerChain = [await delegation(ISSUER, 'issuer-delegation')];
  const subjectChain = [await delegation(SUBJECT, 'subject-delegation')];
  const resolveDelegations = async (did: string, audience: string): Promise<readonly string[]> => {
    if (audience !== AUDIENCE) throw new Error('Wrong owner-chain audience');
    if (did === ISSUER) return issuerChain;
    if (did === SUBJECT) return subjectChain;
    throw new Error('Unknown owner chain');
  };
  identityConfig.resolveDelegations = resolveDelegations;
  const verifyEvidence: OatsEvidenceVerifier = async (credential, context) => {
    checks++;
    const { payload } = await jwtVerify(credential.proof.jws as string, issuer.publicKey, {
      issuer: context.issuerDid, subject: context.subjectDid, audience: AUDIENCE,
      algorithms: ['EdDSA'], typ: 'oas-attestation+jwt', currentDate: new Date(context.now),
    });
    const { proof: _proof, ...signedBody } = credential;
    if (JSON.stringify(payload.vc) !== JSON.stringify(signedBody) || payload.jti !== credential.id) {
      throw new Error('Credential differs from its signed body');
    }
    if (revokedCredentials.has(credential.id)) throw new Error('Attestation was revoked');
    const verifiedIssuer = await verifier.verifyLineage(context.issuerDid, credential.issuerDelegations as string[], { audience: AUDIENCE });
    const verifiedSubject = await verifier.verifyLineage(context.subjectDid, credential.subjectDelegations as string[], { audience: AUDIENCE });
    return { credentialId: credential.id, issuerDid: context.issuerDid, subjectDid: context.subjectDid,
      signatureVerified: true, credentialRevocationChecked: true, issuer: verifiedIssuer, subject: verifiedSubject };
  };
  let sequence = 0;
  async function credential(type: OatsEvidenceType, fields: Record<string, unknown> = { score: 1 },
    overrides: Record<string, unknown> = {}): Promise<OatsCredential> {
    const body = {
      id: `urn:oaid:oats:test:${++sequence}`,
      issuer: ISSUER,
      type: ['VerifiableCredential', `${type}Credential`],
      issuanceDate: new Date(NOW).toISOString(),
      credentialSubject: { id: SUBJECT, ...fields },
      issuerDelegations: issuerChain,
      subjectDelegations: subjectChain,
      ...overrides,
    };
    const jws = await new SignJWT({ vc: body }).setProtectedHeader({ alg: 'EdDSA', typ: 'oas-attestation+jwt' })
      .setIssuer(body.issuer).setSubject(body.credentialSubject.id).setAudience(AUDIENCE).setJti(body.id)
      .setIssuedAt(UNIX_NOW - 60).setExpirationTime(UNIX_NOW + 3600).sign(issuer.privateKey);
    return { ...body, proof: { type: 'JsonWebSignature2020', jws } } as OatsCredential;
  }
  const scorer = new VerifiedOatsScorer({ trustedIssuers: [ISSUER], verifyEvidence, now: () => new Date(NOW) });
  return { scorer, credential, verifyEvidence, revokedDids, revokedCredentials,
    identityConfig: { ...identityConfig, resolveDelegations }, publicIssuerJwk: keys.get(ISSUER)!,
    privateIssuerJwk: await exportJWK(issuer.privateKey),
    deactivateOwner: () => { ownerActive = false; }, checks: () => checks };
}

/** Independently sign explicitly ordered JCS bytes using Node's Ed25519. */
function signedOasCredential(privateJwk: Awaited<ReturnType<typeof exportJWK>>, id = 'urn:oaid:oats:concrete:1'): OatsCredential {
  // This literal's insertion order is the expected UTF-16 JCS order. The
  // verifier receives a differently ordered object, so its serialization
  // cannot accidentally pass by relying on the signer's insertion order.
  const signedBody = {
    '@context': ['https://www.w3.org/2018/credentials/v1', 'https://openagent.id/ns/attestation/v1'],
    credentialSubject: { id: SUBJECT, score: 0.85 },
    id,
    issuanceDate: new Date(NOW).toISOString(),
    issuer: ISSUER,
    type: ['VerifiableCredential', 'SecurityAuditCredential'],
  };
  const signature = sign(null, Buffer.from(JSON.stringify(signedBody)), createPrivateKey({ key: privateJwk, format: 'jwk' }));
  return {
    type: signedBody.type, issuer: signedBody.issuer, issuanceDate: signedBody.issuanceDate,
    id: signedBody.id, credentialSubject: { score: 0.85, id: SUBJECT }, '@context': signedBody['@context'],
    proof: { type: 'Ed25519Signature2020', proofPurpose: 'assertionMethod', verificationMethod: `${ISSUER}#signing`,
      created: signedBody.issuanceDate, proofValue: 'z' + base58.encode(signature) },
  };
}

describe('concrete OAS evidence verification', () => {
  async function setup() {
    const f = await fixture();
    const config = {
      audience: AUDIENCE,
      identity: f.identityConfig,
      resolveIssuerAssertionMethods: async (did: string) => did === ISSUER ? { did,
        assertionMethods: [{ id: `${did}#signing`, controller: did, publicKeyJwk: f.publicIssuerJwk }] } : null,
    };
    const scorer = new VerifiedOatsScorer({ trustedIssuers: [ISSUER],
      verifyEvidence: createOatsEvidenceVerifier(config), now: () => new Date(NOW) });
    return { f, config, scorer, credential: signedOasCredential(f.privateIssuerJwk) };
  }

  it('verifies upstream Ed25519Signature2020 JCS bytes with real keypairs and authoritative chains', async () => {
    const { scorer, credential } = await setup();
    const score = await scorer.score(SUBJECT, [credential]);
    expect(score.components.SecurityAudit.rawScore).toBe(0.85);
    expect(score.composite).toBeCloseTo(0.255, 12);
  });

  it('refuses a signed-body alteration or actual invalid signature', async () => {
    const { scorer, credential } = await setup();
    await expect(scorer.score(SUBJECT, [{ ...credential, credentialSubject: { id: SUBJECT, score: 0.9 } }]))
      .rejects.toMatchObject({ code: 'openagent/oats/verification-failed' });
    const bytes = base58.decode((credential.proof.proofValue as string).slice(1));
    bytes[0] = bytes[0]! ^ 1;
    await expect(scorer.score(SUBJECT, [{ ...credential, proof: { ...credential.proof, proofValue: 'z' + base58.encode(bytes) } }]))
      .rejects.toMatchObject({ code: 'openagent/oats/verification-failed' });
  });

  it('refuses assertion-key mismatch, wrong key purpose and proof time/type substitutions', async () => {
    const { scorer, credential, config } = await setup();
    for (const proof of [
      { ...credential.proof, type: 'DataIntegrityProof', cryptosuite: 'eddsa-2022' },
      { ...credential.proof, proofPurpose: 'authentication' },
      { ...credential.proof, created: '2026-10-11T11:59:59Z' },
      { ...credential.proof, verificationMethod: `${SUBJECT}#signing` },
    ]) {
      await expect(scorer.score(SUBJECT, [{ ...credential, proof }])).rejects.toMatchObject({ code: 'openagent/oats/verification-failed' });
    }
    config.resolveIssuerAssertionMethods = async () => null;
    await expect(scorer.score(SUBJECT, [credential])).rejects.toMatchObject({ code: 'openagent/oats/verification-failed' });
  });

  it.each(['ancestor', 'attestation', 'owner'] as const)('checks current %s authority rather than trusting the signed claims', async kind => {
    const { scorer, credential, f } = await setup();
    if (kind === 'ancestor') f.revokedDids.add(ROOT);
    if (kind === 'attestation') f.revokedCredentials.add(credential.id);
    if (kind === 'owner') f.deactivateOwner();
    await expect(scorer.score(SUBJECT, [credential])).rejects.toMatchObject({ code: 'openagent/oats/verification-failed' });
  });

  it('loads signed chains from the authority instead of request-controlled lineage extensions', async () => {
    const { scorer, credential } = await setup();
    // Adding even untrusted lineage extensions changes the signed VC body.
    await expect(scorer.score(SUBJECT, [{ ...credential, issuerDelegations: ['forged'] }]))
      .rejects.toMatchObject({ code: 'openagent/oats/verification-failed' });
    // The valid credential needs no submitted chains; the authority owns them.
    expect((await scorer.score(SUBJECT, [credential])).evidenceCount).toBe(1);
  });
});

describe('verified OATS ingestion', () => {
  it('requires a verifier and explicit attester authorization', () => {
    expect(() => new VerifiedOatsScorer({ trustedIssuers: [], verifyEvidence: async () => { throw new Error(); } })).toThrow(OatsError);
    expect(() => new VerifiedOatsScorer({ trustedIssuers: [ISSUER] } as never)).toThrow(OatsError);
  });

  it('verifies real owner/lineage/attestation signatures and reproduces all five reference weights', async () => {
    const f = await fixture();
    const credentials = await Promise.all([
      f.credential('SecurityAudit', { score: 0.9 }),
      f.credential('BenchmarkResult', { score: 0.8 }),
      f.credential('ExpertEndorsement', { confidence: 0.7 }),
      f.credential('PublisherBond', { bondAmount: 120 }),
      f.credential('CommunityReview', { aggregateScore: 0.5 }),
    ]);
    const score = await f.scorer.score(SUBJECT, credentials);
    expect(score.composite).toBeCloseTo(0.75, 12);
    expect(score.confidence).toBeCloseTo(1 - Math.exp(Math.log(0.05) * 5 / 100), 12);
    expect(score.components.PublisherBond.rawScore).toBe(0.6);
    expect(score.components.SecurityAudit.weight).toBe(OATS_WEIGHTS.SecurityAudit);
    expect(score.evidenceCount).toBe(5);
    expect(f.checks()).toBe(5);
    expect(oatsMeetsThreshold(score, 0.7, 0.1)).toBe(true);
    expect(oatsMeetsThreshold(score, 0.8, 0.1)).toBe(false);
    expect(Object.isFrozen(score.components)).toBe(true);
  });

  it('averages per component and applies 90-day decay to its latest evidence, as Rust does', async () => {
    const f = await fixture();
    const old = new Date(NOW - 90 * 86_400_000).toISOString();
    const older = new Date(NOW - 180 * 86_400_000).toISOString();
    const score = await f.scorer.score(SUBJECT, [
      await f.credential('SecurityAudit', { score: 1 }, { issuanceDate: old }),
      await f.credential('SecurityAudit', { score: 0.6 }, { issuanceDate: older }),
    ]);
    expect(score.components.SecurityAudit.rawScore).toBeCloseTo(0.4, 12);
    expect(score.composite).toBeCloseTo(0.12, 12);
    expect(score.components.SecurityAudit.latestEvidence).toBe(old);
    expect(score.components.CommunityReview.rawScore).toBe(0);
  });

  it('matches the Rust 100-evidence confidence calibration', async () => {
    const f = await fixture();
    const credentials = await Promise.all(Array.from({ length: 100 }, () => f.credential('SecurityAudit')));
    const score = await f.scorer.score(SUBJECT, credentials);
    expect(score.confidence).toBeCloseTo(0.95, 12);
  });

  it('matches capped authoritative bond conversion and refuses zero-confidence inflation', async () => {
    const f = await fixture();
    const score = await f.scorer.score(SUBJECT, [await f.credential('PublisherBond', { bondAmount: 400 })]);
    expect(score.components.PublisherBond.rawScore).toBe(1);
    expect(score.composite).toBe(0.15);
    for (const bondAmount of [0, -1]) {
      await expect(f.scorer.score(SUBJECT, [await f.credential('PublisherBond', { bondAmount })]))
        .rejects.toMatchObject({ code: 'openagent/oats/invalid-score' });
    }
  });

  it.each([['pass', 1], ['fail', 0], ['partial', 0.5], ['warning', 0.5]] as const)('maps signed result %s to %s', async (result, expected) => {
    const f = await fixture();
    const score = await f.scorer.score(SUBJECT, [await f.credential('SecurityAudit', { result })]);
    expect(score.components.SecurityAudit.rawScore).toBe(expected);
  });

  it('rejects modified bodies and invalid real signatures', async () => {
    const f = await fixture();
    const credential = await f.credential('SecurityAudit');
    await expect(f.scorer.score(SUBJECT, [{ ...credential, credentialSubject: { id: SUBJECT, score: 0.2 } }]))
      .rejects.toMatchObject({ code: 'openagent/oats/verification-failed' });
    const pieces = (credential.proof.jws as string).split('.');
    pieces[2] = `${pieces[2]![0] === 'A' ? 'B' : 'A'}${pieces[2]!.slice(1)}`;
    await expect(f.scorer.score(SUBJECT, [{ ...credential, proof: { ...credential.proof, jws: pieces.join('.') } }]))
      .rejects.toMatchObject({ code: 'openagent/oats/verification-failed' });
  });

  it.each(['issuer', 'subject', 'owner', 'credential', 'delegation'] as const)('rejects current %s revocation or missing ownership', async (kind) => {
    const f = await fixture();
    const evidence = await f.credential('SecurityAudit');
    if (kind === 'issuer') f.revokedDids.add(ISSUER);
    if (kind === 'subject') f.revokedDids.add(SUBJECT);
    if (kind === 'owner') f.deactivateOwner();
    if (kind === 'credential') f.revokedCredentials.add(evidence.id);
    if (kind === 'delegation') f.revokedCredentials.add('issuer-delegation');
    await expect(f.scorer.score(SUBJECT, [evidence])).rejects.toMatchObject({ code: 'openagent/oats/verification-failed' });
  });

  it('rejects unauthorized attesters, exact DID mismatch and duplicate evidence before verifying', async () => {
    const f = await fixture();
    const evidence = await f.credential('SecurityAudit');
    await expect(f.scorer.score(SUBJECT, [{ ...evidence, issuer: 'did:oas:test:agent:other' }]))
      .rejects.toMatchObject({ code: 'openagent/oats/untrusted-issuer' });
    await expect(f.scorer.score('did:oas:test:agent:other', [evidence]))
      .rejects.toMatchObject({ code: 'openagent/oats/subject-mismatch' });
    await expect(f.scorer.score(SUBJECT, [evidence, evidence]))
      .rejects.toMatchObject({ code: 'openagent/oats/duplicate-evidence' });
    expect(f.checks()).toBe(0);
  });

  it.each([-0.1, 1.1, NaN, Infinity, '0.9', null])('rejects malformed scores %s without falling through to a valid lower-priority value', async (value) => {
    const f = await fixture();
    const evidence = await f.credential('SecurityAudit');
    await expect(f.scorer.score(SUBJECT, [{ ...evidence, credentialSubject: { id: SUBJECT, score: value, confidence: 0.8 } }]))
      .rejects.toBeInstanceOf(OatsError);
    expect(f.checks()).toBe(0);
  });

  it.each([undefined, 'invalid', '2026-02-30T00:00:00Z', '2026-10-11T12:00:01Z', '2026-10-11T12:00:00+00:00'])('rejects missing/invalid/non-UTC/future issuance %s', async (issuanceDate) => {
    const f = await fixture();
    const evidence = await f.credential('SecurityAudit');
    await expect(f.scorer.score(SUBJECT, [{ ...evidence, issuanceDate }])).rejects.toBeInstanceOf(OatsError);
    expect(f.checks()).toBe(0);
  });

  it('fails the complete batch when any evidence is expired, unsupported or malformed', async () => {
    const f = await fixture();
    const evidence = await f.credential('SecurityAudit');
    for (const invalid of [
      { ...evidence, id: 'expired', expirationDate: '2026-10-11T11:59:59Z' },
      { ...evidence, id: 'unsupported', type: ['VerifiableCredential', 'UnsupportedCredential'] },
      { ...evidence, id: 'ambiguous', type: ['VerifiableCredential', 'SecurityAuditCredential', 'BenchmarkResultCredential'] },
      { ...evidence, id: 'conflicting-declaration', oasAttestationType: 'SecurityAudit',
        credentialSubject: { ...evidence.credentialSubject, attestationType: 'BenchmarkResult' } },
      { ...evidence, id: 'no-proof', proof: {} },
    ]) {
      await expect(f.scorer.score(SUBJECT, [evidence, invalid])).rejects.toBeInstanceOf(OatsError);
    }
    expect(f.checks()).toBe(0);
  });

  it('rejects verifier result binding mismatches and prevents mutation of signed claims', async () => {
    const f = await fixture();
    const evidence = await f.credential('SecurityAudit');
    const wrong = new VerifiedOatsScorer({ trustedIssuers: [ISSUER], now: () => new Date(NOW),
      verifyEvidence: async (credential, context) => ({ ...(await f.verifyEvidence(credential, context)), subjectDid: ISSUER }) });
    await expect(wrong.score(SUBJECT, [evidence])).rejects.toMatchObject({ code: 'openagent/oats/verification-failed' });
    const mutator = new VerifiedOatsScorer({ trustedIssuers: [ISSUER], now: () => new Date(NOW),
      verifyEvidence: async (credential, context) => {
        (credential.credentialSubject as Record<string, unknown>).score = 0;
        return f.verifyEvidence(credential, context);
      } });
    await expect(mutator.score(SUBJECT, [evidence])).rejects.toMatchObject({ code: 'openagent/oats/verification-failed' });
    expect(evidence.credentialSubject.score).toBe(1);
  });

  it('validates thresholds and rejects empty batches', async () => {
    const f = await fixture();
    await expect(f.scorer.score(SUBJECT, [])).rejects.toBeInstanceOf(OatsError);
    const score = await f.scorer.score(SUBJECT, [await f.credential('SecurityAudit')]);
    expect(() => oatsMeetsThreshold(score, NaN, 0)).toThrow(OatsError);
    expect(() => oatsMeetsThreshold(score, 0, 1.1)).toThrow(OatsError);
  });
});
