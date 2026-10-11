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

interface CommonAgentIdentity {
  readonly did: string;
  /** Authorized root DID first; authenticated agent DID last. */
  readonly lineage: readonly string[];
  /** Unix seconds; the shortest remaining credential/authorization lifetime. */
  readonly expiresAt: number;
}

/** Current identity trust. This grants no application scopes or tenant access. */
export type VerifiedAgentIdentity = CommonAgentIdentity & (
  | { readonly owner: VerifiedOwner; readonly root?: { readonly kind: 'lifeid'; readonly did: string } }
  | { readonly owner: null; readonly root: {
      readonly kind: 'self'; readonly did: string;
      readonly authorizationId: string; readonly revision: string;
    } }
);

/** Current, server-authorized self-root registration; never supplied by the proof. */
export interface SelfRootAuthorization {
  readonly did: string;
  readonly audience: string;
  readonly authorizationId: string;
  readonly revision: string;
  readonly issuedAt: number;
  readonly notBefore: number;
  readonly expiresAt: number;
  readonly checkedAt: number;
}

interface VerifiedLineage {
  readonly identity: VerifiedAgentIdentity;
  readonly issuedAt: number;
  readonly notBefore: number;
}

export interface AgentIdentityProof {
  readonly token: string;
  /** Signed root-to-leaf JWTs; empty only for an authoritatively approved self-root. */
  readonly delegations: readonly string[];
}

/** DID verification relationships authorized by the authoritative resolver. */
export type IdentityKeyPurpose =
  | 'authentication'
  | 'capabilityDelegation'
  | 'assertionMethod'
  | 'capabilityInvocation'
  | 'keyAgreement';

export interface ResolvedIdentityDocument {
  readonly did: string;
  readonly verificationMethods: readonly {
    readonly id: string;
    readonly publicKeyJwk: JWK;
    /** Explicit current DID relationship authorizations, never inferred from a key's presence. */
    readonly purposes: readonly IdentityKeyPurpose[];
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
  /** Explicit opt-in authority for self-root agents; absence denies them. */
  authorizeSelfRoot?(rootDid: string, options: { audience: string }): Promise<SelfRootAuthorization | null>;
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

function agentIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 512 &&
    (DID_REGEX.test(value) || LEGACY_DID_REGEX.test(value)) &&
    /:(?:agent|agent:instance):[A-Za-z0-9._-]+$/.test(value);
}

function ownerIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 512 &&
    (DID_REGEX.test(value) || LEGACY_DID_REGEX.test(value)) &&
    /:(?:hmr|mhr|ao|enr):[A-Za-z0-9._-]+$/.test(value);
}

function authorizationIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && value.trim().length > 0;
}

/** Validate an authority verdict's root binding; this does not verify a signature. */
export function assertVerifiedIdentity(value: unknown, expectedDid?: string,
  now = Math.floor(Date.now() / 1000)): asserts value is VerifiedAgentIdentity {
  if (!unixTime(now)) throw new TypeError('Identity validation clock must return Unix seconds');
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Verified agent identity is required');
  const identity = value as Record<string, unknown>;
  if (!agentIdentifier(identity.did) || (expectedDid !== undefined && identity.did !== expectedDid) ||
      !unixTime(identity.expiresAt) || identity.expiresAt <= now || !Array.isArray(identity.lineage) ||
      identity.lineage.length < 1 || identity.lineage.length > 17 ||
      identity.lineage.some((did: unknown) => typeof did !== 'string' || did.length > 512 ||
        (!DID_REGEX.test(did) && !LEGACY_DID_REGEX.test(did))) ||
      new Set(identity.lineage).size !== identity.lineage.length || identity.lineage.at(-1) !== identity.did) {
    invalid('Verified identity DID, lineage or lifetime is invalid');
  }
  const root = identity.root;
  if (identity.owner === null) {
    if (!root || typeof root !== 'object' || Array.isArray(root)) invalid('Self-root authorization binding is required');
    const self = root as Record<string, unknown>;
    if (self.kind !== 'self' || !agentIdentifier(self.did) || self.did !== identity.lineage[0] ||
        !authorizationIdentifier(self.authorizationId) || !authorizationIdentifier(self.revision)) {
      invalid('Self-root authorization binding is invalid');
    }
  } else {
    if (!ownerRecord(identity.owner) || identity.lineage.length < 2 || !ownerIdentifier(identity.lineage[0])) {
      invalid('Verified identity must have an authenticated LifeID owner');
    }
    if (root !== undefined && (!root || typeof root !== 'object' || Array.isArray(root) ||
        (root as Record<string, unknown>).kind !== 'lifeid' ||
        (root as Record<string, unknown>).did !== identity.lineage[0])) {
      invalid('LifeID root binding is invalid');
    }
  }
}

/** Signed possession, authorized roots, delegation and live revocation checks. */
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
        typeof config.replay?.consume !== 'function' ||
        (config.authorizeSelfRoot !== undefined && typeof config.authorizeSelfRoot !== 'function')) {
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
    if (!Array.isArray(proof.delegations) || proof.delegations.length > this.maxDepth) {
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
    const verified = await this.lineage(unsigned.sub, delegations, audience, now);
    const identity = verified.identity;
    if (payload.exp! > identity.expiresAt || payload.iat! < verified.issuedAt || payload.nbf! < verified.notBefore) {
      invalid('Possession proof exceeds its root/delegation lifetime');
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
    if (!Array.isArray(delegations) || delegations.length > this.maxDepth) {
      invalid('A bounded signed delegation chain is required');
    }
    return (await this.lineage(did, [...delegations], options.audience, this.now())).identity;
  }

  /** Recheck current trust at code redemption/UserInfo without replaying possession. */
  async resolve(did: string, options: { audience: string }): Promise<VerifiedAgentIdentity> {
    identifier(did, 'agent');
    boundedString(options?.audience, 'audience', 2048);
    const resolver = this.config.resolveDelegations;
    if (!resolver) throw new IdentityVerificationError('authority_unavailable', 'Authoritative lineage resolver is required');
    const chain = await this.authority(() => resolver(did, options.audience));
    if (!Array.isArray(chain)) invalid('Signed delegation chain is required');
    return (await this.lineage(did, [...chain], options.audience, this.now())).identity;
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

  private async lineage(did: string, delegations: readonly string[], audience: string, now: number): Promise<VerifiedLineage> {
    identifier(did, 'agent');
    if (!agentIdentifier(did)) invalid('Subject is not an agent DID');
    if (!Array.isArray(delegations) || delegations.length > this.maxDepth) {
      invalid('A bounded signed owner delegation chain is required');
    }
    const rootDid = delegations.length ? this.decode(delegations[0]).iss : did;
    identifier(rootDid, 'root');
    let parent = rootDid;
    let parentExpiry = Number.MAX_SAFE_INTEGER;
    let parentIssuedAt = 0;
    let parentNotBefore = 0;
    let binding: Pick<VerifiedAgentIdentity, 'owner' | 'root'>;
    if (ownerIdentifier(rootDid)) {
      const owner = await this.authority(() => this.config.authorizeOwner(rootDid));
      if (!ownerRecord(owner)) throw new IdentityVerificationError('untrusted_owner', 'Root is not an approved real person or organization owner');
      binding = { owner: { issuer: owner.issuer, subject: owner.subject,
        ...(owner.organizationId === undefined ? {} : { organizationId: owner.organizationId }) },
        root: { kind: 'lifeid', did: rootDid } };
    } else if (agentIdentifier(rootDid)) {
      const authorization = await this.selfRoot(rootDid, audience, now);
      // An authority registration cannot turn an unknown/unusable DID into an identity.
      await this.selfRootDocument(rootDid);
      binding = { owner: null, root: { kind: 'self', did: rootDid,
        authorizationId: authorization.authorizationId, revision: authorization.revision } };
      parentExpiry = authorization.expiresAt;
      parentIssuedAt = authorization.issuedAt;
      parentNotBefore = authorization.notBefore;
      await this.revocation({ did: rootDid, credentialId: authorization.authorizationId }, now);
    } else {
      throw new IdentityVerificationError('untrusted_owner', 'Root is not an approved owner or self-root agent');
    }
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
    if (parentExpiry <= this.now()) invalid('Root or delegation expired during verification');
    const identity = { did, ...binding, lineage, expiresAt: parentExpiry };
    assertVerifiedIdentity(identity, did, this.now());
    return { identity, issuedAt: parentIssuedAt, notBefore: parentNotBefore };
  }

  private async selfRoot(did: string, audience: string, now: number): Promise<SelfRootAuthorization> {
    const authorize = this.config.authorizeSelfRoot;
    if (!authorize) throw new IdentityVerificationError('untrusted_owner', 'Self-root authority is not configured');
    const grant = await this.authority(() => authorize(did, { audience }));
    const observedNow = Math.max(now, this.now());
    if (!grant || grant.did !== did || grant.audience !== audience ||
        !authorizationIdentifier(grant.authorizationId) || !authorizationIdentifier(grant.revision) ||
        !unixTime(grant.issuedAt) || !unixTime(grant.notBefore) || !unixTime(grant.expiresAt) ||
        !unixTime(grant.checkedAt) || grant.issuedAt > grant.notBefore || grant.notBefore >= grant.expiresAt ||
        grant.issuedAt > observedNow + this.tolerance || grant.notBefore > observedNow + this.tolerance ||
        grant.expiresAt <= observedNow || grant.checkedAt < grant.issuedAt) {
      throw new IdentityVerificationError('untrusted_owner', 'Self-root authorization is missing, mismatched or inactive');
    }
    if (grant.checkedAt > observedNow + this.tolerance || observedNow - grant.checkedAt > this.maxRevocationAge) {
      throw new IdentityVerificationError('authority_unavailable', 'Current self-root authorization is unavailable');
    }
    return { did, audience, authorizationId: grant.authorizationId, revision: grant.revision,
      issuedAt: grant.issuedAt, notBefore: grant.notBefore, expiresAt: grant.expiresAt, checkedAt: grant.checkedAt };
  }

  private async document(did: string): Promise<ResolvedIdentityDocument> {
    const document = await this.authority(() => this.config.resolveDid(did));
    if (!document || document.did !== did || !Array.isArray(document.verificationMethods) ||
        document.verificationMethods.length === 0 || document.verificationMethods.length > 32) {
      invalid('Authoritative DID document is missing or mismatched');
    }
    return document;
  }

  private async selfRootDocument(did: string): Promise<void> {
    const document = await this.document(did);
    const methods = document.verificationMethods.filter((method) =>
      Array.isArray(method.purposes) && method.purposes.includes('authentication'));
    if (methods.length === 0) invalid('Self-root DID has no authorized authentication key');
    for (const method of methods) {
      if (typeof method.id !== 'string' || !method.id.startsWith(`${did}#`) ||
          method.id.length <= did.length + 1 ||
          document.verificationMethods.filter((other) => other.id === method.id).length !== 1) {
        invalid('Self-root authentication key is not uniquely bound to its DID');
      }
      const algorithm = method.publicKeyJwk?.kty === 'OKP' ? 'EdDSA' : 'RS256';
      await this.signingKey(method, 'authentication', algorithm);
    }
  }

  private async signingKey(method: ResolvedIdentityDocument['verificationMethods'][number],
    purpose: 'authentication' | 'capabilityDelegation', algorithm: 'EdDSA' | 'RS256') {
    if (!Array.isArray(method.purposes) || method.purposes.length > 5 ||
        !method.purposes.every((value) => ['authentication', 'capabilityDelegation', 'assertionMethod', 'capabilityInvocation', 'keyAgreement'].includes(value)) ||
        !method.purposes.includes(purpose)) {
      invalid('Signing key is not authorized for this identity verification purpose');
    }
    const jwk = method.publicKeyJwk;
    if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk) ||
        ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some((key) => key in jwk) ||
        (jwk.alg !== undefined && jwk.alg !== algorithm) || (jwk.use !== undefined && jwk.use !== 'sig') ||
        (jwk.key_ops !== undefined && (!Array.isArray(jwk.key_ops) || !jwk.key_ops.includes('verify'))) ||
        (algorithm === 'EdDSA' && (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519')) ||
        (algorithm === 'RS256' && jwk.kty !== 'RSA')) {
      invalid('Invalid authoritative signing key');
    }
    try {
      return await importJWK(jwk, algorithm);
    } catch {
      return invalid('Authoritative signing key cannot be imported');
    }
  }

  private async signed(token: string, issuer: string, subject: string, audience: string,
    typ: 'oaid-proof+jwt' | 'oaid-delegation+jwt', maxAge: number, now: number): Promise<JWTPayload> {
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
      const method = methods[0]!;
      const purpose = typ === 'oaid-proof+jwt' ? 'authentication' : 'capabilityDelegation';
      const key = await this.signingKey(method, purpose, header.alg);
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
