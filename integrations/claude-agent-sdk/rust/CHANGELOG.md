# Changelog

All notable changes to `openagent-claude-agent` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `deny_unless_scoped_denies_missing` now asserts the capability checker's
  propagated denial reason (`no matching scope for ...`) rather than the
  policy's `missing scope` fallback, which only applies when a checker denies
  without giving a reason. Matches the TypeScript reference suite; no behavior
  change.

## [0.1.0] — 2026-04-11

### Added

- Initial release of the Rust analog of `@openagent/claude-agent`.
- `OpenAgentIdentity` trait + default `Identity` implementation
  (deterministic in-process signer for tests / dev).
- `CapabilityChecker` trait + `StaticCapabilityChecker` with literal
  and wildcard scope matching.
- `SkillsPolicy` trait + `DenyUnlessScopedSkillsPolicy` (default),
  `AllowListSkillsPolicy`, and `CompositeSkillsPolicy`.
- `OpenAgentHooks` trait — the framework-agnostic lifecycle contract.
- `OpenAgentPlugin` composition root with the full hook implementation:
  `session_start`, `session_end`, `pre_tool_use`, `post_tool_use`,
  `on_message`, `on_skill_invoke`.
- `AuditChain` with hash-chained records, BLAKE3 over canonical JSON,
  `verify_chain()`, and `InMemoryAuditSink` / `FanOutAuditSink`.
- Integration test suite covering session lifecycle, scope enforcement,
  wildcard scopes, deny modes, skills policy default-deny, audit chain
  integrity, tampering detection, and message signing.
- Optional `skills-policy` feature gate for the path-dep on the
  `openagent-skills-policy` reference crate.

### Notes

- Anthropic does not currently ship an official Rust Claude Agent SDK.
  This crate is documented as the framework-agnostic Rust analog. The
  TypeScript package `@openagent/claude-agent` remains the reference
  integration.
- Path dependency on `openagent-skills-policy` is feature-gated so this
  crate is buildable in isolation outside the monorepo.
