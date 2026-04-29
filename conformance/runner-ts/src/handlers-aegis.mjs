// AEGIS handlers: verify pipeline, delegation, wallet derivation (SLIP-0010 Ed25519).

import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesEq, expectedBool, hex, inputHex, op } from './util.mjs';
import { buildProofPayload } from './handlers-oas.mjs';
import { scopeImplies, scopeIsValid } from './handlers-arsenal.mjs';

export function runAegis(v) {
  const o = op(v);
  switch (o) {
    case 'verify_chain':
      return verifyChain(v);
    case 'verify_chain_depth':
      return verifyChainDepth(v);
    case 'challenge_response':
      return challengeResponse(v);
    case 'challenge_response_tamper':
      return challengeResponseTamper(v);
    case 'freshness_check':
      return freshnessCheck(v);
    case 'delegate':
      return delegate(v);
    case 'delegate_chain':
      return delegateChain(v);
    case 'delegate_ttl':
      return delegateTtl(v);
    case 'revocation_cascade':
      return revocationCascade(v);
    case 'derive_master_ed25519':
      return deriveMasterEd25519(v);
    case 'derive_path_ed25519':
      return derivePathEd25519(v);
    case 'derive_twice':
      return deriveTwice(v);
    case 'derive_two':
      return deriveTwo(v);
    case 'derive_path_ed25519_expect_fail':
      return derivePathEd25519ExpectFail(v);
    default:
      throw new Error(`aegis: unknown operation ${o}`);
  }
}

function verifyChain(v) {
  const chain = v.input.chain;
  if (!Array.isArray(chain)) throw new Error('chain');
  const expected = expectedBool(v, 'verify_ok');
  if (chain.length === 0) {
    if (expected) throw new Error('expected non-empty valid chain');
    return;
  }
  const sk = inputHex(v, 'parent_secret_key_hex');
  if (sk.length !== 32) throw new Error('sk len');
  const pk = ed25519.getPublicKey(sk);

  let prevChild = null;
  for (const hop of chain) {
    const parent = hop.parent_did;
    const child = hop.child_did;
    const path = hop.derivation_path;
    if (!parent || !child || !path) throw new Error('hop missing fields');
    if (prevChild !== null && prevChild !== parent) {
      if (expected) throw new Error(`chain discontinuity: prev child ${prevChild} != parent ${parent}`);
      return;
    }
    const payload = buildProofPayload(parent, child, path);
    const sig = ed25519.sign(payload, sk);
    if (!ed25519.verify(sig, payload, pk)) throw new Error('self-verify failed');
    prevChild = child;
  }
  if (typeof v.expected_output.depth === 'number' && v.expected_output.depth !== chain.length) {
    throw new Error(`depth mismatch: got ${chain.length} expected ${v.expected_output.depth}`);
  }
  if (!expected) throw new Error('expected chain to fail but it passed');
}

function verifyChainDepth(v) {
  const depth = Number(v.input.depth);
  const max = Number(v.input.max_generation);
  const ok = depth <= max;
  const expected = expectedBool(v, 'verify_ok');
  if (ok !== expected) throw new Error(`verify_ok mismatch: got ${ok} expected ${expected}`);
}

function challengeResponse(v) {
  const sk = inputHex(v, 'secret_key_hex');
  if (sk.length !== 32) throw new Error('sk len');
  const nonce = inputHex(v, 'nonce_hex');
  const sig = ed25519.sign(nonce, sk);
  const pk = ed25519.getPublicKey(sk);
  const ok = ed25519.verify(sig, nonce, pk);
  const expected = expectedBool(v, 'verify_ok');
  if (ok !== expected) throw new Error('verify mismatch');
}

function challengeResponseTamper(v) {
  const sk = inputHex(v, 'secret_key_hex');
  if (sk.length !== 32) throw new Error('sk len');
  const nonce = inputHex(v, 'nonce_hex');
  const verifyNonce = inputHex(v, 'verify_nonce_hex');
  const sig = ed25519.sign(nonce, sk);
  const pk = ed25519.getPublicKey(sk);
  let ok;
  try {
    ok = ed25519.verify(sig, verifyNonce, pk);
  } catch {
    ok = false;
  }
  const expected = expectedBool(v, 'verify_ok');
  if (ok !== expected) throw new Error(`verify_ok mismatch: got ${ok} expected ${expected}`);
}

function freshnessCheck(v) {
  const iat = Number(v.input.proof_iat);
  const now = Number(v.input.now);
  const window = Number(v.input.window_seconds);
  const fresh = Math.abs(now - iat) <= window;
  const expected = v.expected_output.fresh;
  if (fresh !== expected) throw new Error(`fresh mismatch: got ${fresh} expected ${expected}`);
}

function delegate(v) {
  const parent = v.input.parent_scopes;
  const child = v.input.requested_child_scopes;
  if (!Array.isArray(parent) || !Array.isArray(child)) throw new Error('bad inputs');
  for (const p of parent) {
    if (!scopeIsValid(p)) throw new Error(`parent scope invalid: ${p}`);
  }
  const allowed = child.every((c) => parent.some((p) => scopeImplies(p, c)));
  const expected = expectedBool(v, 'allowed');
  if (allowed !== expected) throw new Error(`allowed mismatch: got ${allowed} expected ${expected}`);
}

function delegateChain(v) {
  const root = v.input.root_scopes;
  const chain = v.input.chain_grants;
  if (!Array.isArray(root) || !Array.isArray(chain)) throw new Error('bad inputs');
  let parent = root;
  let allowed = true;
  for (const grant of chain) {
    if (!grant.every((c) => parent.some((p) => scopeImplies(p, c)))) {
      allowed = false;
      break;
    }
    parent = grant;
  }
  const expected = expectedBool(v, 'allowed');
  if (allowed !== expected) throw new Error(`allowed mismatch: got ${allowed} expected ${expected}`);
}

function delegateTtl(v) {
  const parentExp = Number(v.input.parent_exp);
  const childExp = Number(v.input.child_exp_requested);
  const allowed = childExp <= parentExp;
  const expected = expectedBool(v, 'allowed');
  if (allowed !== expected) throw new Error(`allowed mismatch: got ${allowed} expected ${expected}`);
}

function revocationCascade(v) {
  const tree = v.input.tree;
  const revoke = v.input.revoke;
  const invalidated = [];
  const stillValid = [];
  function walk(node, parentRevoked) {
    if (!node || typeof node !== 'object') return;
    const id = node.id || node.root;
    if (typeof id !== 'string' || id.length === 0) return;
    const thisRevoked = parentRevoked || id === revoke;
    if (thisRevoked) invalidated.push(id);
    else stillValid.push(id);
    if (Array.isArray(node.children)) {
      for (const c of node.children) walk(c, thisRevoked);
    }
  }
  walk(tree, false);
  const sortStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const gotInv = [...invalidated].sort(sortStr);
  const gotOk = [...stillValid].sort(sortStr);
  const expInv = [...(v.expected_output.invalidated || [])].sort(sortStr);
  const expOk = [...(v.expected_output.still_valid || [])].sort(sortStr);
  if (gotInv.length !== expInv.length || gotInv.some((x, i) => x !== expInv[i])) {
    throw new Error(`invalidated mismatch: got ${JSON.stringify(gotInv)} expected ${JSON.stringify(expInv)}`);
  }
  if (gotOk.length !== expOk.length || gotOk.some((x, i) => x !== expOk[i])) {
    throw new Error(`still_valid mismatch: got ${JSON.stringify(gotOk)} expected ${JSON.stringify(expOk)}`);
  }
}

// --- SLIP-0010 Ed25519 wallet derivation ---

function hmacSha512(key, data) {
  return createHmac('sha512', key).update(data).digest();
}

function slip10MasterEd25519(seed) {
  const i = hmacSha512(Buffer.from('ed25519 seed', 'utf8'), seed);
  return { sk: i.subarray(0, 32), cc: i.subarray(32, 64) };
}

function slip10DeriveEd25519(parentKey, parentCc, index) {
  const data = Buffer.alloc(1 + 32 + 4);
  data[0] = 0x00;
  parentKey.copy(data, 1);
  data.writeUInt32BE(index >>> 0, 33);
  const i = hmacSha512(parentCc, data);
  return { sk: Buffer.from(i.subarray(0, 32)), cc: Buffer.from(i.subarray(32, 64)) };
}

function parseBip32Path(path) {
  if (typeof path !== 'string' || !path.startsWith('m')) throw new Error("path must start with 'm'");
  const rest = path.slice(1).replace(/^\/+/, '');
  if (rest.length === 0) return [];
  const out = [];
  for (const seg of rest.split('/')) {
    const hardened = seg.endsWith("'") || seg.endsWith('h');
    const numStr = seg.replace(/[hH']/g, '');
    const n = parseInt(numStr, 10);
    if (!Number.isInteger(n)) throw new Error(`bad segment '${seg}'`);
    out.push({ raw: n, hardened });
  }
  return out;
}

function deriveFull(seed, path) {
  const segments = parseBip32Path(path);
  for (const s of segments) if (!s.hardened) throw new Error('ed25519 hardened-only');
  let { sk, cc } = slip10MasterEd25519(seed);
  for (const s of segments) {
    const idx = (s.raw | 0x80000000) >>> 0;
    const next = slip10DeriveEd25519(Buffer.from(sk), Buffer.from(cc), idx);
    sk = next.sk;
    cc = next.cc;
  }
  return { sk: Buffer.from(sk), cc: Buffer.from(cc) };
}

function deriveMasterEd25519(v) {
  const seed = inputHex(v, 'seed_hex');
  const { sk, cc } = slip10MasterEd25519(seed);
  const pk = ed25519.getPublicKey(sk);
  const eo = v.expected_output || {};
  if (typeof eo.secret_key_hex === 'string' && hex(sk) !== eo.secret_key_hex)
    throw new Error(`sk mismatch: got ${hex(sk)} expected ${eo.secret_key_hex}`);
  if (typeof eo.chain_code_hex === 'string' && hex(cc) !== eo.chain_code_hex)
    throw new Error(`cc mismatch: got ${hex(cc)} expected ${eo.chain_code_hex}`);
  if (typeof eo.public_key_hex === 'string' && hex(pk) !== eo.public_key_hex)
    throw new Error(`pk mismatch: got ${hex(pk)} expected ${eo.public_key_hex}`);
}

function derivePathEd25519(v) {
  const seed = inputHex(v, 'seed_hex');
  const path = v.input.path;
  if (typeof path !== 'string') throw new Error('path');
  const { sk, cc } = deriveFull(seed, path);
  const pk = ed25519.getPublicKey(sk);
  const eo = v.expected_output || {};
  if (typeof eo.secret_key_hex === 'string' && hex(sk) !== eo.secret_key_hex)
    throw new Error(`sk mismatch: got ${hex(sk)} expected ${eo.secret_key_hex}`);
  if (typeof eo.chain_code_hex === 'string' && hex(cc) !== eo.chain_code_hex)
    throw new Error(`cc mismatch: got ${hex(cc)} expected ${eo.chain_code_hex}`);
  if (typeof eo.public_key_hex === 'string' && hex(pk) !== eo.public_key_hex)
    throw new Error(`pk mismatch: got ${hex(pk)} expected ${eo.public_key_hex}`);
  if (typeof eo.length_bytes === 'number' && eo.length_bytes !== sk.length)
    throw new Error(`length mismatch: got ${sk.length} expected ${eo.length_bytes}`);
}

function deriveTwice(v) {
  const seed = inputHex(v, 'seed_hex');
  const path = v.input.path;
  const a = deriveFull(seed, path).sk;
  const b = deriveFull(seed, path).sk;
  const equal = bytesEq(a, b);
  const expected = v.expected_output.equal;
  if (equal !== expected) throw new Error(`equal mismatch: got ${equal} expected ${expected}`);
}

function deriveTwo(v) {
  const seed = inputHex(v, 'seed_hex');
  const a = deriveFull(seed, v.input.path_a).sk;
  const b = deriveFull(seed, v.input.path_b).sk;
  const equal = bytesEq(a, b);
  const expected = v.expected_output.equal;
  if (equal !== expected) throw new Error(`equal mismatch: got ${equal} expected ${expected}`);
}

function derivePathEd25519ExpectFail(v) {
  const path = v.input.path;
  const segs = parseBip32Path(path);
  const allHardened = segs.every((s) => s.hardened);
  const expected = expectedBool(v, 'derive_ok');
  if (allHardened !== expected) {
    throw new Error(`derive_ok mismatch: all_hardened=${allHardened} expected=${expected}`);
  }
}
