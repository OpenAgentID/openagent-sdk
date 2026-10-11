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

interface VerifiedIdentityFields {
  readonly did: string;
  readonly lineage: readonly string[];
  readonly expiresAt: number;
}

export interface LifeIdAgentRoot {
  readonly kind: 'lifeid';
  readonly did: string;
}

export interface SelfAgentRoot {
  readonly kind: 'self';
  readonly did: string;
  readonly authorizationId: string;
  readonly revision: string;
}

export type AgentIdentityRoot = LifeIdAgentRoot | SelfAgentRoot;

export type VerifiedAgentIdentity = VerifiedIdentityFields & (
  | { readonly owner: AgentOwner; readonly root?: LifeIdAgentRoot }
  | { readonly owner: null; readonly root: SelfAgentRoot }
);

export interface VerifyAgentContext {
  readonly audience: string;
  readonly nonce: string;
}

/** Never rewrite a legacy identifier before signature or owner verification. */
export function assertAgentIdentity(identity: VerifiedAgentIdentity, did?: string, allowSelfRooted = false): void {
  if (!identity || typeof identity.did !== 'string'
    || !isAgentDid(identity.did)
    || (did !== undefined && identity.did !== did)
    || !Array.isArray(identity.lineage) || identity.lineage.length < 1 || identity.lineage.length > 17
    || !identity.lineage.every(isDid) || new Set(identity.lineage).size !== identity.lineage.length
    || identity.lineage.at(-1) !== identity.did
    || !Number.isSafeInteger(identity.expiresAt)
    || identity.expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new Error('Agent identity verification did not return a current valid agent lineage');
  }
  if (identity.owner === null) {
    if (allowSelfRooted !== true) throw new Error('Self-rooted agent authentication is disabled');
    if (!identity.root || identity.root.kind !== 'self' || !isAgentDid(identity.root.did)
      || identity.root.did !== identity.lineage[0]
      || !boundedString(identity.root.authorizationId) || !boundedString(identity.root.revision)) {
      throw new Error('Self-rooted identity requires a current authoritative root authorization');
    }
  } else if (!identity.owner || !boundedString(identity.owner.issuer, 2048)
    || !boundedString(identity.owner.subject)
    || (identity.owner.organizationId !== undefined && !boundedString(identity.owner.organizationId))
    || identity.lineage.length < 2 || !isOwnerRootDid(identity.lineage[0])
    || (identity.root !== undefined && (!identity.root || identity.root.kind !== 'lifeid'
      || identity.root.did !== identity.lineage[0]))) {
    throw new Error('Owned identity requires a real person or organization root and owner binding');
  }
}

function boundedString(value: unknown, max = 512): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function isDid(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 512
    && /^did:(?:oas:[a-z0-9][a-z0-9-]{0,63}|l1fe):(?:hmr|mhr|ao|enr|agent|tool|skill|workflow|model|dataset|service|agent:instance):[A-Za-z0-9._-]+$/.test(value);
}

function isAgentDid(value: unknown): value is string {
  return isDid(value) && /:agent(?::instance)?:[A-Za-z0-9._-]+$/.test(value);
}

function isOwnerRootDid(value: unknown): value is string {
  return isDid(value) && /:(?:hmr|mhr|ao|enr):[A-Za-z0-9._-]+$/.test(value);
}

/** Historical owned results omitted root; their validated first DID remains the root. */
export function identityRoot(identity: VerifiedAgentIdentity): AgentIdentityRoot {
  return identity.root ?? { kind: 'lifeid', did: identity.lineage[0] };
}

/** A grant cannot cross root modes, root DIDs, policy revisions, or LifeID owners. */
export function sameIdentityBinding(left: VerifiedAgentIdentity, right: VerifiedAgentIdentity): boolean {
  const leftRoot = identityRoot(left), rightRoot = identityRoot(right);
  if (left.did !== right.did || leftRoot.kind !== rightRoot.kind || leftRoot.did !== rightRoot.did) return false;
  if (leftRoot.kind === 'self' && rightRoot.kind === 'self') {
    return left.owner === null && right.owner === null
      && leftRoot.authorizationId === rightRoot.authorizationId && leftRoot.revision === rightRoot.revision;
  }
  return left.owner !== null && right.owner !== null && sameOwner(left.owner, right.owner);
}

export function sameOwner(left: AgentOwner, right: AgentOwner): boolean {
  return left.issuer === right.issuer && left.subject === right.subject
    && left.organizationId === right.organizationId;
}
