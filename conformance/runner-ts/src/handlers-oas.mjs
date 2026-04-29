// OAS handlers: DID parse, lineage verify, document sign/canonicalize.

import { Buffer } from 'node:buffer';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesEq, expectedBool, hex, inputHex, jcsStringify, op } from './util.mjs';

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

export function runOas(v) {
  const o = op(v);
  switch (o) {
    case 'parse':
      return parseDid(v);
    case 'verify_proof':
      return verifyProof(v);
    case 'generate_and_verify':
      return generateAndVerifyProof(v);
    case 'verify_signed_document':
      return verifySignedDocument(v);
    case 'canonicalize_document':
      return canonicalizeDocument(v);
    case 'sign_and_verify_document':
      return signAndVerifyDocument(v);
    default:
      throw new Error(`oas: unknown operation ${o}`);
  }
}

function parseOasDid(did) {
  if (!did.startsWith('did:')) throw new Error("missing 'did:' prefix");
  const rest = did.slice(4);
  const firstColon = rest.indexOf(':');
  if (firstColon < 0) throw new Error('missing namespace (components)');
  const method = rest.slice(0, firstColon);
  if (method !== 'oas') throw new Error(`unexpected method '${method}'`);
  const afterMethod = rest.slice(firstColon + 1);
  const secondColon = afterMethod.indexOf(':');
  if (secondColon < 0) throw new Error('missing kind (components)');
  const namespace = afterMethod.slice(0, secondColon);
  if (!namespace) throw new Error('missing namespace (components)');
  const tail = afterMethod.slice(secondColon + 1);
  if (!tail) throw new Error('missing kind (components)');

  // Compound kind: agent:instance:<id>
  const COMPOUND = 'agent:instance:';
  if (tail.startsWith(COMPOUND)) {
    const id = tail.slice(COMPOUND.length);
    if (!id) throw new Error('empty identifier after kind');
    return { namespace, kind: 'agent:instance', identifier: id };
  }

  const lastIdx = tail.indexOf(':');
  if (lastIdx < 0) throw new Error('missing identifier (kind or components)');
  const kind = tail.slice(0, lastIdx);
  const id = tail.slice(lastIdx + 1);
  if (!id) throw new Error('empty identifier');
  if (!KINDS.has(kind)) throw new Error(`unknown kind '${kind}'`);
  return { namespace, kind, identifier: id };
}

function parseDid(v) {
  const did = v.input.did;
  if (typeof did !== 'string') throw new Error('missing did');
  const expectedValid = expectedBool(v, 'valid');
  let parts = null;
  let err = null;
  try {
    parts = parseOasDid(did);
  } catch (e) {
    err = e.message;
  }
  if (expectedValid) {
    if (!parts) throw new Error(`expected parse to succeed: ${err}`);
    if (typeof v.expected_output.namespace === 'string' && parts.namespace !== v.expected_output.namespace)
      throw new Error(`namespace mismatch: got ${parts.namespace} expected ${v.expected_output.namespace}`);
    if (typeof v.expected_output.kind === 'string' && parts.kind !== v.expected_output.kind)
      throw new Error(`kind mismatch: got ${parts.kind} expected ${v.expected_output.kind}`);
    if (typeof v.expected_output.identifier === 'string' && parts.identifier !== v.expected_output.identifier)
      throw new Error(
        `identifier mismatch: got ${parts.identifier} expected ${v.expected_output.identifier}`
      );
    return;
  }
  if (parts) throw new Error('expected parse to fail but it succeeded');
  if (typeof v.expected_output.error_contains === 'string') {
    if (!err.includes(v.expected_output.error_contains)) {
      throw new Error(`expected error to contain '${v.expected_output.error_contains}', got '${err}'`);
    }
  }
}

function buildProofPayload(parent, child, path) {
  return Buffer.from(
    jcsStringify({
      parentDid: parent,
      childDid: child,
      derivationPath: path,
    }),
    'utf8'
  );
}

// Multibase base58btc decoder (z-prefix). Accepts Ed25519 multicodec keys
// which prepend a 0xed 0x01 multicodec header before the 32-byte key.
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58btcDecode(s) {
  const map = new Map();
  for (let i = 0; i < B58_ALPHABET.length; i++) map.set(B58_ALPHABET[i], i);
  let num = 0n;
  for (const ch of s) {
    const idx = map.get(ch);
    if (idx === undefined) throw new Error(`invalid base58 char: ${ch}`);
    num = num * 58n + BigInt(idx);
  }
  // Count leading '1's (zero bytes).
  let zeros = 0;
  for (const ch of s) {
    if (ch === '1') zeros += 1;
    else break;
  }
  const bytes = [];
  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn));
    num >>= 8n;
  }
  for (let i = 0; i < zeros; i++) bytes.unshift(0);
  return Buffer.from(bytes);
}

function multibaseDecode(s) {
  if (!s.startsWith('z')) throw new Error("multibase: missing 'z' prefix");
  return base58btcDecode(s.slice(1));
}

function stripEd25519Prefix(bytes) {
  if (bytes.length === 34 && bytes[0] === 0xed && bytes[1] === 0x01) return bytes.subarray(2);
  return bytes;
}

function b64uDecode(s) {
  // URL-safe base64, no padding.
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  const padded = s + '='.repeat(pad);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function verifyProof(v) {
  const proof = v.input.proof;
  if (!proof) throw new Error('missing proof');
  const parent = proof.parentDid;
  const child = proof.childDid;
  const path = proof.derivationPath;
  const pkMb = proof.publicKeyMultibase;
  const sigB64 = proof.signature;
  if (!parent || !child || !path || !pkMb || !sigB64) throw new Error('malformed proof');

  const raw = multibaseDecode(pkMb);
  const pk = stripEd25519Prefix(raw);
  const expected = expectedBool(v, 'verify_ok');
  if (pk.length !== 32) {
    if (expected) throw new Error(`pk wrong length: ${pk.length}`);
    return;
  }
  const sig = b64uDecode(sigB64);
  if (sig.length !== 64) {
    if (expected) throw new Error('signature wrong length');
    return;
  }
  const payload = buildProofPayload(parent, child, path);
  let ok;
  try {
    ok = ed25519.verify(sig, payload, pk);
  } catch {
    ok = false;
  }
  if (ok !== expected) {
    throw new Error(`verify_ok mismatch: got ${ok} expected ${expected}`);
  }
}

function generateAndVerifyProof(v) {
  const sk = inputHex(v, 'parent_secret_key_hex');
  if (sk.length !== 32) throw new Error('sk len');
  const parent = v.input.parent_did;
  const child = v.input.child_did;
  const path = v.input.derivation_path;
  if (!parent || !child || !path) throw new Error('missing did/path');
  const payload = buildProofPayload(parent, child, path);
  const sig = ed25519.sign(payload, sk);
  const pk = ed25519.getPublicKey(sk);
  const ok = ed25519.verify(sig, payload, pk);
  const expected = expectedBool(v, 'verify_ok');
  if (ok !== expected) throw new Error('roundtrip verify mismatch');
}

function verifySignedDocument(v) {
  const doc = v.input.document;
  if (doc === undefined) throw new Error('missing document');
  const sigB64 = v.input.signature_b64u;
  if (typeof sigB64 !== 'string') throw new Error('missing signature_b64u');
  const pk = inputHex(v, 'public_key_hex');
  if (pk.length !== 32) throw new Error('pk len');
  const canonical = Buffer.from(jcsStringify(doc), 'utf8');
  if (typeof v.expected_output.canonical === 'string') {
    const got = canonical.toString('utf8');
    if (got !== v.expected_output.canonical) {
      throw new Error(`canonical mismatch:\n  got      ${got}\n  expected ${v.expected_output.canonical}`);
    }
  }
  const sig = b64uDecode(sigB64);
  const expected = expectedBool(v, 'verify_ok');
  if (sig.length !== 64) {
    if (expected) throw new Error('sig wrong length');
    return;
  }
  let ok;
  try {
    ok = ed25519.verify(sig, canonical, pk);
  } catch {
    ok = false;
  }
  if (ok !== expected) {
    throw new Error(`verify_ok mismatch: got ${ok} expected ${expected}`);
  }
}

function canonicalizeDocument(v) {
  const doc = v.input.document;
  if (doc === undefined) throw new Error('missing document');
  const got = jcsStringify(doc);
  const expected = v.expected_output.canonical;
  if (typeof expected !== 'string') throw new Error('missing canonical');
  if (got !== expected) {
    throw new Error(`canonical mismatch:\n  got      ${got}\n  expected ${expected}`);
  }
}

function signAndVerifyDocument(v) {
  const sk = inputHex(v, 'secret_key_hex');
  if (sk.length !== 32) throw new Error('sk len');
  const doc = v.input.document;
  if (doc === undefined) throw new Error('missing document');
  const canonical = Buffer.from(jcsStringify(doc), 'utf8');
  const sig = ed25519.sign(canonical, sk);
  const pk = ed25519.getPublicKey(sk);
  const ok = ed25519.verify(sig, canonical, pk);
  const expected = expectedBool(v, 'verify_ok');
  if (ok !== expected) throw new Error('roundtrip verify mismatch');
}

// Exported for reuse by openagent handler.
export { buildProofPayload, jcsStringify as _jcs };
