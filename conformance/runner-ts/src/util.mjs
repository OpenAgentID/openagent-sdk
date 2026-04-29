// Small helpers used across handler modules.

import { Buffer } from 'node:buffer';

export function hex(buf) {
  return Buffer.from(buf).toString('hex');
}

export function fromHex(s) {
  if (typeof s !== 'string') throw new Error(`expected hex string, got ${typeof s}`);
  return Buffer.from(s, 'hex');
}

export function inputHex(v, field) {
  const s = v.input && v.input[field];
  if (typeof s !== 'string') throw new Error(`missing ${field}`);
  return fromHex(s);
}

export function expectedHex(v, field) {
  const s = v.expected_output && v.expected_output[field];
  if (typeof s !== 'string') throw new Error(`missing expected ${field}`);
  return fromHex(s);
}

export function expectedBool(v, field) {
  const b = v.expected_output && v.expected_output[field];
  if (typeof b !== 'boolean') throw new Error(`missing expected ${field}`);
  return b;
}

export function op(v) {
  const o = v.input && v.input.operation;
  if (typeof o !== 'string') throw new Error('missing operation');
  return o;
}

export function bytesEq(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// RFC 8785 JSON Canonicalization Scheme (JCS).
// Node's JSON.stringify handles most of it; we need deterministic key order,
// minimal number representation per ECMAScript ToString (Number) per RFC 8785.
export function jcsStringify(value) {
  return _jcsSerialize(value);
}

function _jcsSerialize(value) {
  if (value === null) return 'null';
  if (value === undefined) throw new Error('undefined not allowed in JCS');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number in JCS');
    // RFC 8785 §3.2.2.3: numbers follow ES2017 ToString(Number). JavaScript
    // already does this via String(number) for JSON-safe values.
    return _jcsNumber(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(_jcsSerialize).join(',') + ']';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort(_jcsCompareUtf16);
    const parts = [];
    for (const k of keys) {
      if (value[k] === undefined) continue;
      parts.push(JSON.stringify(k) + ':' + _jcsSerialize(value[k]));
    }
    return '{' + parts.join(',') + '}';
  }
  throw new Error(`JCS: unsupported type ${typeof value}`);
}

function _jcsCompareUtf16(a, b) {
  // RFC 8785 mandates sorting by UTF-16 code units, which is how default
  // String#localeCompare with 'default' behaves; but the simplest match for
  // RFC 8785 is a plain lexicographic compare over the string's UTF-16 units.
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function _jcsNumber(n) {
  if (Number.isInteger(n) && Object.is(n, Math.trunc(n))) {
    return n.toString();
  }
  // Match ES2017 ToString(Number): JSON.stringify matches for finite numbers.
  return JSON.stringify(n);
}
