/**
 * Hash-chained invocation receipts.
 *
 * Matches the Rust audit chain: each receipt's hash is
 * `BLAKE3(previous_hash || canonical_payload)`, where `canonical_payload`
 * is a JSON object with fields in a fixed order and `receipt_hash`
 * excluded.
 *
 * We use `@noble/hashes/blake3` which is pure TypeScript with no WASM
 * dependency.
 */

import { blake3 } from "@noble/hashes/blake3";

import type { AuditLevel } from "./schema.js";

export const HASH_LEN = 32;

const ZERO_HEX = "0".repeat(HASH_LEN * 2);

export interface Receipt {
  sequence: number;
  skill: string;
  agent: string;
  session: string;
  invokedAt: string;
  auditLevel: AuditLevel;
  argumentsHash: string;
  arguments?: unknown;
  previousHash: string;
  receiptHash: string;
}

export class AuditChain {
  private readonly receipts: Receipt[] = [];
  private headBytes: Uint8Array = new Uint8Array(HASH_LEN);

  get length(): number {
    return this.receipts.length;
  }

  get isEmpty(): boolean {
    return this.receipts.length === 0;
  }

  head(): string {
    return toHex(this.headBytes);
  }

  get(sequence: number): Receipt | undefined {
    return this.receipts[sequence];
  }

  all(): readonly Receipt[] {
    return this.receipts;
  }

  verify(): boolean {
    let prev: Uint8Array = new Uint8Array(HASH_LEN);
    for (const r of this.receipts) {
      const gotPrev = fromHex(r.previousHash);
      if (!bytesEqual(gotPrev, prev)) return false;
      const canon = canonicalPayload(r);
      const expect: Uint8Array = computeReceiptHash(prev, canon);
      const got = fromHex(r.receiptHash);
      if (!bytesEqual(got, expect)) return false;
      prev = expect;
    }
    return bytesEqual(prev, this.headBytes);
  }

  append(
    skill: string,
    agent: string,
    session: string,
    invokedAt: Date,
    level: AuditLevel,
    args: unknown,
  ): Receipt {
    const sequence = this.receipts.length;
    const invokedAtIso = invokedAt.toISOString();
    const argsHashBytes = hashBytes(
      new TextEncoder().encode(JSON.stringify(args ?? null)),
    );
    const argumentsHash = toHex(argsHashBytes);
    const argumentsField = level === "full" ? args : undefined;

    const draft: Receipt = {
      sequence,
      skill,
      agent,
      session,
      invokedAt: invokedAtIso,
      auditLevel: level,
      argumentsHash,
      arguments: argumentsField,
      previousHash: toHex(this.headBytes),
      receiptHash: ZERO_HEX,
    };

    const canon = canonicalPayload(draft);
    const newHash = computeReceiptHash(this.headBytes, canon);
    draft.receiptHash = toHex(newHash);
    this.headBytes = newHash;
    this.receipts.push(draft);
    return { ...draft };
  }
}

function canonicalPayload(r: Receipt): Uint8Array {
  const obj: Record<string, unknown> = {
    sequence: r.sequence,
    skill: r.skill,
    agent: r.agent,
    session: r.session,
    invoked_at: r.invokedAt,
    audit_level: r.auditLevel,
    arguments_hash: r.argumentsHash,
  };
  if (r.arguments !== undefined) {
    obj["arguments"] = r.arguments;
  }
  obj["previous_hash"] = r.previousHash;
  return new TextEncoder().encode(JSON.stringify(obj));
}

function computeReceiptHash(prev: Uint8Array, payload: Uint8Array): Uint8Array {
  const buf = new Uint8Array(prev.length + payload.length);
  buf.set(prev, 0);
  buf.set(payload, prev.length);
  return hashBytes(buf);
}

function hashBytes(data: Uint8Array): Uint8Array {
  return blake3(data);
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(HASH_LEN);
  if (hex.length !== HASH_LEN * 2) return out;
  for (let i = 0; i < HASH_LEN; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return new Uint8Array(HASH_LEN);
    out[i] = byte;
  }
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
