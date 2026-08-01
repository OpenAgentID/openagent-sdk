# Changelog

All notable changes to the `@openagent/skills-policy` package are recorded
here. This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Breaking:** package renamed from `@openagent/skills-policy` to `@openagentid/skills-policy`. The `@openagent` npm scope is squatted by a third party; the project now publishes under the `@openagentid` scope, matching the GitHub org OpenAgentID. Consumers must update dependency names and imports. Effective with the first npm publish under the new scope.

## [0.1.1] - 2026-07-31

### Fixed

- Fixed license copyright holder (L1fe Labs, Inc.) and added copyright footers to all READMEs. No functional changes.

## [0.1.0] — 2026-04-11

### Added

- Initial release. API shape mirrors the `openagent-skills-policy` Rust
  crate 1:1 so that a policy YAML evaluated in either language produces
  identical allow/deny decisions and verifiable audit receipts.
- `SkillsPolicy` engine with `fromYaml` / `fromFile` loaders, `canInvoke`
  read-only check, and `recordInvocation` authorization that advances
  the rate limiter and appends an audit receipt.
- Six policy dimensions per skill:
  - `allow` / `deny` allow-list and deny-list semantics.
  - `rate_limit` GCRA sliding-window rate limiter.
  - `arg_constraints` JSON Schema validation via Ajv 8 with draft-07 and
    `ajv-formats`, compiled at load time.
  - `time_windows` with UTC hour ranges, overnight support, and optional
    weekday filters.
  - `require_consent` HITL approval gate.
  - `audit_level` tiers (`none` / `hash` / `full`).
- `Did` wrapper for strict `did:method:id` validation.
- `SkillsManifest` parser for `SKILLS.md` — line-based scanner matching
  the Rust implementation byte-for-byte.
- `AuditChain` with hash-chained `Receipt`s using `@noble/hashes/blake3`.
  Canonical serialization matches the Rust crate exactly so receipts
  are cross-verifiable.
- Zod runtime schema for policy YAML — every authoring mistake fails
  loading rather than surfacing at invocation time.
- Typed error hierarchy (`SkillsPolicyError`, `NotAllowedError`,
  `RateLimitExceededError`, `ArgumentConstraintError`,
  `OutsideTimeWindowError`, `ConsentRequiredError`,
  `InvalidPolicyError`, `InvalidSkillsMarkdownError`) so callers can
  pattern-match with `instanceof` instead of parsing error messages.
- Optional peer dependency on `@arsenal/sdk` — installable stand-alone
  for downstream packages that want to governance skills without
  pulling the full Arsenal stack.

### Security

- Strict TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`)
  across the entire source tree.
- Policy documents are validated with Zod before the engine touches
  them.
- All audit receipts are produced by a pure `@noble/hashes` pipeline
  with no WASM dependencies.
