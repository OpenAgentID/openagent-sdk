// Arsenal handlers: ACT encoding, scope parsing, policy evaluation, and
// canonical ACT verification (act-verify vectors, run through the
// crypto-wasm binding - never a handwritten re-implementation, which is the
// drift this suite exists to prevent).

import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ed25519 } from '@noble/curves/ed25519';
import { expectedBool, inputHex, jcsStringify, op } from './util.mjs';

// The crypto-wasm binding (nodejs target), loaded lazily on the first
// act-verify vector so runners without the built package only fail then.
let actBinding;
function actVerifyBinding() {
  if (!actBinding) {
    const require = createRequire(import.meta.url);
    const pkg = join(
      fileURLToPath(import.meta.url),
      '..',
      '..',
      '..',
      '..',
      'crates',
      'openagent-crypto-wasm',
      'pkg',
      'node',
      'openagent_crypto_wasm.js',
    );
    actBinding = require(pkg);
  }
  return actBinding;
}

const MAX_SCOPE_LENGTH = 512;

export function scopeIsValid(scope) {
  if (typeof scope !== 'string' || scope.length === 0 || scope.length > MAX_SCOPE_LENGTH) {
    return false;
  }
  const parts = scope.split(':');
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

export function scopeImplies(outer, inner) {
  if (!scopeIsValid(outer) || !scopeIsValid(inner)) return false;
  const o = outer.split(':');
  const i = inner.split(':');
  for (let idx = 0; idx < 3; idx++) {
    if (o[idx] !== '*' && o[idx] !== i[idx]) return false;
  }
  return true;
}

export function runArsenal(v) {
  const o = op(v);
  switch (o) {
    case 'parse':
      return parseScope(v);
    case 'implies':
      return impliesOp(v);
    case 'encode_claims':
      return encodeClaims(v);
    case 'sign_and_verify_claims':
      return signAndVerifyClaims(v);
    case 'check_ttl':
      return checkTtl(v);
    case 'check_expired':
      return checkExpired(v);
    case 'sign_tamper_verify':
      return signTamperVerify(v);
    case 'evaluate':
      return evaluate(v);
    case 'evaluate_with_context':
      return evaluateWithContext(v);
    case 'verify':
      return actVerify(v);
    default:
      throw new Error(`arsenal: unknown operation ${o}`);
  }
}

// Canonical ACT verification (act/SPECIFICATION.md) through the crypto-wasm
// binding, which runs the reference implementation compiled to WASM.
function actVerify(v) {
  const envelope = inputHex(v, 'envelope_hex');
  const trustedKey = inputHex(v, 'trusted_key_hex');
  if (trustedKey.length !== 32) throw new Error(`trusted_key_hex must be 32 bytes, got ${trustedKey.length}`);

  const issuer = v.input.issuer;
  const audience = v.input.audience;
  if (typeof issuer !== 'string' || typeof audience !== 'string') {
    throw new Error('missing issuer/audience');
  }
  const scopes = Array.isArray(v.input.scopes) ? v.input.scopes : [];
  const leeway = BigInt(v.input.leeway_seconds ?? 0);
  const now = BigInt(v.input.now_unix_seconds ?? 0);

  const verdict = v.expected_output && v.expected_output.verdict;

  let claims;
  let failure;
  try {
    const json = actVerifyBinding().act_verify(
      envelope,
      trustedKey,
      issuer,
      audience,
      scopes,
      leeway,
      now,
    );
    claims = JSON.parse(json);
  } catch (err) {
    failure = err;
  }

  if (verdict === 'accept') {
    if (failure) throw new Error(`expected accept, verification failed: ${failure.message}`);
    for (const field of ['sub', 'jti', 'tenant_id']) {
      const expected = v.expected_output[field];
      if (expected !== undefined && claims[field] !== expected) {
        throw new Error(`${field} mismatch: got ${claims[field]} expected ${expected}`);
      }
    }
    return;
  }
  if (verdict === 'reject') {
    if (!failure) throw new Error(`expected reject, token verified (sub ${claims.sub})`);
    const reasonClass = v.expected_output.reason_class ?? '';
    if (reasonClass && !failure.message.includes(reasonClass)) {
      throw new Error(
        `reason class mismatch: error "${failure.message}" does not contain "${reasonClass}"`,
      );
    }
    return;
  }
  throw new Error(`unknown verdict ${verdict}`);
}

function parseScope(v) {
  const scope = v.input.scope;
  if (typeof scope !== 'string') throw new Error('missing scope');
  const expectedValid = expectedBool(v, 'valid');
  const valid = scopeIsValid(scope);
  if (valid !== expectedValid) {
    throw new Error(`valid mismatch: got ${valid} expected ${expectedValid}`);
  }
  if (valid) {
    const parts = scope.split(':');
    if (typeof v.expected_output.service === 'string' && parts[0] !== v.expected_output.service)
      throw new Error(`service mismatch: got ${parts[0]} expected ${v.expected_output.service}`);
    if (typeof v.expected_output.resource === 'string' && parts[1] !== v.expected_output.resource)
      throw new Error(`resource mismatch: got ${parts[1]} expected ${v.expected_output.resource}`);
    if (typeof v.expected_output.action === 'string' && parts[2] !== v.expected_output.action)
      throw new Error(`action mismatch: got ${parts[2]} expected ${v.expected_output.action}`);
  }
}

function impliesOp(v) {
  const got = scopeImplies(v.input.outer, v.input.inner);
  const expected = expectedBool(v, 'implies');
  if (got !== expected) throw new Error(`implies mismatch: got ${got} expected ${expected}`);
}

function encodeClaims(v) {
  const claims = v.input.claims;
  if (claims === undefined) throw new Error('missing claims');
  const got = jcsStringify(claims);
  const expected = v.expected_output.canonical;
  if (typeof expected !== 'string') throw new Error('expected canonical');
  if (got !== expected) {
    throw new Error(`canonical mismatch:\n  got      ${got}\n  expected ${expected}`);
  }
}

function signAndVerifyClaims(v) {
  const sk = inputHex(v, 'secret_key_hex');
  if (sk.length !== 32) throw new Error('sk len');
  const claims = v.input.claims;
  if (claims === undefined) throw new Error('missing claims');
  const canonical = Buffer.from(jcsStringify(claims), 'utf8');
  const sig = ed25519.sign(canonical, sk);
  const pk = ed25519.getPublicKey(sk);
  const ok = ed25519.verify(sig, canonical, pk);
  const expected = expectedBool(v, 'verify_ok');
  if (ok !== expected) throw new Error('verify mismatch');
}

function checkTtl(v) {
  const iat = Number(v.input.iat);
  const exp = Number(v.input.exp);
  if (!Number.isInteger(iat) || !Number.isInteger(exp)) throw new Error('iat/exp not int');
  const ttl = exp - iat;
  const ok = ttl >= 5 && ttl <= 86400;
  const expected = expectedBool(v, 'ttl_ok');
  if (ok !== expected) throw new Error(`ttl_ok mismatch: got ${ok} expected ${expected}`);
  if (ok && typeof v.expected_output.ttl_seconds === 'number' && ttl !== v.expected_output.ttl_seconds) {
    throw new Error(`ttl_seconds mismatch: got ${ttl} expected ${v.expected_output.ttl_seconds}`);
  }
}

function checkExpired(v) {
  const now = Number(v.input.now);
  const exp = Number(v.input.exp);
  const expired = now > exp;
  const expected = expectedBool(v, 'expired');
  if (expired !== expected) throw new Error(`expired mismatch: got ${expired} expected ${expected}`);
}

function signTamperVerify(v) {
  const sk = inputHex(v, 'secret_key_hex');
  if (sk.length !== 32) throw new Error('sk len');
  const original = v.input.original_claims;
  const tamperedField = v.input.tampered_field;
  const tamperedValue = v.input.tampered_value;
  if (original === undefined || typeof tamperedField !== 'string') throw new Error('missing tamper inputs');
  const originalBytes = Buffer.from(jcsStringify(original), 'utf8');
  const sig = ed25519.sign(originalBytes, sk);
  const tampered = { ...original, [tamperedField]: tamperedValue };
  const tamperedBytes = Buffer.from(jcsStringify(tampered), 'utf8');
  const pk = ed25519.getPublicKey(sk);
  let ok;
  try {
    ok = ed25519.verify(sig, tamperedBytes, pk);
  } catch {
    ok = false;
  }
  const expected = expectedBool(v, 'verify_ok');
  if (ok !== expected) throw new Error(`verify_ok mismatch: got ${ok} expected ${expected}`);
}

function evaluate(v) {
  const granted = v.input.granted_scopes;
  const requested = v.input.requested_scope;
  if (!Array.isArray(granted) || typeof requested !== 'string') throw new Error('bad inputs');
  const decision = granted.some((g) => scopeImplies(g, requested)) ? 'allow' : 'deny';
  const expected = v.expected_output.decision;
  if (decision !== expected) {
    throw new Error(`decision mismatch: got ${decision} expected ${expected}`);
  }
}

function evaluateWithContext(v) {
  const granted = v.input.granted_scopes;
  const requested = v.input.requested_scope;
  if (!Array.isArray(granted) || typeof requested !== 'string') throw new Error('bad inputs');
  const scopeOk = granted.some((g) => scopeImplies(g, requested));
  let tenantOk = true;
  if (typeof v.input.tenant_constraint === 'string' && typeof v.input.request_tenant === 'string') {
    tenantOk = v.input.tenant_constraint === v.input.request_tenant;
  }
  let timeOk = true;
  const nb = v.input.time_not_before;
  const na = v.input.time_not_after;
  const rt = v.input.request_time;
  if (Number.isFinite(nb) && Number.isFinite(na) && Number.isFinite(rt)) {
    timeOk = rt >= nb && rt <= na;
  }
  const decision = scopeOk && tenantOk && timeOk ? 'allow' : 'deny';
  const expected = v.expected_output.decision;
  if (decision !== expected) {
    throw new Error(`decision mismatch: got ${decision} expected ${expected}`);
  }
}
