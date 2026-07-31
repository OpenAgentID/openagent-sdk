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

// ---------------------------------------------------------------------------
// ACT verification - the canonical format, verified by the Rust crate through
// WASM. The fixture is minted by `cargo run --example mint_act`.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fixturePath = join(process.cwd(), 'scripts', 'act_fixture.hex');
const [pubHex, envelopeHex] = readFileSync(fixturePath, 'utf8').trim().split('\n');
const trustedKey = Uint8Array.from(Buffer.from(pubHex, 'hex'));
const envelope = Uint8Array.from(Buffer.from(envelopeHex, 'hex'));

// The fixture's claims are pinned: iat/nbf 1_800_000_000, exp 1_800_000_600.
const AT_VALID = 1800000300n;

check('act_verify accepts a valid token and returns claims', () => {
  const json = wasm.act_verify(
    envelope,
    trustedKey,
    'arsenal:broker:test-1',
    'omerta',
    ['tools:calendar:invoke'],
    0n,    AT_VALID,  );
  const claims = JSON.parse(json);
  if (claims.sub !== 'did:oas:l1fe:agent:smoke') throw new Error(`sub mismatch: ${claims.sub}`);
  if (claims.tenant_id !== 'tenant-a') throw new Error('tenant mismatch');
});

check('act_verify wildcard grant covers the required scope', () => {
  // The grant carries tools:*:invoke; the request tools:calendar:invoke is covered.
  const json = wasm.act_verify(
    envelope,
    trustedKey,
    'arsenal:broker:test-1',
    'omerta',
    ['tools:calendar:invoke'],
    0n,    AT_VALID,  );
  if (!json) throw new Error('wildcard grant did not cover');
});

check('act_verify rejects a scope the grant does not cover', () => {
  let threw = false;
  try {
    wasm.act_verify(
      envelope,
      trustedKey,
      'arsenal:broker:test-1',
      'omerta',
      ['billing:invoices:write'],
      0n,      AT_VALID,    );
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('uncovered scope accepted');
});

check('act_verify rejects the wrong audience', () => {
  let threw = false;
  try {
    wasm.act_verify(envelope, trustedKey, 'arsenal:broker:test-1', 'someone-else', [], 0n, AT_VALID);
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('wrong audience accepted');
});

check('act_verify rejects expiry at the boundary', () => {
  let threw = false;
  try {
    wasm.act_verify(envelope, trustedKey, 'arsenal:broker:test-1', 'omerta', [], 0n, 1800000601n);
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('expired token accepted');
});

check('act_verify rejects a foreign signing key', () => {
  let threw = false;
  try {
    const foreign = wasm.ed25519_generate_keypair();
    wasm.act_verify(envelope, foreign.verifying_key, 'arsenal:broker:test-1', 'omerta', [], 0n, AT_VALID);
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('foreign signature accepted');
});

check('act_decode_unverified marks its output as unverified', () => {
  const out = wasm.act_decode_unverified(envelope);
  if (!out.startsWith('UNVERIFIED:')) throw new Error('unverified prefix missing');
});

if (failures > 0) {
  console.error(`${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log('smoke test passed');
