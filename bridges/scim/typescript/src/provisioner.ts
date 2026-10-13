/**
 * Agent lifecycle provisioner — the core engine behind the SCIM bridge.
 *
 * Handles DID derivation, keypair fingerprint generation, deprovisioning
 * cascade (DID revocation + delegation tree cascade + Arsenal session
 * invalidation), and audit event emission.
 *
 * The provisioner is independent of HTTP — it operates on domain types
 * and delegates storage to {@link AgentStore}.
 */

import type { OpenAgentRuntime } from '@openagentid/sdk';
import type { AgentRecord } from './resources.js';
import type { ConformanceLevel } from './schemas.js';
import type { AgentStore } from './store.js';
import type { Logger } from './config.js';

// ── Event types ───────────────────────────────────────────────────────────

/** Audit event emitted during agent lifecycle operations. */
export interface AuditEvent {
  readonly type: 'agent.created' | 'agent.updated' | 'agent.deprovisioned';
  readonly did: string;
  readonly timestamp: string;
  readonly details: Record<string, unknown>;
}

/** Callback invoked for each lifecycle audit event. */
export type AuditSink = (event: AuditEvent) => void | Promise<void>;

// ── Deprovisioning hooks ──────────────────────────────────────────────────

/**
 * Hook invoked during deprovisioning to revoke the agent's DID document.
 *
 * Production: persist revocation in the application's authoritative DID store.
 * Missing configuration fails closed.
 */
export type DidRevoker = (did: string) => Promise<void>;

/**
 * Hook invoked during deprovisioning to cascade-revoke all delegation
 * proofs issued by (or to) the deprovisioned agent.
 *
 * Production: revoke descendant grants in the application's delegation authority.
 * Missing configuration fails closed.
 */
export type DelegationCascadeRevoker = (did: string) => Promise<void>;

/**
 * Hook invoked during deprovisioning to invalidate all active Arsenal
 * sessions for the deprovisioned agent.
 *
 * Production: invalidate sessions through the application's configured Arsenal authority.
 * Missing configuration fails closed.
 */
export type ArsenalSessionInvalidator = (did: string) => Promise<void>;

// ── Provisioner configuration ─────────────────────────────────────────────

export interface ProvisionerConfig {
  readonly store: AgentStore;
  readonly namespace: string;
  readonly provisionIdentity?: IdentityProvisioner;
  /** Persist authoritative scope changes before updating the SCIM representation. */
  readonly updateIdentityScopes?: (did: string, scopes: readonly string[]) => Promise<void>;
  readonly logger: Logger;
  readonly auditSink?: AuditSink;
  readonly revokeDidDocument?: DidRevoker;
  readonly cascadeRevokeDelegations?: DelegationCascadeRevoker;
  readonly invalidateArsenalSessions?: ArsenalSessionInvalidator;
}

// ── Create ────────────────────────────────────────────────────────────────

export interface CreateAgentParams {
  readonly userName: string;
  readonly displayName?: string;
  readonly parentDid: string;
  readonly conformanceLevel: ConformanceLevel;
  readonly scopes: readonly string[];
  readonly externalId?: string;
  readonly active?: boolean;
}

// ── Provisioner ───────────────────────────────────────────────────────────

export class AgentProvisioner {
  private readonly store: AgentStore;
  private readonly provisionIdentity: IdentityProvisioner;
  private readonly updateIdentityScopes: NonNullable<ProvisionerConfig['updateIdentityScopes']>;
  private readonly logger: Logger;
  private readonly auditSink: AuditSink;
  private readonly revokeDidDocument: DidRevoker;
  private readonly cascadeRevokeDelegations: DelegationCascadeRevoker;
  private readonly invalidateArsenalSessions: ArsenalSessionInvalidator;

  constructor(config: ProvisionerConfig) {
    this.store = config.store;
    this.provisionIdentity = config.provisionIdentity ?? (async () => {
      throw new IdentityNotCreatedError('Identity provisioner is required');
    });
    this.logger = config.logger;
    this.updateIdentityScopes = config.updateIdentityScopes ?? (async () => {
      throw new ProvisionerError('Scope authority updater is required', 'UNAVAILABLE');
    });

    this.auditSink = config.auditSink ?? ((_e) => { /* no-op */ });

    this.revokeDidDocument = config.revokeDidDocument ?? (async (did) => {
      throw new ProvisionerError(`DID revoker is required for ${did}`, 'UNAVAILABLE');
    });

    this.cascadeRevokeDelegations = config.cascadeRevokeDelegations ?? (async (did) => {
      throw new ProvisionerError(`Delegation revoker is required for ${did}`, 'UNAVAILABLE');
    });

    this.invalidateArsenalSessions = config.invalidateArsenalSessions ?? (async (did) => {
      throw new ProvisionerError(`Session invalidator is required for ${did}`, 'UNAVAILABLE');
    });
  }

  /** Create a new agent DID and store the record. */
  async createAgent(params: CreateAgentParams): Promise<AgentRecord> {
    // This reservation must be atomic in the shared persistent store. Checking
    // findByUserName before awaiting a remote authority cannot prevent a race.
    const reservation = await this.store.reserveUserName(params.userName);
    let identity: Awaited<ReturnType<IdentityProvisioner>>;
    try {
      identity = await this.provisionIdentity(params);
    } catch (error) {
      // An ordinary transport error may occur AFTER the authority minted keys.
      // Retain the claim until that outcome is reconciled; never mint a second
      // identity on an automatic retry. Only an explicit no-create result is safe.
      if (error instanceof IdentityNotCreatedError) await this.store.releaseUserName(reservation);
      this.logger.error('Identity provisioning failed', { userName: params.userName, reservationId: reservation.id, error: String(error) });
      if (error instanceof IdentityNotCreatedError && error.reason === 'invalid-input') {
        throw new ProvisionerError('Invalid identity creation input', 'INVALID_INPUT');
      }
      throw new ProvisionerError('Identity provisioning incomplete', 'UNAVAILABLE');
    }
    if (!/^did:(?:oas:[a-z0-9][a-z0-9-]{0,63}|l1fe):agent(?::instance)?:[A-Za-z0-9._-]+$/.test(identity.did) ||
        !identity.keypairFingerprint || identity.parentDid !== params.parentDid) {
      throw new ProvisionerError('Identity authority returned invalid identity or parent binding; reconcile its reservation', 'UNAVAILABLE');
    }
    const { did, keypairFingerprint: fingerprint } = identity;
    const now = new Date().toISOString();
    const version = generateVersion();

    // Calculate lineage depth from parent DID
    const lineageDepth = await this.computeLineageDepth(params.parentDid);

    const record: AgentRecord = {
      did,
      userName: params.userName,
      displayName: params.displayName ?? params.userName,
      active: true,
      parentDid: params.parentDid,
      conformanceLevel: params.conformanceLevel,
      scopes: [...params.scopes],
      lineageDepth,
      createdVia: 'scim',
      keypairFingerprint: fingerprint,
      createdAt: now,
      updatedAt: now,
      version,
      ...(params.externalId !== undefined ? { externalId: params.externalId } : {}),
    };

    let created: AgentRecord;
    try {
      created = await this.store.create(record, reservation);
    } catch (error) {
      this.logger.error('Identity created but SCIM commit incomplete', { did, userName: params.userName, reservationId: reservation.id, error: String(error) });
      throw new ProvisionerError('Identity created but SCIM commit incomplete; reconcile its reservation', 'UNAVAILABLE');
    }
    if (params.active === false) created = await this.updateAgent(did, { ...created, active: false });

    this.logger.info('Agent created via SCIM', { did, userName: params.userName, parentDid: params.parentDid });
    await this.auditSink({
      type: 'agent.created',
      did,
      timestamp: now,
      details: { userName: params.userName, parentDid: params.parentDid, scopes: params.scopes },
    });

    return created;
  }

  /** Replace an agent record (SCIM PUT). */
  async replaceAgent(did: string, params: CreateAgentParams): Promise<AgentRecord> {
    const existing = await this.store.findByDid(did);
    if (!existing) {
      throw new ProvisionerError(`Agent "${did}" not found`, 'NOT_FOUND');
    }

    const now = new Date().toISOString();
    const version = generateVersion();

    const updated: AgentRecord = {
      ...existing,
      userName: params.userName,
      displayName: params.displayName ?? params.userName,
      parentDid: params.parentDid,
      conformanceLevel: params.conformanceLevel,
      scopes: [...params.scopes],
      updatedAt: now,
      version,
      ...(params.externalId !== undefined ? { externalId: params.externalId } : {}),
    };

    const result = await this.updateAgent(did, { ...updated, active: params.active ?? existing.active });

    return result;
  }

  /** Update an agent record with partial data (SCIM PATCH). */
  async updateAgent(did: string, record: AgentRecord): Promise<AgentRecord> {
    const existing = await this.store.findByDid(did);
    if (!existing) throw new ProvisionerError('Agent not found', 'NOT_FOUND');
    if (existing.parentDid !== record.parentDid) throw new ProvisionerError('Changing identity parent requires a new provisioned identity', 'VALIDATION');
    if (!existing.active && record.active) throw new ProvisionerError('Revoked identities cannot be reactivated; provision a new identity', 'VALIDATION');
    if (JSON.stringify([...existing.scopes].sort()) !== JSON.stringify([...record.scopes].sort())) {
      await this.updateIdentityScopes(did, record.scopes);
    }
    if (!record.active) await this.revokeAccess(did);
    const result = await this.store.update(did, record);

    this.logger.info('Agent updated via SCIM PATCH', { did });
    await this.auditSink({
      type: 'agent.updated',
      did,
      timestamp: record.updatedAt,
      details: { userName: record.userName },
    });

    return result;
  }

  /** Revoke all authorities before deleting. Failure retains an inactive record
   * so a SCIM client can retry; it never reports successful deprovisioning. */
  async deprovisionAgent(did: string): Promise<void> {
    const existing = await this.store.findByDid(did);
    if (!existing) {
      throw new ProvisionerError(`Agent "${did}" not found`, 'NOT_FOUND');
    }

    await this.revokeAccess(did);

    // Step 4: Delete from store
    await this.store.delete(did);
    this.logger.info('Agent deprovisioned via SCIM', { did });

    // Step 5: Audit event
    const now = new Date().toISOString();
    await this.auditSink({
      type: 'agent.deprovisioned',
      did,
      timestamp: now,
      details: {
        userName: existing.userName,
        parentDid: existing.parentDid,
      },
    });
  }

  private async revokeAccess(did: string): Promise<void> {
    const existing = await this.store.findByDid(did);
    if (!existing) throw new ProvisionerError('Agent not found', 'NOT_FOUND');
    await this.store.update(did, { ...existing, active: false, updatedAt: new Date().toISOString(), version: generateVersion() });
    const errors: Array<{ step: string; error: unknown }> = [];

    // Step 1: Revoke DID document
    try {
      await this.revokeDidDocument(did);
      this.logger.info('DID document revoked', { did });
    } catch (err) {
      errors.push({ step: 'revoke-did', error: err });
      this.logger.error('Failed to revoke DID document', { did, error: String(err) });
    }

    // Step 2: Cascade-revoke delegation proofs
    try {
      await this.cascadeRevokeDelegations(did);
      this.logger.info('Delegation proofs cascade-revoked', { did });
    } catch (err) {
      errors.push({ step: 'cascade-delegations', error: err });
      this.logger.error('Failed to cascade-revoke delegations', { did, error: String(err) });
    }

    // Step 3: Invalidate Arsenal sessions
    try {
      await this.invalidateArsenalSessions(did);
      this.logger.info('Arsenal sessions invalidated', { did });
    } catch (err) {
      errors.push({ step: 'invalidate-sessions', error: err });
      this.logger.error('Failed to invalidate Arsenal sessions', { did, error: String(err) });
    }

    if (errors.length) throw new ProvisionerError(`Revocation incomplete: ${errors.map(error => error.step).join(', ')}`, 'UNAVAILABLE');
  }

  /** Find agent by DID. */
  async findByDid(did: string): Promise<AgentRecord | undefined> {
    return this.store.findByDid(did);
  }

  /** Find agent by userName. */
  async findByUserName(userName: string): Promise<AgentRecord | undefined> {
    return this.store.findByUserName(userName);
  }

  /** List all agents. */
  async listAgents(): Promise<readonly AgentRecord[]> {
    return this.store.list();
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private async computeLineageDepth(parentDid: string): Promise<number> {
    // If the parent is an HMR (human root), depth is 1
    if (parentDid.includes(':hmr:')) return 1;
    // If the parent is an MHR (multi-human root), depth is 1
    if (parentDid.includes(':mhr:')) return 1;
    // If the parent is another agent, try to look it up for its depth
    const parentAgent = await this.store.findByDid(parentDid);
    if (parentAgent) return parentAgent.lineageDepth + 1;
    // Default: assume depth 1 (direct child of a root)
    return 1;
  }
}

// ── Utility functions ─────────────────────────────────────────────────────

/** A real identity authority. It must create keys under its own custody and
 * authorize the requested parent; the SCIM bridge never manufactures keys.
 * Throw IdentityNotCreatedError only when creation definitely did not occur.
 * Other errors retain the username reservation for authority reconciliation. */
export type IdentityProvisioner = (params: CreateAgentParams) => Promise<{
  did: string; keypairFingerprint: string; parentDid: string;
}>;

/** Explicit authority confirmation that no identity/key was created. This is
 * NOT appropriate for timeouts, lost replies, or unknown remote outcomes. */
export class IdentityNotCreatedError extends Error {
  constructor(message: string, public readonly reason: 'unavailable' | 'invalid-input' = 'unavailable') {
    super(message);
    this.name = 'IdentityNotCreatedError';
  }
}

/** Adapt the configured current SDK runtime and its identity authority. */
export function createSdkScimProvisioner(runtime: OpenAgentRuntime): IdentityProvisioner {
  return async params => {
    // Validate with the actual installed SDK before invoking its authority. A
    // broad catch around createAgent would also catch lost replies AFTER minting
    // and would wrongly release those uncertain reservations.
    const { createAgentInputSchema } = await import('@openagentid/sdk');
    const parsed = createAgentInputSchema.safeParse({ parent: params.parentDid, name: params.userName, scopes: [...params.scopes] });
    if (!parsed.success) throw new IdentityNotCreatedError('Invalid SDK identity input', 'invalid-input');
    const agent = await runtime.createAgent(parsed.data);
    return { did: agent.did, keypairFingerprint: agent.document.publicKeyMultibase, parentDid: agent.document.parent };
  };
}

function generateVersion(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export type ProvisionerErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION' | 'INVALID_INPUT' | 'UNAVAILABLE';

export class ProvisionerError extends Error {
  public readonly code: ProvisionerErrorCode;

  constructor(message: string, code: ProvisionerErrorCode) {
    super(message);
    this.name = 'ProvisionerError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
