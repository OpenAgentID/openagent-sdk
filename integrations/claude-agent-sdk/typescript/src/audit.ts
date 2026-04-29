/**
 * Hash-chained audit log for the OpenAgent x Claude Agent plugin.
 *
 * Each record's `hash` is computed over the canonical JSON representation
 * of the record minus the `hash` field, plus the previous record's
 * `hash`. This produces a tamper-evident chain — flipping any byte in
 * any record invalidates every subsequent hash.
 *
 * Two sinks ship by default:
 *   - {@link InMemoryAuditSink} for tests + ephemeral runs
 *   - {@link ConsoleAuditSink}  for dev / CI
 * Production deployments should provide their own sink that ships records
 * to a durable backend (e.g. Akasha, Postgres, Loki).
 */

import type { AuditKind, AuditRecord, AuditSink } from './types.js';
import { canonicalJson, hashHex } from './hash.js';

/** Sentinel for the head of the chain. */
export const GENESIS_PREV_HASH = '0'.repeat(64);

/**
 * Builds and signs (hash-chains) audit records. The chain is owned by a
 * single session — callers should construct one chain per session.
 */
export class AuditChain {
  private seq = 0;
  private prevHash: string = GENESIS_PREV_HASH;
  private readonly sink: AuditSink;
  private readonly sessionId: string;
  private readonly agentDid: string;

  constructor(opts: { sessionId: string; agentDid: string; sink: AuditSink }) {
    this.sessionId = opts.sessionId;
    this.agentDid = opts.agentDid;
    this.sink = opts.sink;
  }

  /** Append a new record. Always succeeds — sink errors are swallowed. */
  async append(input: {
    kind: AuditKind;
    name?: string;
    outcome: AuditRecord['outcome'];
    inputHash?: string;
    outputHash?: string;
    context?: Record<string, unknown>;
  }): Promise<AuditRecord> {
    this.seq += 1;
    const record: AuditRecord = {
      seq: this.seq,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      agentDid: this.agentDid,
      kind: input.kind,
      ...(input.name !== undefined ? { name: input.name } : {}),
      outcome: input.outcome,
      ...(input.inputHash !== undefined ? { inputHash: input.inputHash } : {}),
      ...(input.outputHash !== undefined ? { outputHash: input.outputHash } : {}),
      prevHash: this.prevHash,
      hash: '',
      ...(input.context !== undefined ? { context: input.context } : {}),
    };
    record.hash = hashRecord(record);
    this.prevHash = record.hash;
    try {
      await this.sink.append(record);
    } catch {
      // Audit MUST be best-effort; never throw from a hook because of audit.
    }
    return record;
  }

  /** Current chain head. Useful for tests / chain export. */
  head(): string {
    return this.prevHash;
  }
}

/** Compute the hash of a record (excludes the hash field itself). */
export function hashRecord(record: AuditRecord): string {
  // Build a copy without `hash` for canonical hashing.
  const { hash: _omit, ...rest } = record;
  void _omit;
  return hashHex(canonicalJson(rest));
}

/** Verify that a previously emitted chain has not been tampered with. */
export function verifyChain(records: readonly AuditRecord[]): {
  valid: boolean;
  brokenAt?: number;
} {
  let prev = GENESIS_PREV_HASH;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!r) return { valid: false, brokenAt: i };
    if (r.prevHash !== prev) return { valid: false, brokenAt: i };
    const expected = hashRecord(r);
    if (expected !== r.hash) return { valid: false, brokenAt: i };
    prev = r.hash;
  }
  return { valid: true };
}

/** In-memory audit sink (handy for tests + dry runs). */
export class InMemoryAuditSink implements AuditSink {
  public readonly records: AuditRecord[] = [];

  append(record: AuditRecord): void {
    this.records.push(record);
  }

  /** Convenience: clear the buffered records (test helper). */
  clear(): void {
    this.records.length = 0;
  }
}

/** Audit sink that writes structured JSON to stdout — handy for dev. */
export class ConsoleAuditSink implements AuditSink {
  append(record: AuditRecord): void {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ openagent_audit: record }));
  }
}

/** Compose multiple sinks (records are dispatched to all in order). */
export class FanOutAuditSink implements AuditSink {
  constructor(private readonly sinks: readonly AuditSink[]) {}

  async append(record: AuditRecord): Promise<void> {
    for (const sink of this.sinks) {
      try {
        await sink.append(record);
      } catch {
        // never abort fan-out on a single sink failure
      }
    }
  }
}
