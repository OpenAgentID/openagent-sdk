# Contributing to the OpenAgent SDK

The OpenAgent SDK is the developer facade over the identity stack: OAS
identity, Arsenal credentials, AEGIS verification, one import per language.
Rust (`sdks/rust`) and TypeScript (`sdks/typescript`) are the reference pair;
the conformance suite (`conformance/`) is the contract that keeps every
language agreeing.

## Build and verify

```bash
# TypeScript: the SDK and every published companion package
(cd sdks/typescript && npm ci && npm run typecheck && npm test && npm run build && npm run size)
for package in sdks/testing adapters/http/typescript integrations/mcp/typescript \
  integrations/claude-agent-sdk/typescript bridges/scim/typescript bridges/oidc/typescript \
  adapters/eas/typescript; do
  (cd "$package" && npm ci && npm run typecheck && npm test && npm run build)
done
(cd packages/create-openagent && npm ci && npm run typecheck && npm test)

# Release metadata
node tools/release/sync-root-manifest.mjs --check
node tools/release/check-changelogs.mjs

# Rust (each crate is a standalone package)
(cd crates/openagent-crypto-wasm && cargo fmt --all -- --check && cargo clippy --all-targets && cargo test)
(cd crates/openagent-auth-protocol && cargo fmt --all -- --check && cargo clippy --all-targets && cargo test)
(cd sdks/rust && cargo fmt --all -- --check && cargo clippy --all-targets && cargo test)

# Conformance - both runners against the same vectors
conformance/scripts/run-all.sh
```

All of this runs in CI (`.github/workflows/ci.yml`). The conformance run is
the merge gate that matters most: if the two runners disagree with the same
vectors, the languages have diverged and nothing else ships until they agree
again.

`sdks/rust` and `conformance/runner-rust` build against the OAS, Arsenal and
AEGIS crates in private OpenAgentID repositories. Their CI jobs read those
crates with an organization secret, which GitHub does not pass to pull requests
from forks; every other job runs the same way for every contributor.

## How changes land

- Every change reaches `main` through a pull request with green CI and a
  review from a code owner (`.github/CODEOWNERS`). Automated reviewers comment;
  they do not stand in for that review.
- CI is never skipped: commits and pull request titles carrying `[skip ci]` or a
  similar marker fail the `release-checks` job.
- Releases are cut from tags by the release workflow; see
  [docs/RELEASING.md](docs/RELEASING.md). Version fields change only in the
  release commit.

## Rules

- **No stubs in production paths.** Testing backends live in dedicated
  testing packages; the production facade requires real protocol crates and
  fails closed. A silent fake-signature fallback once shipped here before -
  that class of bug is why this rule exists.
- **Update the changelog in the same change.** Add your entry under
  `## [Unreleased]` in the root `CHANGELOG.md` and, when you change a package,
  in that package's own `CHANGELOG.md` (it ships in the npm tarball).
  `node tools/release/check-changelogs.mjs` checks the format.
- **Conventional commits**, subject of at most 72 characters, breaking changes
  marked `!` with a migration note in the body. No co-author or AI-tool
  attribution trailers. Sign commits and tags where you can
  (`git config commit.gpgsign true`, `git config tag.gpgsign true`).
- **Vectors before features.** A new cross-language behavior gets a
  conformance vector with the implementation, or it does not merge.
- **npm packages live under `@openagentid/*`.** Rust crates name
  `openagent-*`. No new scopes.

## History

The repository's history starts at `5f8c493` (29 April 2026), the import of
the existing source. The `pre-restructure` tag (`30f6242`) marks the rollback
point before the OpenAgentID two-repository restructure. Earlier history is not
part of this repository.

## License

Apache-2.0 OR MIT. By contributing you agree your contributions are licensed
under both.
