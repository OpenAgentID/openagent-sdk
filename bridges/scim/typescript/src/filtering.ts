/**
 * SCIM filter parser — RFC 7644 section 3.4.2.2.
 *
 * Supports the subset needed for enterprise SCIM clients:
 *   - `userName eq "value"`
 *   - `displayName co "value"`
 *   - `active eq true`
 *   - `id eq "did:oas:..."`
 *   - `externalId eq "value"`
 *
 * Compound filters (`and`, `or`) are supported at one level of nesting.
 * This is sufficient for Okta, Azure AD, OneLogin, and JumpCloud.
 */

import type { AgentRecord } from './resources.js';

/** Supported comparison operators. */
export type FilterOp = 'eq' | 'ne' | 'co' | 'sw' | 'ew' | 'pr' | 'gt' | 'ge' | 'lt' | 'le';

/** A single attribute filter expression. */
export interface AttributeFilter {
  readonly type: 'attribute';
  readonly attribute: string;
  readonly op: FilterOp;
  readonly value: string | boolean | number | null;
}

/** Logical combination of filters. */
export interface LogicalFilter {
  readonly type: 'and' | 'or';
  readonly filters: readonly ParsedFilter[];
}

export type ParsedFilter = AttributeFilter | LogicalFilter;

// ── Tokenizer ─────────────────────────────────────────────────────────────

type Token =
  | { type: 'word'; value: string }
  | { type: 'string'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'number'; value: number }
  | { type: 'null' };

function tokenize(input: string): readonly Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    // Skip whitespace
    if (input[i] === ' ' || input[i] === '\t') {
      i++;
      continue;
    }

    // Quoted string
    if (input[i] === '"') {
      i++; // skip opening quote
      let str = '';
      while (i < len && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < len) {
          i++;
          str += input[i];
        } else {
          str += input[i];
        }
        i++;
      }
      i++; // skip closing quote
      tokens.push({ type: 'string', value: str });
      continue;
    }

    // Word (attribute name, operator, boolean, null, number)
    let word = '';
    while (i < len && input[i] !== ' ' && input[i] !== '\t' && input[i] !== '"') {
      word += input[i];
      i++;
    }

    if (word.length === 0) continue;

    const lower = word.toLowerCase();
    if (lower === 'true') {
      tokens.push({ type: 'boolean', value: true });
    } else if (lower === 'false') {
      tokens.push({ type: 'boolean', value: false });
    } else if (lower === 'null') {
      tokens.push({ type: 'null' });
    } else if (/^-?\d+(\.\d+)?$/.test(word)) {
      tokens.push({ type: 'number', value: Number(word) });
    } else {
      tokens.push({ type: 'word', value: word });
    }
  }

  return tokens;
}

// ── Parser ────────────────────────────────────────────────────────────────

/**
 * Parse a SCIM filter string into a structured filter tree.
 *
 * Returns `undefined` for empty/missing filters (match all).
 * Throws on malformed filters.
 */
export function parseFilter(filterStr: string | undefined | null): ParsedFilter | undefined {
  if (!filterStr || filterStr.trim().length === 0) return undefined;

  const tokens = tokenize(filterStr.trim());
  if (tokens.length === 0) return undefined;

  return parseLogical(tokens, 0).filter;
}

interface ParseResult {
  readonly filter: ParsedFilter;
  readonly nextIndex: number;
}

function parseLogical(tokens: readonly Token[], start: number): ParseResult {
  const left = parseComparison(tokens, start);
  let current = left.filter;
  let idx = left.nextIndex;

  while (idx < tokens.length) {
    const tok = tokens[idx];
    if (tok.type !== 'word') break;

    const logical = tok.value.toLowerCase();
    if (logical !== 'and' && logical !== 'or') break;

    idx++; // consume logical operator
    const right = parseComparison(tokens, idx);
    idx = right.nextIndex;

    if (current.type === logical) {
      // Flatten same-level: (a and b) and c -> and(a, b, c)
      current = { type: logical, filters: [...(current as LogicalFilter).filters, right.filter] };
    } else {
      current = { type: logical, filters: [current, right.filter] };
    }
  }

  return { filter: current, nextIndex: idx };
}

function parseComparison(tokens: readonly Token[], start: number): ParseResult {
  if (start >= tokens.length) {
    throw new ScimFilterError('Unexpected end of filter expression');
  }

  const attrTok = tokens[start];
  if (attrTok.type !== 'word') {
    throw new ScimFilterError(`Expected attribute name, got ${attrTok.type}`);
  }

  const opIdx = start + 1;
  if (opIdx >= tokens.length) {
    throw new ScimFilterError(`Expected operator after "${attrTok.value}"`);
  }

  const opTok = tokens[opIdx];
  if (opTok.type !== 'word') {
    throw new ScimFilterError(`Expected operator, got ${opTok.type}`);
  }

  const op = opTok.value.toLowerCase() as FilterOp;
  const VALID_OPS: readonly FilterOp[] = ['eq', 'ne', 'co', 'sw', 'ew', 'pr', 'gt', 'ge', 'lt', 'le'];
  if (!VALID_OPS.includes(op)) {
    throw new ScimFilterError(`Unknown operator "${opTok.value}"`);
  }

  // `pr` (present) has no value
  if (op === 'pr') {
    return {
      filter: { type: 'attribute', attribute: attrTok.value, op, value: null },
      nextIndex: opIdx + 1,
    };
  }

  const valIdx = opIdx + 1;
  if (valIdx >= tokens.length) {
    throw new ScimFilterError(`Expected value after "${attrTok.value} ${op}"`);
  }

  const valTok = tokens[valIdx];
  let value: string | boolean | number | null;
  if (valTok.type === 'string') value = valTok.value;
  else if (valTok.type === 'boolean') value = valTok.value;
  else if (valTok.type === 'number') value = valTok.value;
  else if (valTok.type === 'null') value = null;
  else value = valTok.value; // bare word treated as string

  return {
    filter: { type: 'attribute', attribute: attrTok.value, op, value },
    nextIndex: valIdx + 1,
  };
}

// ── Evaluation ────────────────────────────────────────────────────────────

/** Evaluate a parsed filter against an agent record. Returns true if the record matches. */
export function matchesFilter(record: AgentRecord, filter: ParsedFilter | undefined): boolean {
  if (!filter) return true;

  // Switch on the discriminant so every `ParsedFilter` variant narrows
  // exhaustively; `LogicalFilter.type` is a union and does not narrow via
  // early-return `===` checks.
  switch (filter.type) {
    case 'and':
      return filter.filters.every((f) => matchesFilter(record, f));
    case 'or':
      return filter.filters.some((f) => matchesFilter(record, f));
    case 'attribute': {
      const fieldValue = resolveAttribute(record, filter.attribute);
      return compareValue(fieldValue, filter.op, filter.value);
    }
  }
}

function resolveAttribute(record: AgentRecord, attribute: string): unknown {
  const lower = attribute.toLowerCase();
  switch (lower) {
    case 'id': return record.did;
    case 'username': return record.userName;
    case 'displayname': return record.displayName;
    case 'active': return record.active;
    case 'externalid': return record.externalId;
    case 'meta.created': return record.createdAt;
    case 'meta.lastmodified': return record.updatedAt;
    default: return undefined;
  }
}

function compareValue(fieldValue: unknown, op: FilterOp, filterValue: string | boolean | number | null): boolean {
  if (op === 'pr') {
    return fieldValue !== undefined && fieldValue !== null;
  }

  if (fieldValue === undefined || fieldValue === null) {
    return op === 'eq' ? filterValue === null : op === 'ne' ? filterValue !== null : false;
  }

  const fieldStr = String(fieldValue).toLowerCase();
  const filterStr = filterValue !== null ? String(filterValue).toLowerCase() : '';

  switch (op) {
    case 'eq':
      if (typeof fieldValue === 'boolean') return fieldValue === filterValue;
      return fieldStr === filterStr;
    case 'ne':
      if (typeof fieldValue === 'boolean') return fieldValue !== filterValue;
      return fieldStr !== filterStr;
    case 'co':
      return fieldStr.includes(filterStr);
    case 'sw':
      return fieldStr.startsWith(filterStr);
    case 'ew':
      return fieldStr.endsWith(filterStr);
    case 'gt':
      return fieldStr > filterStr;
    case 'ge':
      return fieldStr >= filterStr;
    case 'lt':
      return fieldStr < filterStr;
    case 'le':
      return fieldStr <= filterStr;
    default:
      return false;
  }
}

// ── Errors ────────────────────────────────────────────────────────────────

export class ScimFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScimFilterError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
