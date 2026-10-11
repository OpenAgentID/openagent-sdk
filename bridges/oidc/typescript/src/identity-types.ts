/** Structural contract shared with the SDK's IdentityVerifier. */
export interface AgentOwner {
  readonly issuer: string;
  readonly subject: string;
  readonly organizationId?: string;
}

export interface AgentIdentityProof {
  readonly token: string;
  readonly delegations: readonly string[];
}

export interface VerifiedAgentIdentity {
  readonly did: string;
  readonly owner: AgentOwner;
  readonly lineage: readonly string[];
  readonly expiresAt: number;
}

export interface VerifyAgentContext {
  readonly audience: string;
  readonly nonce: string;
}

/** Never rewrite a legacy identifier before signature or owner verification. */
export function assertAgentIdentity(identity: VerifiedAgentIdentity, did?: string): void {
  if (!identity || typeof identity.did !== 'string'
    || !/^did:(?:oas:[a-z0-9_-]+|l1fe):agent(?::instance)?:[A-Za-z0-9._-]+$/.test(identity.did)
    || (did !== undefined && identity.did !== did)
    || !identity.owner || typeof identity.owner.issuer !== 'string' || !identity.owner.issuer
    || typeof identity.owner.subject !== 'string' || !identity.owner.subject
    || (identity.owner.organizationId !== undefined
      && (typeof identity.owner.organizationId !== 'string' || !identity.owner.organizationId))
    || !Array.isArray(identity.lineage) || identity.lineage.length < 2
    || identity.lineage.at(-1) !== identity.did
    || !Number.isSafeInteger(identity.expiresAt)
    || identity.expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new Error('Agent identity verification did not return a current owned agent');
  }
}

export function sameOwner(left: AgentOwner, right: AgentOwner): boolean {
  return left.issuer === right.issuer && left.subject === right.subject
    && left.organizationId === right.organizationId;
}
