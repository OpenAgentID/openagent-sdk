# Contributing to the OpenAgent SDK

The OpenAgent SDK is the developer facade over the identity stack: OAS
identity, Arsenal credentials, AEGIS verification, one import per language.
Rust (`sdks/rust`) and TypeScript (`sdks/typescript`) are the reference pair;
the conformance suite (`conformance/`) is the contract that keeps every
language agreeing.

## Build and verify

```bash
# Rust (each crate is a standalone package)
(cd sdks/rust && cargo fmt --all -- --check && cargo clippy --all-targets && cargo test)
(cd crates/openagent-crypto-wasm && cargo fmt --all -- --check && cargo clippy --all-targets && cargo test)
(cd crates/openagent-auth-protocol && cargo fmt --all -- --check && cargo clippy --all-targets && cargo test)

# TypeScript
(cd sdks/typescript && npm install && npm run typecheck && npm test && npm run build)

# Conformance - both runners against the same vectors
conformance/scripts/run-all.sh
```

All of this runs in CI (`.github/workflows/ci.yml`). The conformance run is
the merge gate that matters most: if the two runners disagree with the same
vectors, the languages have diverged and nothing else ships until they agree
again.

## Rules

- **No stubs in production paths.** Testing backends live in dedicated
  testing packages; the production facade requires real protocol crates and
  fails closed. A silent fake-signature fallback once shipped here before -
  that class of bug is why this rule exists.
- **Update the changelog in the same change** (`sdks/rust/CHANGELOG.md`,
  `sdks/typescript/CHANGELOG.md` as applicable).
- **Conventional commits**, breaking changes marked `!`. No AI-tool
  attribution.
- **Vectors before features.** A new cross-language behavior gets a
  conformance vector with the implementation, or it does not merge.
- **npm packages live under `@openagent/*`.** Rust crates name
  `openagent-*`. No new scopes.

## License

Apache-2.0 OR MIT. By contributing you agree your contributions are licensed
under both.
