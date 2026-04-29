// OpenAgent handlers: agent creation, lineage, skill policy.

import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519';
import { blake3 } from '@noble/hashes/blake3';
import { bytesEq, expectedBool, hex, inputHex, jcsStringify, op } from './util.mjs';
import { buildProofPayload } from './handlers-oas.mjs';
import { scopeImplies } from './handlers-arsenal.mjs';

const KINDS = new Set([
  'hmr',
  'mhr',
  'enr',
  'agent',
  'agent:instance',
  'tool',
  'skill',
  'workflow',
  'model',
  'dataset',
  'service',
]);

export function runOpenagent(v) {
  const o = op(v);
  switch (o) {
    case 'derive_child':
      return deriveChild(v);
    case 'derive_two_children':
      return deriveTwoChildren(v);
    case 'canonicalize_agent_doc':
      return canonicalizeAgentDoc(v);
    case 'create_and_verify_lineage':
      return createAndVerifyLineage(v);
    case 'format_child_did':
      return formatChildDid(v);
    case 'create_nested':
      return createNested(v);
    case 'create_with_wrong_parent_key':
      return createWithWrongParentKey(v);
    case 'hash_agent_doc':
      return hashAgentDoc(v);
    case 'verify_lineage_authority':
      return verifyLineageAuthority(v);
    case 'evaluate_skill':
      return evaluateSkill(v);
    case 'evaluate_rate_limit':
      return evaluateRateLimit(v);
    case 'evaluate_cost_budget':
      return evaluateCostBudget(v);
    case 'validate_input':
      return validateInput(v);
    case 'evaluate_compound':
      return evaluateCompound(v);
    default:
      throw new Error(`openagent: unknown operation ${o}`);
  }
}

// HKDF-SHA256 expand-only (info = derivation path) using the parent pubkey as
// salt. Matches the Rust runner's `hkdf_derive_child`.
function hkdfExpand(prk, info, length) {
  const out = Buffer.alloc(length);
  let t = Buffer.alloc(0);
  let pos = 0;
  let counter = 1;
  while (pos < length) {
    const mac = createHmac('sha256', prk);
    mac.update(t);
    mac.update(info);
    mac.update(Buffer.from([counter]));
    t = mac.digest();
    const copy = Math.min(t.length, length - pos);
    t.copy(out, pos, 0, copy);
    pos += copy;
    counter += 1;
  }
  return out;
}

function hkdfExtract(salt, ikm) {
  return createHmac('sha256', salt).update(ikm).digest();
}

function hkdfDeriveChild(parentSk, path) {
  const pk = ed25519.getPublicKey(parentSk);
  const prk = hkdfExtract(Buffer.from(pk), parentSk);
  const out = hkdfExpand(prk, Buffer.from(path, 'utf8'), 32);
  return out;
}

function deriveChild(v) {
  const sk = inputHex(v, 'parent_secret_key_hex');
  if (sk.length !== 32) throw new Error('sk len');
  const path = v.input.derivation_path;
  if (typeof path !== 'string') throw new Error('path');
  const childSeed = hkdfDeriveChild(sk, path);
  const childPk = ed25519.getPublicKey(childSeed);
  if (
    typeof v.expected_output.child_public_key_length_bytes === 'number' &&
    v.expected_output.child_public_key_length_bytes !== childPk.length
  ) {
    throw new Error('length mismatch');
  }
  if (v.expected_output.is_deterministic) {
    const again = hkdfDeriveChild(sk, path);
    if (!bytesEq(again, childSeed)) throw new Error('not deterministic');
  }
}

function deriveTwoChildren(v) {
  const sk = inputHex(v, 'parent_secret_key_hex');
  const a = v.input.path_a;
  const b = v.input.path_b;
  const seedA = hkdfDeriveChild(sk, a);
  const seedB = hkdfDeriveChild(sk, b);
  const equal = bytesEq(seedA, seedB);
  const expected = v.expected_output.equal;
  if (equal !== expected) throw new Error(`equal mismatch: got ${equal} expected ${expected}`);
}

function canonicalizeAgentDoc(v) {
  const doc = v.input.document;
  const got = jcsStringify(doc);
  const expected = v.expected_output.canonical;
  if (got !== expected) {
    throw new Error(`canonical mismatch:\n  got      ${got}\n  expected ${expected}`);
  }
}

function createAndVerifyLineage(v) {
  const sk = inputHex(v, 'parent_secret_key_hex');
  if (sk.length !== 32) throw new Error('sk len');
  const parentDid = v.input.parent_did;
  const agentName = v.input.agent_name;
  const path = v.input.derivation_path;
  if (!parentDid || !agentName || !path) throw new Error('missing inputs');
  const parts = parentDid.split(':');
  if (parts.length < 5) throw new Error('parent_did must be did:oas:<ns>:<kind>:<id>');
  const ns = parts[2];
  const childDid = `did:oas:${ns}:agent:${agentName}`;
  if (typeof v.expected_output.child_did === 'string' && v.expected_output.child_did !== childDid) {
    throw new Error(`child_did mismatch: got ${childDid} expected ${v.expected_output.child_did}`);
  }
  const payload = buildProofPayload(parentDid, childDid, path);
  const sig = ed25519.sign(payload, sk);
  const pk = ed25519.getPublicKey(sk);
  const ok = ed25519.verify(sig, payload, pk);
  const expected = expectedBool(v, 'lineage_proof_verifies');
  if (ok !== expected) throw new Error('lineage verify mismatch');
}

function formatChildDid(v) {
  const parent = v.input.parent_did;
  const kind = v.input.kind;
  const id = v.input.identifier;
  if (!parent || typeof kind !== 'string' || typeof id !== 'string') throw new Error('bad inputs');
  if (!KINDS.has(kind)) {
    if (typeof v.expected_output.error_contains === 'string') {
      const msg = `unknown kind '${kind}'`;
      if (!msg.includes(v.expected_output.error_contains)) {
        throw new Error('error message did not contain expected text');
      }
      return;
    }
    throw new Error(`kind '${kind}' rejected but no expected error_contains`);
  }
  const parts = parent.split(':');
  if (parts.length < 5) throw new Error('parent_did bad shape');
  const ns = parts[2];
  const child = `did:oas:${ns}:${kind}:${id}`;
  if (typeof v.expected_output.child_did === 'string' && v.expected_output.child_did !== child) {
    throw new Error(`child_did mismatch: got ${child} expected ${v.expected_output.child_did}`);
  }
}

function createNested(v) {
  const sk = inputHex(v, 'root_secret_key_hex');
  if (sk.length !== 32) throw new Error('sk len');
  const rootDid = v.input.root_did;
  const intermediatePath = v.input.intermediate_path;
  const intermediateName = v.input.intermediate_name;
  const leafPath = v.input.leaf_path;
  const leafName = v.input.leaf_name;
  const parts = rootDid.split(':');
  const ns = parts[2];
  const intermediateDid = `did:oas:${ns}:agent:${intermediateName}`;
  const leafDid = `did:oas:${ns}:agent:${leafName}`;
  const payload1 = buildProofPayload(rootDid, intermediateDid, intermediatePath);
  const sig1 = ed25519.sign(payload1, sk);
  const pk = ed25519.getPublicKey(sk);
  const ok1 = ed25519.verify(sig1, payload1, pk);
  const intermediateSeed = hkdfDeriveChild(sk, intermediatePath);
  const payload2 = buildProofPayload(intermediateDid, leafDid, leafPath);
  const sig2 = ed25519.sign(payload2, intermediateSeed);
  const pk2 = ed25519.getPublicKey(intermediateSeed);
  const ok2 = ed25519.verify(sig2, payload2, pk2);
  const both = ok1 && ok2;
  const expected = expectedBool(v, 'both_proofs_verify');
  if (both !== expected) throw new Error(`both_proofs_verify mismatch: got ${both} expected ${expected}`);
}

function createWithWrongParentKey(v) {
  const declared = inputHex(v, 'parent_declared_public_key_hex');
  const actualSk = inputHex(v, 'parent_actual_secret_key_hex');
  if (actualSk.length !== 32) throw new Error('sk len');
  const derivedPk = ed25519.getPublicKey(actualSk);
  const created = bytesEq(derivedPk, declared);
  const expected = expectedBool(v, 'created');
  if (created !== expected) throw new Error(`created mismatch: got ${created} expected ${expected}`);
}

function hashAgentDoc(v) {
  const doc = v.input.document;
  const bytes = Buffer.from(jcsStringify(doc), 'utf8');
  const h1 = blake3(bytes);
  const h2 = blake3(bytes);
  if (typeof v.expected_output.hash_length_bytes === 'number' && h1.length !== v.expected_output.hash_length_bytes) {
    throw new Error('length mismatch');
  }
  if (v.expected_output.is_deterministic && !bytesEq(h1, h2)) {
    throw new Error('not deterministic');
  }
}

function verifyLineageAuthority(v) {
  const got = evaluateLineageAuthority(v.input);
  const expected = v.expected_output;
  if (got.ok !== expected.ok) {
    throw new Error(`authority ok mismatch: got ${got.ok} expected ${expected.ok}`);
  }
  if (!got.ok) {
    if (got.errorClass !== expected.errorClass) {
      throw new Error(`authority error mismatch: got ${got.errorClass} expected ${expected.errorClass}`);
    }
    return;
  }
  for (const [key, value] of Object.entries(expected.context || {})) {
    if (got.context[key] !== value) {
      throw new Error(`authority context ${key} mismatch: got ${got.context[key]} expected ${value}`);
    }
  }
}

function evaluateLineageAuthority(input) {
  if (input.malformedRecord) {
    if (
      input.malformedRecord.subjectDid !== input.subjectDid ||
      input.malformedRecord.rootDid !== input.rootDid
    ) {
      return { ok: false, errorClass: 'lineage_authority_malformed' };
    }
  }
  if (!input.resolver) return { ok: false, errorClass: 'lineage_authority_missing' };
  const resolver = input.resolver;
  if (
    resolver.rootStatus === 'revoked' ||
    (Array.isArray(resolver.revokedDids) && resolver.revokedDids.includes(input.rootDid))
  ) {
    return { ok: false, errorClass: 'lineage_authority_revoked' };
  }
  if (
    input.expectedOrgRootCommitment &&
    resolver.orgRootCommitment !== input.expectedOrgRootCommitment
  ) {
    return { ok: false, errorClass: 'lineage_authority_wrong_org_root' };
  }
  if (
    typeof input.minFinalizedBlock === 'number' &&
    Number(resolver.currentFinalizedBlock) < input.minFinalizedBlock
  ) {
    return { ok: false, errorClass: 'lineage_authority_stale' };
  }
  if (!['hmr', 'mhr', 'enr'].includes(resolver.rootKind) || resolver.rootStatus !== 'active') {
    return { ok: false, errorClass: 'lineage_authority_malformed' };
  }
  return {
    ok: true,
    context: {
      subjectDid: input.subjectDid,
      rootDid: input.rootDid,
      authorityPathKind: input.pathKind,
      authoritySource: resolver.source,
      generation: Array.isArray(input.localChain) ? Math.max(input.localChain.length - 1, 0) : 0,
      rootKind: resolver.rootKind,
      orgRootCommitment: resolver.orgRootCommitment ?? null,
    },
  };
}

function evaluateSkill(v) {
  const agentScopes = v.input.agent_scopes;
  const req = v.input.skill_required_scope;
  if (!Array.isArray(agentScopes) || typeof req !== 'string') throw new Error('bad inputs');
  const decision = agentScopes.some((g) => scopeImplies(g, req)) ? 'allow' : 'deny';
  const expected = v.expected_output.decision;
  if (decision !== expected) throw new Error(`decision mismatch: got ${decision} expected ${expected}`);
}

function evaluateRateLimit(v) {
  const limit = Number(v.input.limit_per_minute);
  const inv = Number(v.input.invocations_in_last_minute);
  const decision = inv < limit ? 'allow' : 'deny';
  const expected = v.expected_output.decision;
  if (decision !== expected) throw new Error(`decision mismatch: got ${decision} expected ${expected}`);
}

function evaluateCostBudget(v) {
  const budget = Number(v.input.budget_usd);
  const spent = Number(v.input.spent_usd);
  const cost = Number(v.input.invocation_cost_usd);
  const decision = spent + cost <= budget ? 'allow' : 'deny';
  const expected = v.expected_output.decision;
  if (decision !== expected) throw new Error(`decision mismatch: got ${decision} expected ${expected}`);
  if (decision === 'allow' && typeof v.expected_output.remaining_usd === 'number') {
    const got = budget - spent - cost;
    if (Math.abs(got - v.expected_output.remaining_usd) > 0.001) {
      throw new Error(`remaining mismatch: got ${got} expected ${v.expected_output.remaining_usd}`);
    }
  }
}

function validateInput(v) {
  const schema = v.input.schema;
  const input = v.input.input;
  const valid = validateAgainstSchema(schema, input);
  const expected = expectedBool(v, 'valid');
  if (valid !== expected) throw new Error(`valid mismatch: got ${valid} expected ${expected}`);
}

function evaluateCompound(v) {
  const scopes = v.input.agent_scopes;
  const req = v.input.skill_required_scope;
  const limit = Number(v.input.limit_per_minute);
  const inv = Number(v.input.invocations_in_last_minute);
  const budget = Number(v.input.budget_usd);
  const spent = Number(v.input.spent_usd);
  const cost = Number(v.input.invocation_cost_usd);
  const scopeOk = Array.isArray(scopes) && scopes.some((g) => scopeImplies(g, req));
  const rateOk = inv < limit;
  const budgetOk = spent + cost <= budget;
  const decision = scopeOk && rateOk && budgetOk ? 'allow' : 'deny';
  const expected = v.expected_output.decision;
  if (decision !== expected) throw new Error(`decision mismatch: got ${decision} expected ${expected}`);
}

// Minimal JSON Schema validator covering the subset used by conformance vectors.
function validateAgainstSchema(schema, value) {
  if (!schema || typeof schema !== 'object') return true;
  if (typeof schema.type === 'string') {
    if (!typeMatches(schema.type, value)) return false;
  }
  if (Array.isArray(schema.required) && typeof value === 'object' && value !== null) {
    for (const k of schema.required) {
      if (!(k in value)) return false;
    }
  }
  if (schema.properties && typeof schema.properties === 'object') {
    for (const [k, sub] of Object.entries(schema.properties)) {
      if (value && typeof value === 'object' && k in value) {
        if (!validateAgainstSchema(sub, value[k])) return false;
      }
    }
  }
  if (typeof schema.minLength === 'number' && typeof value === 'string' && value.length < schema.minLength) {
    return false;
  }
  if (typeof schema.minimum === 'number' && typeof value === 'number' && value < schema.minimum) {
    return false;
  }
  if (typeof schema.maximum === 'number' && typeof value === 'number' && value > schema.maximum) {
    return false;
  }
  return true;
}

function typeMatches(type, value) {
  switch (type) {
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
}
