# Changelog

All notable changes to `openagent-crypto-wasm` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-07-31

### Added

- **ACT verification through WASM.** `act_verify()` runs the full normative
  procedure from the canonical `agent-capability-token` crate - envelope
  decode, version/algorithm checks, Ed25519 signature verification before
  any claim check, temporal checks with leeway, issuer/audience/scope
  policy - and returns the claims as JSON. `act_decode_unverified()` decodes
  without verifying for diagnostics, with a mandatory `UNVERIFIED:` prefix
  so the output cannot be mistaken for verified claims. The canonical
  crate's `sign` feature stays off in this package: it never holds a signing
  path. The smoke test now proves seven ACT behaviors through the built
  artifact against a fixture minted by `examples/mint_act.rs` (valid token,
  wildcard coverage, scope refusal, audience refusal, expiry, foreign key,
  unverified decode marking).
- The npm package is now buildable and verified: `scripts/build-wasm.mjs`
  produces the `@openagent/crypto-wasm` package with **two targets** -
  `bundler` (browsers, bundlers, Deno, Bun, Workers) and `nodejs` (Node,
  whose ESM loader cannot consume the bundler target's static `.wasm`
  import) - wired through conditional exports with the `node` condition
  first. `scripts/smoke-test.mjs` proves the publishable artifact loads and
  runs Ed25519 keygen/sign/verify, tamper and foreign-key rejection, BLAKE3,
  and HKDF-SHA256 in Node; both scripts run in CI on every change. The `pkg/`
  output is a build artifact and is not committed.

## [0.1.1] - 2026-07-31

### Fixed

- Fixed license copyright holder (L1fe Labs, Inc.) and added copyright footers to all READMEs. No functional changes.

## [0.1.0] — 2026-04-11

### Added

- Initial public release of `openagent-crypto-wasm`, the foundational
  cryptographic primitive crate that Arsenal-TS, AEGIS-TS, and OpenAgent SDK
  TS depend on. Single source of truth for crypto correctness across Rust
  and TypeScript via wasm-bindgen.
- **Ed25519** module with `generate_keypair`, `sign`, `verify`,
  `public_from_private`, `keypair_from_signing_key`. RFC 8032 §7.1 test
  vectors 1, 2, and 3 included as unit tests.
- **X25519** module with `generate_keypair`, `diffie_hellman`,
  `public_from_secret`. RFC 7748 §6.1 Alice/Bob test vector included.
- **FROST-Ed25519** (RFC 9591) module exposing the four-stage protocol:
  `trusted_keygen`, `sign_round1`, `sign_round2`, `aggregate`, plus
  `verify`. Returns standard 64-byte Ed25519 signatures verifiable by any
  RFC 8032 verifier. Full 2-of-3 round-trip integration test.
- **HKDF-SHA256** (RFC 5869) module with `extract`, `expand`, and combined
  `derive`. Test cases 1, 2, and 3 from RFC 5869 §A included as vectors.
- **BLAKE3** module with `hash`, `keyed_hash`, `derive_key`. Empty-input
  constant verified against the published BLAKE3 reference.
- **SHA-256 / SHA-512** module (FIPS 180-4). NIST CAVP "abc" and empty-input
  vectors included for both digests.
- **AES-256-GCM** AEAD with `encrypt`/`decrypt`. NIST GCMVS empty-plaintext
  empty-AAD vector included; tag-mismatch and AAD-mismatch failure cases
  exercised.
- **XChaCha20-Poly1305** AEAD with `encrypt`/`decrypt` and tag-failure tests.
- **Argon2id** password hashing via the `argon2` crate's PHC string format,
  with `hash_password` / `verify_password`.
- **JCS canonicalization** (RFC 8785) of arbitrary JSON via `serde_jcs`.
- **Multibase base58btc** `encode`/`decode` (W3C multibase, `z` prefix).
- **Constant-time** byte equality (`ct_eq`) and a `random_bytes`/`fill_random`
  helper backed by `getrandom`.
- **wasm-bindgen** export layer (`wasm_api`) gated behind the `wasm` feature.
  Exposes every primitive as a TypeScript-typed function. The same crate
  remains usable from native Rust via the default `native` feature.
- **Native vs WASM** build configuration: `crate-type = ["cdylib", "rlib"]`
  with mutually-exclusive `native` (default) and `wasm` features so
  downstream Rust crates and `wasm-pack` builds share one source tree.
- **Integration test suite** (`tests/integration.rs`) covering full Ed25519,
  X25519+HKDF+AES-GCM, JCS+BLAKE3+sign+verify, Argon2id, multibase round-trip,
  XChaCha20+HKDF, FROST 2-of-3, and SHA-2 known-digest paths.
- README with Rust and TypeScript usage examples and `wasm-pack` build
  commands for `bundler`, `nodejs`, and `web` targets.

### Security

- `#![forbid(unsafe_code)]` enforced at the crate root.
- All secret comparisons performed via `subtle::ConstantTimeEq`.
- Ed25519 signing keys and X25519 secret keys are zeroized on drop.
- Pure Rust implementation — no `openssl`, no C FFI, no GPL dependencies.
- Every fallible primitive returns a typed `CryptoError` with an actionable
  message. No `unwrap()` or `panic!()` on user input.
