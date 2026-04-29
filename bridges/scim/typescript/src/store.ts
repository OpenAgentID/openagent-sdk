/**
 * Pluggable storage interface for the SCIM bridge.
 *
 * The default in-memory implementation is suitable for tests and local dev.
 * Production deployments should wire a persistent backend (PostgreSQL, etc.)
 * implementing {@link AgentStore}.
 */

import type { AgentRecord } from './resources.js';

/**
 * Storage interface for agent records.
 *
 * All methods return new objects — implementations must never return
 * mutable references to internal state.
 */
export interface AgentStore {
  /** List all agent records. Returns an immutable snapshot. */
  list(): Promise<readonly AgentRecord[]>;

  /** Find agent by DID. Returns undefined if not found. */
  findByDid(did: string): Promise<AgentRecord | undefined>;

  /** Find agent by userName. Returns undefined if not found. */
  findByUserName(userName: string): Promise<AgentRecord | undefined>;

  /** Find agent by externalId. Returns undefined if not found. */
  findByExternalId(externalId: string): Promise<AgentRecord | undefined>;

  /** Insert a new agent record. Throws if DID already exists. */
  create(record: AgentRecord): Promise<AgentRecord>;

  /** Replace an agent record. Throws if DID does not exist. */
  update(did: string, record: AgentRecord): Promise<AgentRecord>;

  /** Delete an agent record. Throws if DID does not exist. */
  delete(did: string): Promise<void>;

  /** Return the count of all active agents. */
  countActive(): Promise<number>;
}

/** In-memory store for testing and development. */
export class InMemoryAgentStore implements AgentStore {
  private readonly agents = new Map<string, AgentRecord>();

  async list(): Promise<readonly AgentRecord[]> {
    return [...this.agents.values()].map((a) => ({ ...a }));
  }

  async findByDid(did: string): Promise<AgentRecord | undefined> {
    const found = this.agents.get(did);
    return found ? { ...found } : undefined;
  }

  async findByUserName(userName: string): Promise<AgentRecord | undefined> {
    for (const agent of this.agents.values()) {
      if (agent.userName === userName) return { ...agent };
    }
    return undefined;
  }

  async findByExternalId(externalId: string): Promise<AgentRecord | undefined> {
    for (const agent of this.agents.values()) {
      if (agent.externalId === externalId) return { ...agent };
    }
    return undefined;
  }

  async create(record: AgentRecord): Promise<AgentRecord> {
    if (this.agents.has(record.did)) {
      throw new StoreError(`Agent with DID "${record.did}" already exists`, 'CONFLICT');
    }
    const copy = { ...record };
    this.agents.set(copy.did, copy);
    return { ...copy };
  }

  async update(did: string, record: AgentRecord): Promise<AgentRecord> {
    if (!this.agents.has(did)) {
      throw new StoreError(`Agent with DID "${did}" not found`, 'NOT_FOUND');
    }
    const copy = { ...record, did };
    this.agents.set(did, copy);
    return { ...copy };
  }

  async delete(did: string): Promise<void> {
    if (!this.agents.has(did)) {
      throw new StoreError(`Agent with DID "${did}" not found`, 'NOT_FOUND');
    }
    this.agents.delete(did);
  }

  async countActive(): Promise<number> {
    let count = 0;
    for (const agent of this.agents.values()) {
      if (agent.active) count++;
    }
    return count;
  }
}

export type StoreErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL';

export class StoreError extends Error {
  public readonly code: StoreErrorCode;

  constructor(message: string, code: StoreErrorCode) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
