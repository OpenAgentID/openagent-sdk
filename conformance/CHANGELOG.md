# Changelog

All notable changes to the OpenAgent SDK conformance suite are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-04-26

### Added

- Added draft shared OpenAgent lineage-authority vectors covering HMR direct authority, MHR authority, ENR authority, missing authority, malformed authority, revoked root, wrong org root, and stale authority context. The vector file is marked `draft_pending_sigil_gal_taxonomy` so Rust and TypeScript can align on behavior while exact Sigil GAL field names and error taxonomy are coordinated before locking.
- Added Rust and TypeScript conformance-runner handling for the draft `verify_lineage_authority` operation so both runners exercise the same privileged authority success and fail-closed cases.

## [0.1.0] - 2026-04-11

### Added

- Initial conformance test suite with 191 vectors across 17 files.
- Rust runner (`runner-rust`) loading vectors from `vectors/**/*.json`,
  diffing them against the reference Rust crypto stack, and emitting JUnit
  XML plus a text summary. Supports `--filter <category[:name]>`.
- TypeScript runner (`runner-ts`) validating the Node reference stack
  against the same vectors. Uses `@noble/curves/ed25519` and `@noble/hashes`
  for BLAKE3; Node `crypto` for HKDF and AES-GCM.
- `scripts/run-all.sh` orchestrator that builds both runners, runs them
  against the shared vectors, writes JUnit reports, and produces
  `SUMMARY.md` with per-category pass/fail counts and drift metrics.
- `scripts/generate-vectors.rs` utility for regenerating Arsenal, AEGIS,
  and OpenAgent vectors from the Rust reference implementation. Wired as a
  secondary `cargo` binary in `runner-rust`.
- Vector categories:
  - **crypto**: 65 vectors — Ed25519 (10), HKDF (10), BLAKE3 (12),
    AES-GCM (10), JCS (13), FROST-Ed25519 (10).
  - **oas**: 36 vectors — did-parse (16), document-sign (10),
    lineage-verify (10).
  - **arsenal**: 37 vectors — act-encode (10), scope-parse (15),
    policy-eval (12).
  - **aegis**: 31 vectors — delegation (11), verify-pipeline (10),
    wallet-derive (10).
  - **openagent**: 22 vectors — create-agent (10), skills-policy (12).
- Known-answer test vectors sourced from RFC 8032 §7.1, RFC 5869
  Appendix A (all 7 test vectors), RFC 8785 Appendix B, NIST
  GCMtestvectors subset, and the BLAKE3 reference implementation suite.

### Notes

- FROST-Ed25519 is exercised via property vectors (signed-blob verifies,
  tampered blob does not) rather than known-answer tests. The underlying
  `frost-ed25519` crate has its own KAT coverage in its upstream tests.
- SLIP-0010 Ed25519 wallet-derivation vectors match the spec test vector 1
  public keys as raw 32-byte Ed25519 keys, not the SLIP-0010 33-byte
  `0x00 || A` encoding.
- The NIST AES-192 test case (TC5) was replaced with the AES-256 TC16
  equivalent because the Rust `aes-gcm` crate does not implement AES-192.
- Conformance runners do not call into Arsenal, AEGIS, or OpenAgent SDK
  crates directly. They re-implement the same primitives the SDKs
  implement so the test is a true cross-implementation diff.
