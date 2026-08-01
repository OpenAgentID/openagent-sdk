# openagent-crypto-wasm

Foundational cryptographic primitives for the OpenAgent ecosystem (Arsenal-TS,
AEGIS-TS, OpenAgent SDK TS, and the OAS reference implementations).

This crate is the **single source of truth** for crypto correctness across
Rust and TypeScript. The same Rust code compiles to native and to
WebAssembly so that downstream SDKs in any language receive byte-identical
results from byte-identical inputs.

## Why this exists

Every L1fe SDK that touches identity or capability tokens needs the same
cryptographic primitives. Re-implementing them in TypeScript invites subtle
divergence (constant-time bugs, encoding mismatches, off-by-one nonces).
`openagent-crypto-wasm` is the audit boundary: one Rust implementation,
shipped natively for Rust callers and as a WASM module for JavaScript callers.

## Primitives

| Family             | Operations                                                  |
|--------------------|-------------------------------------------------------------|
| Ed25519            | `generate_keypair`, `sign`, `verify`, `public_from_private` |
| X25519             | `generate_keypair`, `diffie_hellman`                        |
| FROST-Ed25519      | `trusted_keygen`, `sign_round1`, `sign_round2`, `aggregate`, `verify` |
| HKDF-SHA256        | `extract`, `expand`, `derive`                               |
| BLAKE3             | `hash`, `keyed_hash`, `derive_key`                          |
| SHA-256, SHA-512   | `hash`                                                      |
| AES-256-GCM        | `encrypt`, `decrypt`                                        |
| XChaCha20-Poly1305 | `encrypt`, `decrypt`                                        |
| Argon2id           | `hash_password`, `verify_password`                          |
| JCS (RFC 8785)     | `canonicalize`                                              |
| Multibase base58btc| `encode`, `decode`                                          |
| Constant-time      | `ct_eq`                                                     |

## Properties

- `#![forbid(unsafe_code)]` — no `unsafe` anywhere
- Pure Rust, no C FFI, no `openssl`
- Result-typed APIs — no panics on user input
- Constant-time secret comparisons via `subtle`
- Secret keys zeroized on drop
- Test-vector backed (RFC 8032, RFC 5869, RFC 7748, FIPS 180-4, NIST AES-GCM)

## Build (native Rust)

```bash
cargo build
cargo test
```

## Build (WebAssembly)

The crate ships as a `cdylib`+`rlib` so the same source builds for both
targets. Use `wasm-pack` for the WASM bundle:

```bash
# Browser / bundler target (Webpack, Vite, esbuild)
wasm-pack build \
  --target bundler \
  --release \
  --no-default-features --features wasm

# Node.js target
wasm-pack build \
  --target nodejs \
  --release \
  --no-default-features --features wasm

# Web (no bundler) target
wasm-pack build \
  --target web \
  --release \
  --no-default-features --features wasm
```

The output goes to `pkg/` and includes a generated `*.d.ts` so TypeScript
consumers get full type safety with no extra plumbing.

## Usage from Rust

```rust
use openagent_crypto_wasm::{ed25519, hkdf_sha256, blake3_hash, jcs};

// Sign / verify
let kp = ed25519::generate_keypair();
let sig = ed25519::sign(&kp.signing_key_bytes(), b"hello").unwrap();
ed25519::verify(&kp.verifying_key_bytes(), b"hello", &sig).unwrap();

// Derive a session key from a shared secret
let session = hkdf_sha256::derive(b"session-salt", b"ikm", b"alice<->bob", 32).unwrap();

// Hash JCS-canonicalized JSON
let canonical = jcs::canonicalize(r#"{"b":1,"a":2}"#).unwrap();
let digest = blake3_hash::hash(&canonical);
```

## Usage from TypeScript (after `wasm-pack build --target bundler`)

```ts
import init, * as crypto from "openagent-crypto-wasm";

await init();

// Ed25519
const kp = crypto.ed25519_generate_keypair();
const msg = new TextEncoder().encode("hello");
const sig = crypto.ed25519_sign(kp.signing_key, msg);
crypto.ed25519_verify(kp.verifying_key, msg, sig); // throws on failure

// HKDF-SHA256
const okm = crypto.hkdf_sha256_derive(
  new TextEncoder().encode("salt"),
  new TextEncoder().encode("ikm"),
  new TextEncoder().encode("info"),
  32,
);

// JCS canonicalization
const canonical = crypto.jcs_canonicalize('{"b":1,"a":2}');

// FROST 2-of-3 (JSON-shaped state across the boundary)
const bundleJson = crypto.frost_trusted_keygen(2, 3);
const bundle = JSON.parse(bundleJson);
```

## Tests

```bash
cargo test                                # native unit + integration tests
cargo test --doc                          # rustdoc examples
```

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT), at your option.
