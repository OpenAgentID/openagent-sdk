/**
 * Verified OATS evidence ingestion and the reference five-component algorithm.
 *
 * The proof adapter is mandatory: parsing a credential does not establish its
 * signature, owner, or revocation state. No unverified scoring API is exported.
 */
import { base58 } from '@scure/base';
import { IdentityVerifier, assertVerifiedIdentity as assertIdentityRoot, type IdentityVerifierConfig, type VerifiedAgentIdentity } from './identity-verification.js';
import type { JWK } from 'jose';
import { didSchema } from './config.js';

export const OATS_WEIGHTS = Object.freeze({
  SecurityAudit: 0.30,
  BenchmarkResult: 0.25,
  ExpertEndorsement: 0.20,
  PublisherBond: 0.15,
  CommunityReview: 0.10,
});

export type OatsEvidenceType = keyof typeof OATS_WEIGHTS;

/** An OAS VC; the adapter verifies its complete signed body and proof. */
export interface OatsCredential {
  readonly id: string;
  readonly issuer: string;
  readonly issuanceDate: string;
  readonly expirationDate?: string;
  readonly type: readonly string[];
  readonly oasAttestationType?: OatsEvidenceType;
  readonly credentialSubject: Readonly<Record<string, unknown>> & { readonly id: string };
  readonly proof: Readonly<Record<string, unknown>>;
  readonly [extension: string]: unknown;
}

export interface OatsVerificationContext {
  readonly credentialId: string;
  readonly issuerDid: string;
  readonly subjectDid: string;
  /** Time against which the scorer and adapter must validate current authority. */
  readonly now: string;
}

/** Return only after the exact credential signature and both identities pass. */
export interface VerifiedOatsEvidence {
  readonly credentialId: string;
  readonly issuerDid: string;
  readonly subjectDid: string;
  readonly signatureVerified: true;
  /** The submitted attestation ID was checked in the authoritative revocation source. */
  readonly credentialRevocationChecked: true;
  readonly issuer: VerifiedAgentIdentity;
  readonly subject: VerifiedAgentIdentity;
}

/**
 * Resolve keys from an authoritative source, verify the entire credential, and
 * verify current identity roots, signed lineage and revocation for issuer and subject. Never derive
 * trusted keys or owner bindings from the submitted credential itself.
 */
export type OatsEvidenceVerifier = (
  credential: OatsCredential,
  context: OatsVerificationContext,
) => Promise<VerifiedOatsEvidence>;

/** Keys already authorized for assertionMethod by the authoritative OAS resolver. */
export interface OatsIssuerAssertionDocument {
  readonly did: string;
  readonly assertionMethods: readonly {
    readonly id: string;
    readonly controller: string;
    readonly publicKeyJwk: JWK;
  }[];
}

export interface OatsEvidenceVerifierConfig {
  /** Fixed audience for authoritative owner-to-agent delegations. */
  readonly audience: string;
  readonly identity: IdentityVerifierConfig & {
    /** Authoritative signed owner chains, never taken from credential extensions. */
    resolveDelegations(did: string, audience: string): Promise<readonly string[]>;
  };
  /** Resolve assertion-authorized keys; verificationMethod alone does not grant this purpose. */
  resolveIssuerAssertionMethods(did: string): Promise<OatsIssuerAssertionDocument | null>;
}

export interface OatsScorerOptions {
  /** Explicit attester authorization policy, distinct from signature validity. */
  readonly trustedIssuers: readonly string[];
  readonly verifyEvidence: OatsEvidenceVerifier;
  /** Injectable clock for reproducible evaluation; defaults to the system clock. */
  readonly now?: () => Date;
}

export interface OatsComponentScore {
  readonly rawScore: number;
  readonly weight: number;
  readonly evidenceCount: number;
  readonly latestEvidence: string | null;
}

export interface OatsCompositeScore {
  readonly entityDid: string;
  readonly components: Readonly<Record<OatsEvidenceType, OatsComponentScore>>;
  readonly composite: number;
  readonly confidence: number;
  readonly evidenceCount: number;
  readonly computedAt: string;
}

export class OatsError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'OatsError';
  }
}

interface ParsedEvidence {
  readonly credential: OatsCredential;
  readonly type: OatsEvidenceType;
  readonly score: number;
  readonly issuedAt: number;
}

const DAY_MS = 86_400_000;
const HALF_LIFE_DAYS = 90;
const MAX_TOTAL_EVIDENCE = 100;
const MAX_BOND_AMOUNT = 200;
const MAX_BATCH_SIZE = 10_000;
const EVIDENCE_TYPES = Object.keys(OATS_WEIGHTS) as OatsEvidenceType[];
const UTC_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function fail(code: string, detail: string): never {
  throw new OatsError(`openagent/oats/${code}`, detail);
}

function requireDid(value: unknown, label: string): asserts value is string {
  if (!didSchema.safeParse(value).success) {
    fail('invalid-did', `${label} must be an OAS or readable legacy identity DID`);
  }
}

function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    fail('invalid-evidence', `${label} must be a nonempty string without surrounding whitespace`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('invalid-evidence', `${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function parseDate(value: unknown, label: string): number {
  if (typeof value !== 'string' || !UTC_DATE.test(value)) {
    return fail('invalid-time', `${label} must be an explicit UTC RFC3339 timestamp`);
  }
  const milliseconds = Date.parse(value);
  // Date.parse normalizes impossible dates (e.g. February 30); refuse them.
  const normalized = value.includes('.')
    ? value.replace(/\.(\d{1,3})Z$/, (_, digits: string) => `.${digits.padEnd(3, '0')}Z`)
    : value.replace(/Z$/, '.000Z');
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== normalized) {
    return fail('invalid-time', `${label} is not a valid UTC date`);
  }
  return milliseconds;
}

function boundedScore(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    return fail('invalid-score', `${label} must be a finite number in [0, 1]`);
  }
  return value;
}

function evidenceScore(subject: Record<string, unknown>, type: OatsEvidenceType): number {
  if (type === 'PublisherBond') {
    const amount = subject.bondAmount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return fail('invalid-score', 'PublisherBond bondAmount must be a finite positive SIGIL amount');
    }
    return Math.min(amount / MAX_BOND_AMOUNT, 1);
  }
  // Follow oats-oracle's preference order without falling through malformed values.
  for (const field of ['score', 'aggregateScore', 'result', 'confidence']) {
    if (!Object.hasOwn(subject, field)) continue;
    const value = subject[field];
    if (field === 'result' && typeof value === 'string') {
      if (value === 'pass') return 1;
      if (value === 'fail') return 0;
      if (value === 'partial' || value === 'warning') return 0.5;
      return fail('invalid-score', 'result must be pass, fail, partial, or warning');
    }
    return boundedScore(value, field);
  }
  return fail('invalid-score', 'credentialSubject must contain score, aggregateScore, result, or confidence');
}

function parseEvidence(value: unknown, entityDid: string, now: number): ParsedEvidence {
  const credential = record(value, 'credential');
  requireText(credential.id, 'credential.id');
  requireDid(credential.issuer, 'credential.issuer');
  const subject = record(credential.credentialSubject, 'credentialSubject');
  requireDid(subject.id, 'credentialSubject.id');
  if (subject.id !== entityDid) fail('subject-mismatch', 'credential subject must exactly equal the scored DID');
  const proof = record(credential.proof, 'proof');
  if (Object.keys(proof).length === 0) fail('invalid-evidence', 'credential proof must be present');
  if (!Array.isArray(credential.type) || !credential.type.every((type) => typeof type === 'string')) {
    fail('invalid-evidence', 'credential.type must be an array of strings');
  }
  const types = credential.type as string[];
  if (!types.includes('VerifiableCredential')) fail('invalid-evidence', 'credential.type must include VerifiableCredential');
  const recognized = new Set<OatsEvidenceType>();
  for (const type of types) {
    const candidate = type.endsWith('Credential') ? type.slice(0, -'Credential'.length) : type;
    if (EVIDENCE_TYPES.includes(candidate as OatsEvidenceType)) recognized.add(candidate as OatsEvidenceType);
  }
  for (const declared of [credential.oasAttestationType, subject.attestationType]) {
    if (declared === undefined) continue;
    if (typeof declared !== 'string' || !EVIDENCE_TYPES.includes(declared as OatsEvidenceType)) {
      fail('invalid-evidence', 'unsupported OATS attestation type');
    }
    recognized.add(declared as OatsEvidenceType);
  }
  if (recognized.size !== 1) fail('invalid-evidence', 'credential must name exactly one OATS evidence type');
  const type = [...recognized][0]!;
  const issuedAt = parseDate(credential.issuanceDate, 'issuanceDate');
  if (issuedAt > now) fail('invalid-time', 'future evidence is not accepted');
  if (credential.expirationDate !== undefined) {
    const expiresAt = parseDate(credential.expirationDate, 'expirationDate');
    if (expiresAt <= issuedAt || expiresAt <= now) fail('invalid-time', 'credential is expired or has an invalid expiration window');
  }
  return { credential: credential as unknown as OatsCredential, type, score: evidenceScore(subject, type), issuedAt };
}

function assertVerifiedIdentity(identity: VerifiedAgentIdentity, did: string, now: number): void {
  try {
    assertIdentityRoot(identity, did, Math.floor(now / 1000));
  } catch {
    fail('verification-failed', 'verified identity or current trust root does not match evidence');
  }
}

/** Freeze a detached JSON snapshot so verification cannot mutate scored claims. */
function snapshot(value: unknown): unknown {
  function copy(current: unknown, depth: number): unknown {
    if (depth > 32) return fail('invalid-evidence', 'credential nesting exceeds the supported limit');
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return current;
    if (typeof current === 'number' && Number.isFinite(current)) return current;
    if (Array.isArray(current)) return Object.freeze(current.map((item) => copy(item, depth + 1)));
    if (current && typeof current === 'object' && Object.getPrototypeOf(current) === Object.prototype) {
      return Object.freeze(Object.fromEntries(Object.entries(current).map(([key, item]) => [key, copy(item, depth + 1)])));
    }
    return fail('invalid-evidence', 'credential must contain finite JSON values only');
  }
  return copy(value, 0);
}

/** Reject lone surrogates as required by RFC 8785's valid Unicode boundary. */
function canonicalString(value: string): string {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail('invalid-evidence', 'JCS requires valid Unicode');
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail('invalid-evidence', 'JCS requires valid Unicode');
    }
  }
  return JSON.stringify(value);
}

/** RFC 8785: ECMAScript primitives and recursively sorted UTF-16 object keys. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value === 'string') return canonicalString(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const object = record(value, 'JCS value');
  return '{' + Object.keys(object).sort().map(key => canonicalString(key) + ':' + canonicalJson(object[key])).join(',') + '}';
}

/**
 * Concrete OAS Ed25519Signature2020 verifier. It verifies upstream JCS signing
 * bytes, assertion-authorized issuer keys, authoritative owner chains and
 * current attestation revocation. No cryptographic work is delegated to callers.
 */
export function createOatsEvidenceVerifier(config: OatsEvidenceVerifierConfig): OatsEvidenceVerifier {
  if (!config || typeof config.audience !== 'string' || config.audience.length === 0 || config.audience.length > 2048
    || !config.identity || typeof config.identity.resolveDelegations !== 'function'
    || typeof config.resolveIssuerAssertionMethods !== 'function') {
    fail('invalid-config', 'OAS evidence verification requires an audience and authoritative identity/assertion resolvers');
  }
  const verifier = new IdentityVerifier(config.identity);
  const maxRevocationAge = config.identity.maxRevocationAgeSeconds ?? 60;
  if (!Number.isSafeInteger(maxRevocationAge) || maxRevocationAge < 0 || maxRevocationAge > 300) {
    fail('invalid-config', 'OATS revocation freshness must be 0-300 seconds');
  }
  return async (input, context) => {
    const now = parseDate(context.now, 'verification time');
    const nowSeconds = Math.floor(now / 1000);
    const authorityNow = config.identity.now?.() ?? Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(authorityNow) || Math.abs(authorityNow - nowSeconds) > maxRevocationAge) {
      fail('verification-failed', 'OAS evidence evaluation time does not match current authority time');
    }
    const credential = parseEvidence(snapshot(input), context.subjectDid, now).credential;
    if (credential.id !== context.credentialId || credential.issuer !== context.issuerDid) {
      fail('verification-failed', 'OAS verifier context is not bound to the credential');
    }
    if (!Array.isArray(credential['@context']) || !credential['@context'].includes('https://www.w3.org/2018/credentials/v1')
      || !credential['@context'].includes('https://openagent.id/ns/attestation/v1')) {
      fail('verification-failed', 'OAS credential contexts are required');
    }
    const proof = credential.proof;
    if (proof.type !== 'Ed25519Signature2020' || proof.proofPurpose !== 'assertionMethod'
      || proof.cryptosuite !== undefined || typeof proof.verificationMethod !== 'string'
      || !proof.verificationMethod.startsWith(`${credential.issuer}#`)
      || typeof proof.proofValue !== 'string' || !proof.proofValue.startsWith('z')
      || proof.proofValue.length > 100) {
      fail('verification-failed', 'Unsupported or malformed OAS attestation proof');
    }
    if (parseDate(proof.created, 'proof.created') !== parseDate(credential.issuanceDate, 'issuanceDate')) {
      fail('verification-failed', 'OAS proof creation time must equal its signed issuance date');
    }
    const document = await config.resolveIssuerAssertionMethods(credential.issuer);
    if (!document || document.did !== credential.issuer || !Array.isArray(document.assertionMethods)
      || document.assertionMethods.length === 0 || document.assertionMethods.length > 32) {
      fail('verification-failed', 'Authoritative issuer assertion keys are missing or mismatched');
    }
    const methods = document.assertionMethods.filter(method => method.id === proof.verificationMethod);
    if (methods.length !== 1 || methods[0]!.controller !== credential.issuer) {
      fail('verification-failed', 'Issuer proof key is not a uniquely bound assertionMethod');
    }
    const key = methods[0]!.publicKeyJwk;
    if (!key || typeof key !== 'object' || key.kty !== 'OKP' || key.crv !== 'Ed25519'
      || ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some(field => Object.hasOwn(key, field))
      || (key.alg !== undefined && key.alg !== 'EdDSA') || (key.use !== undefined && key.use !== 'sig')
      || (key.key_ops !== undefined && (!Array.isArray(key.key_ops) || !key.key_ops.includes('verify')))) {
      fail('verification-failed', 'Authoritative assertion key must be a public Ed25519 verification key');
    }
    const signature = base58.decode(proof.proofValue.slice(1));
    if (signature.length !== 64) fail('verification-failed', 'OAS Ed25519 proof must be a 64-byte signature');
    const { proof: _proof, ...body } = credential;
    const bytes = new TextEncoder().encode(canonicalJson(body));
    const crypto = globalThis.crypto?.subtle;
    if (!crypto) fail('verification-failed', 'WebCrypto is required for OAS attestation verification');
    const publicKey = await crypto.importKey('jwk', key, { name: 'Ed25519' }, false, ['verify']);
    if (!await crypto.verify('Ed25519', publicKey, Uint8Array.from(signature), bytes)) {
      fail('verification-failed', 'OAS attestation signature is invalid');
    }
    // resolve() loads the current signed chain from the configured authority.
    // Credential-provided issuerDelegations/subjectDelegations are ignored.
    const issuer = await verifier.resolve(credential.issuer, { audience: config.audience });
    const subject = await verifier.resolve(context.subjectDid, { audience: config.audience });
    assertVerifiedIdentity(issuer, credential.issuer, now);
    assertVerifiedIdentity(subject, context.subjectDid, now);
    const state = await config.identity.checkRevocation({ did: context.subjectDid,
      issuerDid: credential.issuer, credentialId: credential.id });
    if (!state || typeof state.revoked !== 'boolean' || !Number.isSafeInteger(state.checkedAt) || state.checkedAt < 0
      || state.checkedAt > authorityNow || authorityNow - state.checkedAt > maxRevocationAge || state.revoked) {
      fail('verification-failed', 'Attestation is revoked or its authority is unavailable/stale');
    }
    return Object.freeze({ credentialId: credential.id, issuerDid: credential.issuer, subjectDid: context.subjectDid,
      signatureVerified: true as const, credentialRevocationChecked: true as const, issuer, subject });
  };
}

export class VerifiedOatsScorer {
  private readonly trustedIssuers: ReadonlySet<string>;
  private readonly verifyEvidence: OatsEvidenceVerifier;
  private readonly now: () => Date;

  constructor(options: OatsScorerOptions) {
    if (!options || typeof options.verifyEvidence !== 'function' || !Array.isArray(options.trustedIssuers)
      || options.trustedIssuers.length === 0) {
      fail('invalid-config', 'OATS requires a verification adapter and explicit trusted issuers');
    }
    for (const issuer of options.trustedIssuers) requireDid(issuer, 'trusted issuer');
    this.trustedIssuers = new Set(options.trustedIssuers);
    this.verifyEvidence = options.verifyEvidence;
    this.now = options.now ?? (() => new Date());
  }

  /** Verify the complete batch, then return one score. Any rejection fails the batch. */
  async score(entityDid: string, credentials: readonly unknown[]): Promise<OatsCompositeScore> {
    requireDid(entityDid, 'entityDid');
    if (!Array.isArray(credentials) || credentials.length === 0 || credentials.length > MAX_BATCH_SIZE) {
      fail('invalid-evidence', `OATS requires 1-${MAX_BATCH_SIZE} credentials`);
    }
    const now = this.now().getTime();
    if (!Number.isFinite(now)) fail('invalid-time', 'evaluation clock is invalid');
    const computedAt = new Date(now).toISOString();
    const parsed = credentials.map((value) => parseEvidence(snapshot(value), entityDid, now));
    const ids = new Set<string>();
    for (const evidence of parsed) {
      const credential = evidence.credential;
      if (ids.has(credential.id)) fail('duplicate-evidence', 'a credential ID may contribute only once per batch');
      ids.add(credential.id);
      if (!this.trustedIssuers.has(credential.issuer)) fail('untrusted-issuer', 'attester is not authorized by the scoring policy');
    }
    for (const { credential } of parsed) {
      const context = Object.freeze({ credentialId: credential.id, issuerDid: credential.issuer, subjectDid: entityDid, now: computedAt });
      let verified: VerifiedOatsEvidence;
      try {
        verified = await this.verifyEvidence(credential, context);
      } catch {
        return fail('verification-failed', 'evidence signature, owner chain, or revocation verification failed');
      }
      if (!verified || verified.signatureVerified !== true || verified.credentialRevocationChecked !== true || verified.credentialId !== credential.id
        || verified.issuerDid !== credential.issuer || verified.subjectDid !== entityDid) {
        fail('verification-failed', 'verification result is not bound to the submitted credential');
      }
      assertVerifiedIdentity(verified.issuer, credential.issuer, now);
      assertVerifiedIdentity(verified.subject, entityDid, now);
    }
    const components = {} as Record<OatsEvidenceType, OatsComponentScore>;
    let composite = 0;
    for (const type of EVIDENCE_TYPES) {
      const items = parsed.filter((item) => item.type === type);
      const latest = items.length ? Math.max(...items.map((item) => item.issuedAt)) : null;
      const average = items.length ? items.reduce((sum, item) => sum + item.score, 0) / items.length : 0;
      // Rust chrono::num_seconds truncates to whole seconds before converting to days.
      const ageDays = latest === null ? 0 : Math.floor((now - latest) / 1000) * 1000 / DAY_MS;
      const rawScore = average * Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
      const component = Object.freeze({ rawScore, weight: OATS_WEIGHTS[type], evidenceCount: items.length,
        latestEvidence: latest === null ? null : new Date(latest).toISOString() });
      components[type] = component;
      composite += rawScore * component.weight;
    }
    const confidence = 1 - Math.exp(Math.log(0.05) * parsed.length / MAX_TOTAL_EVIDENCE);
    return Object.freeze({ entityDid, components: Object.freeze(components), composite: Math.min(composite, 1),
      confidence, evidenceCount: parsed.length, computedAt });
  }
}

/** Both verified composite and confidence must meet the bounded thresholds. */
export function oatsMeetsThreshold(score: OatsCompositeScore, minimumComposite: number, minimumConfidence: number): boolean {
  boundedScore(minimumComposite, 'minimumComposite');
  boundedScore(minimumConfidence, 'minimumConfidence');
  boundedScore(score.composite, 'composite');
  boundedScore(score.confidence, 'confidence');
  return score.composite >= minimumComposite && score.confidence >= minimumConfidence;
}
