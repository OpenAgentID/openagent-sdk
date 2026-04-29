/**
 * SCIM PATCH operations — RFC 7644 section 3.5.2.
 *
 * Supports `add`, `replace`, and `remove` operations on agent records.
 * Each operation is validated and applied immutably (new record returned).
 */

import { z } from 'zod';
import { SCIM_PATCH_OP_SCHEMA, type ConformanceLevel, OPENAGENT_AGENT_SCHEMA } from './schemas.js';
import type { AgentRecord } from './resources.js';

/** A single SCIM PATCH operation. */
export interface PatchOperation {
  readonly op: 'add' | 'replace' | 'remove';
  readonly path?: string;
  readonly value?: unknown;
}

/** SCIM PatchOp request body. */
export interface PatchRequest {
  readonly schemas: readonly string[];
  readonly Operations: readonly PatchOperation[];
}

export const patchOperationSchema = z.object({
  op: z.enum(['add', 'replace', 'remove']),
  path: z.string().optional(),
  value: z.unknown().optional(),
});

export const patchRequestSchema = z.object({
  schemas: z.array(z.string()).refine(
    (s) => s.includes(SCIM_PATCH_OP_SCHEMA),
    `schemas must include ${SCIM_PATCH_OP_SCHEMA}`,
  ),
  Operations: z.array(patchOperationSchema).min(1, 'At least one operation is required'),
});

/** Parse and validate a SCIM PATCH request body. */
export function parsePatchRequest(body: unknown): PatchRequest {
  return patchRequestSchema.parse(body);
}

/**
 * Apply a set of SCIM PATCH operations to an agent record.
 *
 * Returns a new record with all operations applied. The original is never mutated.
 * Throws on invalid paths or unsupported operations.
 */
export function applyPatchOperations(
  record: AgentRecord,
  operations: readonly PatchOperation[],
): AgentRecord {
  let result = { ...record };

  for (const operation of operations) {
    result = applySingleOperation(result, operation);
  }

  return {
    ...result,
    updatedAt: new Date().toISOString(),
    version: generateVersion(),
  };
}

function applySingleOperation(record: AgentRecord, operation: PatchOperation): AgentRecord {
  const { op, path, value } = operation;

  // Normalize the path: strip extension URN prefix if present
  const normalizedPath = normalizePath(path);

  switch (op) {
    case 'add':
    case 'replace':
      return applyAddOrReplace(record, normalizedPath, value);
    case 'remove':
      return applyRemove(record, normalizedPath);
    default:
      throw new ScimPatchError(`Unsupported PATCH operation: "${op}"`);
  }
}

function applyAddOrReplace(record: AgentRecord, path: string | undefined, value: unknown): AgentRecord {
  if (path === undefined) {
    // Bulk replace: value is an object with attribute names
    if (typeof value !== 'object' || value === null) {
      throw new ScimPatchError('PATCH add/replace without path requires an object value');
    }
    let updated = { ...record };
    for (const [key, val] of Object.entries(value)) {
      updated = setSingleAttribute(updated, key, val);
    }
    return updated;
  }

  return setSingleAttribute(record, path, value);
}

function applyRemove(record: AgentRecord, path: string | undefined): AgentRecord {
  if (path === undefined) {
    throw new ScimPatchError('PATCH remove requires a path');
  }

  const lower = path.toLowerCase();
  switch (lower) {
    case 'displayname':
      return { ...record, displayName: record.userName };
    case 'externalid':
      return { ...record, externalId: undefined };
    default:
      throw new ScimPatchError(`Cannot remove required attribute: "${path}"`);
  }
}

function setSingleAttribute(record: AgentRecord, path: string, value: unknown): AgentRecord {
  const lower = path.toLowerCase();

  switch (lower) {
    case 'username':
      assertString(value, 'userName');
      return { ...record, userName: value as string };
    case 'displayname':
      assertString(value, 'displayName');
      return { ...record, displayName: value as string };
    case 'active':
      if (typeof value !== 'boolean') throw new ScimPatchError('active must be a boolean');
      return { ...record, active: value };
    case 'externalid':
      assertString(value, 'externalId');
      return { ...record, externalId: value as string };
    case 'parentdid':
      assertString(value, 'parentDid');
      return { ...record, parentDid: value as string };
    case 'conformancelevel':
      if (value !== 'L0' && value !== 'L1' && value !== 'L2') {
        throw new ScimPatchError('conformanceLevel must be L0, L1, or L2');
      }
      return { ...record, conformanceLevel: value as ConformanceLevel };
    case 'scopes':
      if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
        throw new ScimPatchError('scopes must be an array of strings');
      }
      return { ...record, scopes: value as string[] };
    default:
      throw new ScimPatchError(`Unknown or immutable attribute: "${path}"`);
  }
}

function normalizePath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  // Strip extension URN prefix: "urn:openagent:scim:1.0:Agent:scopes" -> "scopes"
  const prefix = `${OPENAGENT_AGENT_SCHEMA}:`;
  if (path.startsWith(prefix)) {
    return path.slice(prefix.length);
  }
  return path;
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ScimPatchError(`${field} must be a non-empty string`);
  }
}

function generateVersion(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class ScimPatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScimPatchError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
