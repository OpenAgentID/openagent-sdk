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
 * Production: wires to OAS SDK's `revokeIdentity`.
 * Default: no-op (logs a warning).
 */
export type DidRevoker = (did: string) => Promise<void>;

/**
 * Hook invoked during deprovisioning to cascade-revoke all delegation
 * proofs issued by (or to) the deprovisioned agent.
 *
 * Production: wires to AEGIS SDK's delegation tree walker.
 * Default: no-op (logs a warning).
 */
export type DelegationCascadeRevoker = (did: string) => Promise<void>;

/**
 * Hook invoked during deprovisioning to invalidate all active Arsenal
 * sessions for the deprovisioned agent.
 *
 * Production: wires to Arsenal SDK's session invalidation.
 * Default: no-op (logs a warning).
 */
export type ArsenalSessionInvalidator = (did: string) => Promise<void>;

// ── Provisioner configuration ─────────────────────────────────────────────

export interface ProvisionerConfig {
  readonly store: AgentStore;
  readonly namespace: string;
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
}

// ── Provisioner ───────────────────────────────────────────────────────────

export class AgentProvisioner {
  private readonly store: AgentStore;
  private readonly namespace: string;
  private readonly logger: Logger;
  private readonly auditSink: AuditSink;
  private readonly revokeDidDocument: DidRevoker;
  private readonly cascadeRevokeDelegations: DelegationCascadeRevoker;
  private readonly invalidateArsenalSessions: ArsenalSessionInvalidator;

  constructor(config: ProvisionerConfig) {
    this.store = config.store;
    this.namespace = config.namespace;
    this.logger = config.logger;

    this.auditSink = config.auditSink ?? ((_e) => { /* no-op */ });

    this.revokeDidDocument = config.revokeDidDocument ?? (async (did) => {
      this.logger.warn('No DidRevoker configured — skipping DID revocation', { did });
    });

    this.cascadeRevokeDelegations = config.cascadeRevokeDelegations ?? (async (did) => {
      this.logger.warn('No DelegationCascadeRevoker configured — skipping cascade', { did });
    });

    this.invalidateArsenalSessions = config.invalidateArsenalSessions ?? (async (did) => {
      this.logger.warn('No ArsenalSessionInvalidator configured — skipping session invalidation', { did });
    });
  }

  /** Create a new agent DID and store the record. */
  async createAgent(params: CreateAgentParams): Promise<AgentRecord> {
    const did = deriveDid(this.namespace, params.userName);
    const fingerprint = deriveKeypairFingerprint(did);
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

    const created = await this.store.create(record);

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

    const result = await this.store.update(did, updated);

    this.logger.info('Agent replaced via SCIM', { did });
    await this.auditSink({
      type: 'agent.updated',
      did,
      timestamp: now,
      details: { userName: params.userName, scopes: params.scopes },
    });

    return result;
  }

  /** Update an agent record with partial data (SCIM PATCH). */
  async updateAgent(did: string, record: AgentRecord): Promise<AgentRecord> {
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

  /**
   * Deprovision an agent — the killer feature.
   *
   * Execution order:
   *   1. Revoke the agent's DID document
   *   2. Cascade-revoke all delegation proofs issued by this agent
   *   3. Invalidate all active Arsenal sessions for this agent
   *   4. Delete the agent record from the store
   *   5. Emit audit event
   *
   * Each step is executed even if a previous step fails (best-effort
   * cascade). Errors are collected and logged; the store deletion
   * proceeds regardless to ensure the SCIM client sees 204.
   */
  async deprovisionAgent(did: string): Promise<void> {
    const existing = await this.store.findByDid(did);
    if (!existing) {
      throw new ProvisionerError(`Agent "${did}" not found`, 'NOT_FOUND');
    }

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
        cascadeErrors: errors.length > 0 ? errors.map((e) => e.step) : undefined,
      },
    });
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

/**
 * Derive a deterministic DID from namespace + userName.
 *
 * In production, this would use Ed25519 key generation from the OAS SDK.
 * Here we produce a valid `did:oas` identifier suitable for SCIM-based
 * provisioning. The actual keypair is generated server-side by OAS.
 */
function deriveDid(namespace: string, userName: string): string {
  // Sanitize userName for DID: only alphanumeric, dot, dash, underscore
  const sanitized = userName
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return `did:oas:${namespace}:agent:${sanitized}`;
}

/**
 * Derive a keypair fingerprint for a newly provisioned agent.
 *
 * In production, this would generate a real Ed25519 keypair and return
 * the multibase-encoded public key. Here we produce a deterministic
 * placeholder that signals "SCIM-provisioned, keypair pending enrollment".
 */
function deriveKeypairFingerprint(did: string): string {
  // Produce a z-prefixed multibase-like fingerprint
  let hash = 0;
  for (let i = 0; i < did.length; i++) {
    hash = ((hash << 5) - hash + did.charCodeAt(i)) | 0;
  }
  return `z6Mk${Math.abs(hash).toString(36).padStart(8, '0')}`;
}

function generateVersion(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export type ProvisionerErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION';

export class ProvisionerError extends Error {
  public readonly code: ProvisionerErrorCode;

  constructor(message: string, code: ProvisionerErrorCode) {
    super(message);
    this.name = 'ProvisionerError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
