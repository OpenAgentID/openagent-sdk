# OpenAgent SDK Conformance Suite

Language-neutral test vectors plus two runners (Rust and TypeScript) that exercise the same
inputs against the reference implementations of Arsenal, AEGIS, OpenAgent SDK and the
OpenAgent WASM crypto core. Parity across languages is proven by diffing outputs, not by
hand-checking code.

## Structure

```
conformance/
├── vectors/               # Language-neutral JSON test vectors
│   ├── crypto/            # Ed25519, HKDF, BLAKE3, AES-GCM, JCS, FROST-Ed25519
│   ├── oas/               # DID parsing, lineage verify, document signing
│   ├── arsenal/           # ACT encoding, scope parsing, policy evaluation
│   ├── aegis/             # Verify pipeline, delegation, wallet derivation
│   └── openagent/         # Agent creation, skill policy
├── fixtures/              # Reference fixtures with their own schemas
│   └── glyph/             # Nine upstream Rust Glyph cases checked by SDK tests
├── runner-rust/           # Rust runner (cargo binary)
├── runner-ts/              # TypeScript runner (Node 20 ES modules)
├── scripts/
│   ├── run-all.sh          # Build + run both runners, emit markdown summary
│   └── generate-vectors.rs # Regenerate vectors from the Rust reference
└── CHANGELOG.md
```

## Vector shape

Every vector file is a JSON document with this top-level shape:

```jsonc
{
  "category": "crypto",
  "name": "ed25519",
  "description": "RFC 8032 §7.1 Ed25519 test vectors and OAS extensions",
  "vectors": [
    {
      "name": "rfc8032-test-1",
      "description": "RFC 8032 §7.1 test 1",
      "tags": ["rfc8032", "kat"],
      "input":  { "operation": "sign_and_verify", "secret_key_hex": "..." },
      "expected_output": { "signature_hex": "..." }
    }
  ]
}
```

Each vector has a `name`, optional `description`/`tags`, an `input` object whose
`operation` field selects the handler, and an `expected_output` object that the runner
diffs against the observed output.

The Glyph reference fixture uses the upstream payload/codeword/grid/palette schema.
It lives in `fixtures/glyph/avatar-v1.json`, outside the generic vector corpus,
and all nine cases run in `sdks/typescript/test/glyph.test.ts` during SDK CI.
Those tests compare each codeword byte, grid cell and palette color with the
independently generated Rust reference. The shared runners retain their 222
cases; the nine Glyph cases are additional SDK coverage.

## Running

```bash
# Rust runner (reference implementation)
cd runner-rust
cargo run --release -- ../vectors --junit ../.reports/rust.xml

# TypeScript runner (validated against Rust)
cd runner-ts
npm install
node src/main.mjs ../vectors --junit ../.reports/ts.xml

# Both runners + markdown summary
scripts/run-all.sh
```

`run-all.sh` builds both runners, runs them against the same vectors, and writes
`.reports/SUMMARY.md` with pass/fail counts, drift metrics, and JUnit paths.

## Regenerating vectors

Arsenal, AEGIS, and OpenAgent vectors are derived from the Rust reference
implementation. To regenerate them after modifying `scripts/generate-vectors.rs`:

```bash
cd runner-rust
cargo run --release --bin generate-vectors -- ../.generated
# Review diffs in .generated/ and copy into vectors/ when you are satisfied.
```

Crypto vectors from public standards (RFC 8032, RFC 5869, NIST GCMtestvectors,
RFC 8785, BLAKE3 reference suite) are committed as-is and never regenerated.

## Known-answer test sources

| Category     | Source                                               |
|--------------|------------------------------------------------------|
| ed25519      | RFC 8032 §7.1 (tests 1–4 + SHA-512 collisions)       |
| hkdf         | RFC 5869 Appendix A (vectors 1–7)                    |
| aes-gcm      | NIST GCMtestvectors.zip (TC1–TC4, TC6–TC18 subset)   |
| blake3       | BLAKE3 reference implementation test suite           |
| jcs          | RFC 8785 Appendix B examples + OAS lineage payload   |
| frost-ed25519| Property-based (not KAT; exercised in SDK unit tests)|

## Filtering

Both runners accept `--filter <category>[:<name-substring>]`:

```bash
cargo run --release -- ../vectors --filter crypto
cargo run --release -- ../vectors --filter oas:parse-hmr
```

## Exit codes

- `0` — all vectors passed
- `1` — at least one vector failed
- `2` — IO or JSON parse error

## CI integration

Both runners emit JUnit XML via `--junit <path>`. The reports are schema-compatible
with the JUnit xunit format used by GitHub Actions, CircleCI, and GitLab runners.

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](../LICENSE-APACHE) or [MIT license](../LICENSE-MIT), at your option.
