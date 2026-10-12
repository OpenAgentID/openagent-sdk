/**
 * Pluggable storage interface for the SCIM bridge.
 *
 * The default in-memory implementation is suitable for tests and local dev.
 * Production deployments should wire a persistent backend (PostgreSQL, etc.)
 * implementing {@link AgentStore}.
 */

import { randomUUID } from 'node:crypto';
import type { AgentRecord } from './resources.js';

/** Durable ownership of one username while its external identity is created. */
export interface UserNameReservation {
  readonly userName: string;
  readonly id: string;
}

/**
 * Storage interface for agent records.
 *
 * All methods return new objects — implementations must never return
 * mutable references to internal state.
 */
export interface AgentStore {
  /** Atomically reserve an unused username. Reject existing records AND pending
   * reservations with CONFLICT before any authority operation is started.
   * Persistent implementations must enforce this across all server instances;
   * a process-local lock is insufficient. Reservations must not auto-expire. */
  reserveUserName(userName: string): Promise<UserNameReservation>;

  /** Inspect an incomplete creation for operator reconciliation. */
  findUserNameReservation(userName: string): Promise<UserNameReservation | undefined>;

  /** Release only this exact reservation. Call only after confirming that the
   * authority created no identity, or after revoking/reconciling its result. */
  releaseUserName(reservation: UserNameReservation): Promise<void>;

  /** List all agent records. Returns an immutable snapshot. */
  list(): Promise<readonly AgentRecord[]>;

  /** Find agent by DID. Returns undefined if not found. */
  findByDid(did: string): Promise<AgentRecord | undefined>;

  /** Find agent by userName. Returns undefined if not found. */
  findByUserName(userName: string): Promise<AgentRecord | undefined>;

  /** Find agent by externalId. Returns undefined if not found. */
  findByExternalId(externalId: string): Promise<AgentRecord | undefined>;

  /** Atomically insert a record and consume its reservation. Enforce DID and
   * username uniqueness (including pending reservations). A repeated commit of
   * the same reservation and DID returns the stored record without overwriting
   * it. An unreserved insert must never displace a pending creation. */
  create(record: AgentRecord, reservation?: UserNameReservation): Promise<AgentRecord>;

  /** Replace a record, enforcing username uniqueness against records and reservations. */
  update(did: string, record: AgentRecord): Promise<AgentRecord>;

  /** Delete an agent record. Throws if DID does not exist. */
  delete(did: string): Promise<void>;

  /** Return the count of all active agents. */
  countActive(): Promise<number>;
}

/** In-memory store for testing and development. */
export class InMemoryAgentStore implements AgentStore {
  private readonly agents = new Map<string, AgentRecord>();
  private readonly reservations = new Map<string, UserNameReservation>();
  private readonly completedReservations = new Map<string, { userName: string; did: string }>();

  async reserveUserName(userName: string): Promise<UserNameReservation> {
    this.assertUserNameAvailable(userName);
    const reservation = { userName, id: randomUUID() };
    this.reservations.set(userName, reservation);
    return { ...reservation };
  }

  async findUserNameReservation(userName: string): Promise<UserNameReservation | undefined> {
    const reservation = this.reservations.get(userName);
    return reservation ? { ...reservation } : undefined;
  }

  async releaseUserName(reservation: UserNameReservation): Promise<void> {
    this.assertReservation(reservation);
    this.reservations.delete(reservation.userName);
  }

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

  async create(record: AgentRecord, reservation?: UserNameReservation): Promise<AgentRecord> {
    if (reservation) {
      if (reservation.userName !== record.userName) throw new StoreError('Reservation username mismatch', 'CONFLICT');
      const completed = this.completedReservations.get(reservation.id);
      if (completed) {
        if (completed.did !== record.did || completed.userName !== record.userName) {
          throw new StoreError('Reservation already committed to a different identity', 'CONFLICT');
        }
        const existing = this.agents.get(completed.did);
        if (!existing) throw new StoreError('Previously committed identity was deleted', 'NOT_FOUND');
        return { ...existing };
      }
      this.assertReservation(reservation);
    }
    this.assertUserNameAvailable(record.userName, undefined, reservation?.id);
    if (this.agents.has(record.did)) {
      throw new StoreError(`Agent with DID "${record.did}" already exists`, 'CONFLICT');
    }
    const copy = { ...record };
    this.agents.set(copy.did, copy);
    if (reservation) {
      this.reservations.delete(reservation.userName);
      this.completedReservations.set(reservation.id, { userName: record.userName, did: record.did });
    }
    return { ...copy };
  }

  async update(did: string, record: AgentRecord): Promise<AgentRecord> {
    if (!this.agents.has(did)) {
      throw new StoreError(`Agent with DID "${did}" not found`, 'NOT_FOUND');
    }
    this.assertUserNameAvailable(record.userName, did);
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

  private assertReservation(reservation: UserNameReservation): void {
    if (this.reservations.get(reservation.userName)?.id !== reservation.id) {
      throw new StoreError('Creation reservation is missing or owned by another request', 'CONFLICT');
    }
  }

  private assertUserNameAvailable(userName: string, exceptDid?: string, reservationId?: string): void {
    const pending = this.reservations.get(userName);
    if (pending && pending.id !== reservationId) {
      throw new StoreError(`Creation of userName "${userName}" is already pending`, 'CONFLICT');
    }
    for (const agent of this.agents.values()) {
      if (agent.userName === userName && agent.did !== exceptDid) {
        throw new StoreError(`Agent with userName "${userName}" already exists`, 'CONFLICT');
      }
    }
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
