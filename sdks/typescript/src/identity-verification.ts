import {
  decodeJwt,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type JWK,
  type JWTPayload,
} from 'jose';
import { DID_REGEX, LEGACY_DID_REGEX } from './config.js';

export interface VerifiedOwner {
  readonly issuer: string;
  readonly subject: string;
  readonly organizationId?: string;
}

/** Current identity trust. This grants no application scopes or tenant access. */
export interface VerifiedAgentIdentity {
  readonly did: string;
  readonly owner: VerifiedOwner;
  /** Root owner DID first; authenticated agent DID last. */
  readonly lineage: readonly string[];
  /** Unix seconds; the shortest remaining signed credential lifetime. */
  readonly expiresAt: number;
}

export interface AgentIdentityProof {
  readonly token: string;
  /** Signed delegation JWTs ordered root owner to leaf agent. */
  readonly delegations: readonly string[];
}

export interface ResolvedIdentityDocument {
  readonly did: string;
  readonly verificationMethods: readonly {
    readonly id: string;
    readonly publicKeyJwk: JWK;
  }[];
}

export interface RevocationCheck {
  readonly did: string;
  readonly issuerDid?: string;
  readonly credentialId?: string;
}

export interface ReplayClaim {
  readonly issuer: string;
  readonly tokenId: string;
  readonly audience: string;
  readonly nonce: string;
  readonly expiresAt: number;
}

export interface IdentityVerifierConfig {
  /** Authoritative resolver. Request-provided keys and URLs are never trusted. */
  resolveDid(did: string): Promise<ResolvedIdentityDocument | null>;
  /** Confirm a real LifeID person/org and its current binding to this root DID. */
  authorizeOwner(rootDid: string): Promise<VerifiedOwner | null>;
  /** Query authoritative DID and (when supplied) credential revocation state. */
  checkRevocation(check: RevocationCheck): Promise<{ revoked: boolean; checkedAt: number }>;
  replay: {
    /** Atomically consume the issued nonce and unique issuer/tokenId until expiry. */
    consume(claim: ReplayClaim): Promise<boolean>;
  };
  /** Current authoritative signed lineage; required by resolve(), not verify(). */
  resolveDelegations?(did: string, audience: string): Promise<readonly string[]>;
  now?: () => number;
  maxProofAgeSeconds?: number;
  maxDelegationAgeSeconds?: number;
  maxRevocationAgeSeconds?: number;
  maxDepth?: number;
  clockToleranceSeconds?: number;
}

export interface VerifyIdentityOptions {
  readonly audience: string;
  /** Issued by the relying service; a caller's self-selected nonce is insufficient. */
  readonly nonce: string;
}

export type IdentityVerificationFailure =
  | 'invalid_proof'
  | 'untrusted_owner'
  | 'revoked'
  | 'replayed'
  | 'authority_unavailable';

export class IdentityVerificationError extends Error {
  override readonly name = 'IdentityVerificationError';
  constructor(readonly code: IdentityVerificationFailure, message: string) {
    super(message);
  }
}

function invalid(message: string): never {
  throw new IdentityVerificationError('invalid_proof', message);
}

function identifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length > 512 ||
      (!DID_REGEX.test(value) && !LEGACY_DID_REGEX.test(value))) {
    invalid(`Invalid ${label} DID`);
  }
}

function boundedString(value: unknown, label: string, max = 512): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    invalid(`Invalid ${label}`);
  }
}

function unixTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function ownerRecord(value: unknown): value is VerifiedOwner {
  if (!value || typeof value !== 'object') return false;
  const owner = value as Record<string, unknown>;
  if (typeof owner.issuer !== 'string' || owner.issuer.length > 2048 ||
      typeof owner.subject !== 'string' || !owner.subject || owner.subject.length > 512 ||
      (owner.organizationId !== undefined &&
       (typeof owner.organizationId !== 'string' || !owner.organizationId || owner.organizationId.length > 512))) {
    return false;
  }
  try {
    const issuer = new URL(owner.issuer);
    return issuer.protocol === 'https:' && !issuer.username && !issuer.password &&
      !issuer.search && !issuer.hash;
  } catch {
    return false;
  }
}

/** Signed possession, delegation, real owner authority and live revocation checks. */
export class IdentityVerifier {
  private readonly maxProofAge: number;
  private readonly maxDelegationAge: number;
  private readonly maxRevocationAge: number;
  private readonly maxDepth: number;
  private readonly tolerance: number;

  constructor(private readonly config: IdentityVerifierConfig) {
    if (!config || typeof config.resolveDid !== 'function' ||
        typeof config.authorizeOwner !== 'function' ||
        typeof config.checkRevocation !== 'function' ||
        typeof config.replay?.consume !== 'function') {
      throw new TypeError('Identity verification requires resolver, owner, revocation and replay authorities');
    }
    this.maxProofAge = config.maxProofAgeSeconds ?? 300;
    this.maxDelegationAge = config.maxDelegationAgeSeconds ?? 86_400;
    this.maxRevocationAge = config.maxRevocationAgeSeconds ?? 60;
    this.maxDepth = config.maxDepth ?? 16;
    this.tolerance = config.clockToleranceSeconds ?? 0;
    for (const value of [this.maxProofAge, this.maxDelegationAge, this.maxRevocationAge, this.maxDepth]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Identity verification limits must be positive integers');
    }
    if (this.maxDepth > 16) throw new TypeError('Identity verification supports at most 16 delegation links');
    if (!Number.isSafeInteger(this.tolerance) || this.tolerance < 0 || this.tolerance > 60) {
      throw new TypeError('Clock tolerance must be an integer between zero and 60 seconds');
    }
  }

  async verify(proof: AgentIdentityProof, options: VerifyIdentityOptions): Promise<VerifiedAgentIdentity> {
    if (!proof || typeof proof !== 'object') invalid('Identity proof is required');
    if (!Array.isArray(proof.delegations) || proof.delegations.length < 1 || proof.delegations.length > this.maxDepth) {
      invalid('A bounded signed delegation chain is required');
    }
    const token = proof.token;
    const delegations = [...proof.delegations];
    boundedString(options?.audience, 'audience', 2048);
    boundedString(options?.nonce, 'nonce');
    const audience = options.audience;
    const nonce = options.nonce;
    const unsigned = this.decode(token);
    identifier(unsigned.sub, 'agent');
    const now = this.now();
    const payload = await this.signed(token, unsigned.sub, unsigned.sub,
      audience, 'oaid-proof+jwt', this.maxProofAge, now);
    if (payload.nonce !== nonce || payload.kind !== 'agent') invalid('Agent kind or issued nonce mismatch');
    const identity = await this.lineage(unsigned.sub, delegations, audience, now);
    const leafGrant = this.decode(delegations.at(-1));
    if (payload.exp! > identity.expiresAt || payload.iat! < leafGrant.iat! || payload.nbf! < leafGrant.nbf!) {
      invalid('Possession proof exceeds its delegation lifetime');
    }
    await this.revocation({ did: identity.did, issuerDid: identity.did, credentialId: payload.jti! }, now);
    const consumed = await this.authority(() => this.config.replay.consume({
      issuer: identity.did,
      tokenId: payload.jti!,
      audience,
      nonce,
      expiresAt: payload.exp!,
    }));
    if (consumed !== true) throw new IdentityVerificationError('replayed', 'Possession proof or challenge was already consumed');
    if (payload.exp! <= this.now() || identity.expiresAt <= this.now()) invalid('Identity expired during verification');
    return { ...identity, expiresAt: Math.min(identity.expiresAt, payload.exp!) };
  }

  /** Verify lineage only. The caller must separately verify possession/evidence signature. */
  async verifyLineage(did: string, delegations: readonly string[], options: { audience: string }): Promise<VerifiedAgentIdentity> {
    boundedString(options?.audience, 'audience', 2048);
    if (!Array.isArray(delegations) || delegations.length < 1 || delegations.length > this.maxDepth) {
      invalid('A bounded signed delegation chain is required');
    }
    return this.lineage(did, [...delegations], options.audience, this.now());
  }

  /** Recheck current trust at code redemption/UserInfo without replaying possession. */
  async resolve(did: string, options: { audience: string }): Promise<VerifiedAgentIdentity> {
    identifier(did, 'agent');
    boundedString(options?.audience, 'audience', 2048);
    const resolver = this.config.resolveDelegations;
    if (!resolver) throw new IdentityVerificationError('authority_unavailable', 'Authoritative lineage resolver is required');
    const chain = await this.authority(() => resolver(did, options.audience));
    if (!Array.isArray(chain)) invalid('Signed delegation chain is required');
    return this.lineage(did, [...chain], options.audience, this.now());
  }

  private now(): number {
    const now = this.config.now?.() ?? Math.floor(Date.now() / 1000);
    if (!unixTime(now)) throw new TypeError('Verifier clock must return Unix seconds');
    return now;
  }

  private decode(token: unknown): JWTPayload {
    boundedString(token, 'compact signed token', 32_768);
    try {
      return decodeJwt(token);
    } catch {
      return invalid('Malformed compact signed token');
    }
  }

  private async lineage(did: string, delegations: readonly string[], audience: string, now: number): Promise<VerifiedAgentIdentity> {
    identifier(did, 'agent');
    if (!/:(?:agent|agent:instance):[A-Za-z0-9._-]+$/.test(did)) invalid('Subject is not an agent DID');
    if (!Array.isArray(delegations) || delegations.length < 1 || delegations.length > this.maxDepth) {
      invalid('A bounded signed owner delegation chain is required');
    }
    const first = this.decode(delegations[0]);
    identifier(first.iss, 'owner');
    if (!/:(?:hmr|mhr|ao|enr):[A-Za-z0-9._-]+$/.test(first.iss)) {
      throw new IdentityVerificationError('untrusted_owner', 'Delegation root must be a human or organization owner DID');
    }
    const owner = await this.authority(() => this.config.authorizeOwner(first.iss!));
    if (!ownerRecord(owner)) throw new IdentityVerificationError('untrusted_owner', 'Root is not an approved real person or organization owner');
    // Copy trusted authority output so later external mutation cannot change its binding.
    const approvedOwner: VerifiedOwner = {
      issuer: owner.issuer,
      subject: owner.subject,
      ...(owner.organizationId === undefined ? {} : { organizationId: owner.organizationId }),
    };
    let parent = first.iss;
    let parentExpiry = Number.MAX_SAFE_INTEGER;
    let parentIssuedAt = 0;
    let parentNotBefore = 0;
    const lineage = [parent];
    const credentialIds = new Set<string>();
    await this.revocation({ did: parent }, now);
    for (const token of delegations) {
      const unsigned = this.decode(token);
      identifier(unsigned.sub, 'delegated agent');
      if (lineage.includes(unsigned.sub)) invalid('Delegation cycle or repeated identity');
      const payload = await this.signed(token, parent, unsigned.sub, audience,
        'oaid-delegation+jwt', this.maxDelegationAge, now);
      if (payload.exp! > parentExpiry || payload.iat! < parentIssuedAt || payload.nbf! < parentNotBefore) {
        invalid('Delegation amplifies its parent lifetime');
      }
      const credentialKey = `${parent}\u0000${payload.jti!}`;
      if (credentialIds.has(credentialKey)) invalid('Repeated delegation credential');
      credentialIds.add(credentialKey);
      await this.revocation({ did: unsigned.sub, issuerDid: parent, credentialId: payload.jti! }, now);
      parent = unsigned.sub;
      parentExpiry = payload.exp!;
      parentIssuedAt = payload.iat!;
      parentNotBefore = payload.nbf!;
      lineage.push(parent);
    }
    if (parent !== did) invalid('Signed delegation chain does not end at the agent');
    // Resolving the leaf is necessary even when no possession token is verified here.
    await this.document(did);
    if (parentExpiry <= this.now()) invalid('Delegation expired during verification');
    return { did, owner: approvedOwner, lineage, expiresAt: parentExpiry };
  }

  private async document(did: string): Promise<ResolvedIdentityDocument> {
    const document = await this.authority(() => this.config.resolveDid(did));
    if (!document || document.did !== did || !Array.isArray(document.verificationMethods) ||
        document.verificationMethods.length === 0 || document.verificationMethods.length > 32) {
      invalid('Authoritative DID document is missing or mismatched');
    }
    return document;
  }

  private async signed(token: string, issuer: string, subject: string, audience: string,
    typ: string, maxAge: number, now: number): Promise<JWTPayload> {
    this.decode(token);
    const document = await this.document(issuer);
    try {
      const header = decodeProtectedHeader(token);
      if ((header.alg !== 'EdDSA' && header.alg !== 'RS256') ||
          typeof header.kid !== 'string' || !header.kid.startsWith(`${issuer}#`) ||
          header.jwk !== undefined || header.jku !== undefined || header.x5u !== undefined || header.x5c !== undefined) {
        invalid('Unsupported algorithm or untrusted key reference');
      }
      const methods = document.verificationMethods.filter((method) => method.id === header.kid);
      if (methods.length !== 1) invalid('Signing key is not uniquely bound to the authoritative DID');
      const jwk = methods[0]!.publicKeyJwk;
      if (!jwk || typeof jwk !== 'object' || ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k'].some((key) => key in jwk) ||
          (jwk.alg !== undefined && jwk.alg !== header.alg) || (jwk.use !== undefined && jwk.use !== 'sig') ||
          (jwk.key_ops !== undefined && !jwk.key_ops.includes('verify')) ||
          (header.alg === 'EdDSA' && (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519')) ||
          (header.alg === 'RS256' && jwk.kty !== 'RSA')) {
        invalid('Invalid authoritative signing key');
      }
      const key = await importJWK(jwk, header.alg);
      const { payload } = await jwtVerify(token, key, {
        algorithms: [header.alg], issuer, subject, audience, typ,
        currentDate: new Date(now * 1000), clockTolerance: this.tolerance,
        requiredClaims: ['iss', 'sub', 'aud', 'iat', 'nbf', 'exp', 'jti'],
      });
      if (payload.aud !== audience || !unixTime(payload.iat) || !unixTime(payload.nbf) || !unixTime(payload.exp) ||
          payload.iat > now + this.tolerance || payload.nbf < payload.iat || payload.nbf >= payload.exp ||
          payload.exp <= now || payload.exp <= payload.iat || payload.exp - payload.iat > maxAge ||
          now - payload.iat > maxAge + this.tolerance) {
        invalid('Invalid audience or credential time bounds');
      }
      boundedString(payload.jti, 'credential identifier');
      return payload;
    } catch (error) {
      if (error instanceof IdentityVerificationError) throw error;
      return invalid('Signature or signed claim verification failed');
    }
  }

  private async revocation(check: RevocationCheck, now: number): Promise<void> {
    const state = await this.authority(() => this.config.checkRevocation(check));
    const observedNow = Math.max(now, this.now());
    if (!state || typeof state.revoked !== 'boolean' || !unixTime(state.checkedAt) ||
        state.checkedAt > observedNow + this.tolerance || observedNow - state.checkedAt > this.maxRevocationAge) {
      throw new IdentityVerificationError('authority_unavailable', 'Current authoritative revocation status is unavailable');
    }
    if (state.revoked) throw new IdentityVerificationError('revoked', 'Identity or lineage credential is revoked');
  }

  private async authority<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      throw new IdentityVerificationError('authority_unavailable', 'Identity authority is unavailable');
    }
  }
}
