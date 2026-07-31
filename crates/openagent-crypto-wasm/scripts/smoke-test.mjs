#!/usr/bin/env node
// Smoke test for the built @openagent/crypto-wasm package (nodejs target).
//
// Proves the artifact that would be published actually loads and runs its
// core primitives in Node: Ed25519 keygen/sign/verify (exceptional-verify:
// returns undefined on success, throws on failure), tamper rejection,
// BLAKE3, and HKDF-SHA256. Run after scripts/build-wasm.mjs.
//
// Usage: node scripts/smoke-test.mjs

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const wasm = require('../pkg/node/openagent_crypto_wasm.js');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL  ${name}: ${err.message}`);
  }
}

const kp = wasm.ed25519_generate_keypair();
const msg = new TextEncoder().encode('openagent smoke test');

check('ed25519 keypair is 32/32', () => {
  if (kp.signing_key.length !== 32 || kp.verifying_key.length !== 32) {
    throw new Error('unexpected key lengths');
  }
});

const sig = wasm.ed25519_sign(kp.signing_key, msg);

check('ed25519 sign/verify round trip', () => {
  wasm.ed25519_verify(kp.verifying_key, msg, sig);
});

check('tampered message is rejected', () => {
  let threw = false;
  try {
    wasm.ed25519_verify(kp.verifying_key, new TextEncoder().encode('tampered'), sig);
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('tampered message verified');
});

check('foreign key is rejected', () => {
  const other = wasm.ed25519_generate_keypair();
  let threw = false;
  try {
    wasm.ed25519_verify(other.verifying_key, msg, sig);
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('foreign key verified');
});

check('blake3 hashes to 32 bytes', () => {
  if (wasm.blake3_hash_bytes(msg).length !== 32) throw new Error('bad digest length');
});

check('hkdf extract/expand yields 32 bytes', () => {
  const prk = wasm.hkdf_sha256_extract(new TextEncoder().encode('salt'), msg);
  if (wasm.hkdf_sha256_expand(prk, new TextEncoder().encode('info'), 32).length !== 32) {
    throw new Error('bad okm length');
  }
});

check('public key derives from private', () => {
  const derived = wasm.ed25519_public_from_private(kp.signing_key);
  if (derived.length !== 32 || derived.toString() !== kp.verifying_key.toString()) {
    throw new Error('derived key mismatch');
  }
});

if (failures > 0) {
  console.error(`${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log('smoke test passed');
