# AGENTS.md

Rules for agents (human or otherwise) working in this repository.

## Non-negotiables

- **Changelog in the same change.** Add an entry under `## [Unreleased]` in
  the root `CHANGELOG.md` with every code, docs, test, config, or schema change,
  and in the changed package's own `CHANGELOG.md` when a published package
  changes. Work is not complete until the entries exist
  (`node tools/release/check-changelogs.mjs`).
- **Conventional commits.** `feat:`, `fix:`, `refactor:`, `test:`, `chore:`,
  `ci:`, `docs:`. Breaking changes carry `!` and a migration note in the body.
- **No AI-tool attribution** anywhere in git history - no Co-Authored-By
  trailers, no tool names in messages.
- **CI is the gate.** Run the same commands locally that
  `.github/workflows/ci.yml` runs before pushing: fmt, clippy, tests. Never
  skip CI (`[skip ci]` and similar markers fail the build).
- **Releases come from tags.** Version fields change only in the release
  commit; the release workflow publishes. See `docs/RELEASING.md`.
- **No placeholders.** No TODOs, no stub implementations presented as
  finished, no "temporary" shortcuts. Production-grade or not at all.
- **Fail closed.** Verification, authorization, and anchor checks error on
  the side of refusal.

## Repo-specific invariants

See CONTRIBUTING.md - it carries the build commands and the lessons-learned
rules that are specific to this repository. Read it before your first change.
