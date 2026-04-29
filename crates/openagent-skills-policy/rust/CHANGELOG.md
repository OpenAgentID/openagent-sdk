# Changelog

All notable changes to the `openagent-skills-policy` Rust crate are recorded
here. This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the crate adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-04-11

### Added

- Initial release.
- `SkillsPolicy` engine with `from_yaml` / `from_file` loaders, `can_invoke`
  read-only check, and `record_invocation` state-changing authorization
  that advances the rate limiter and appends an audit receipt.
- Six policy dimensions, all optional and per-skill:
  - `allow` / `deny` allow-list and deny-list semantics.
  - `rate_limit` with a GCRA algorithm and human-friendly window strings
    (`1s`, `5m`, `1h`, `1d`).
  - `arg_constraints` JSON Schema validation (Draft 7), compiled at load
    time via `jsonschema` and cached per skill.
  - `time_windows` with UTC hour ranges, overnight support, and optional
    weekday filters.
  - `require_consent` for human-in-the-loop approval gating.
  - `audit_level` with `none` / `hash` / `full` tiers.
- Default rule (`default.allow`) applied when a skill has no per-skill entry.
- `Did` wrapper with strict validation for `did:method:id` strings.
- `SkillsManifest` parser for `SKILLS.md` files — line-based scanner that
  extracts `##`-level headings as skill names with their descriptions.
- `AuditChain` with hash-chained `Receipt`s using BLAKE3. Every receipt's
  hash is `BLAKE3(previous_hash || canonical_payload)`. `AuditChain::verify`
  recomputes the entire chain for tamper detection.
- Integration with `arsenal-core` error types via `arsenal_error_from` so
  callers can surface skills-policy errors through existing Arsenal plumbing.
- Fixture `fixtures/SKILLS.md` used by integration tests to cover the full
  policy surface against a realistic skill set.

### Security

- `#![forbid(unsafe_code)]` at the crate root.
- `#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]` to
  match the Arsenal workspace's zero-panic policy.
- `MAX_SKILL_RULES = 256` bound on policy documents to prevent unbounded
  memory growth.
- Rate-limit denials leave the audit chain untouched so forensic analysis
  only sees invocations that were actually authorized.
- `audit_level: none` returns a sentinel receipt and does not persist
  argument hashes to the chain; `hash` persists only a BLAKE3 digest;
  `full` persists the raw arguments.
