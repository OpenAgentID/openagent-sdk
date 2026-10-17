# Changelog

All notable changes to `@openagentid/claude-agent` are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each date is the UTC day npm published that
version.

## [Unreleased]

- Develop and test against `@openagentid/sdk` 0.8.0 and Vitest 4.1.11; CI also tests the package against the SDK built from the same commit.
- Ship the verbatim Apache License, Version 2.0 text in `LICENSE-APACHE`.

## [0.2.1] - 2026-10-17

- Accept `@openagentid/sdk` 0.8.0 beside 0.7.x (peer range `^0.7.2 || ^0.8.0`). No API change: the
  package's typecheck, tests and build are qualified against a packed SDK 0.8.0 as well as the published 0.7.2.

## [0.2.0] - 2026-10-12

- Add real Claude Agent SDK options.hooks adapter with per-session state, native deny decisions, skill policy and tool failure audit. Adapt current SDK signer custody explicitly. Replace the fictional plugins example with executable real-key hook checks.

## [0.1.1] - 2026-08-01

### Fixed

- Fixed license copyright holder (L1fe Labs, Inc.) and added copyright footers to all READMEs. No functional changes.

## [0.1.0] - 2026-08-01

### Added

- Initial release of the OpenAgent plugin for the Claude Agent SDK.
- `openAgentPlugin({ agent, capabilities, skillsPolicy, audit })` factory.
- Lifecycle hooks: `onSessionStart`, `preToolUse`, `postToolUse`,
  `onMessage`, `onSkillInvoke`, `onSessionEnd`.
- `StaticCapabilityChecker` with literal + wildcard scope matching.
- `DenyUnlessScopedSkillsPolicy` (default), `AllowListSkillsPolicy`,
  and `CompositeSkillsPolicy`.
- Hash-chained audit log with `verifyChain()`, BLAKE3-with-SHA256-fallback.
- Built-in audit sinks: `InMemoryAuditSink`, `ConsoleAuditSink`,
  `FanOutAuditSink`.
- Optional Ed25519 message signing on outbound messages.
- Two deny modes: `'throw'` (default) and `'block'`.
- Vitest test suite covering plugin factory, every hook, policy
  primitives, audit chain integrity, tampering detection, and SKILLS.md
  integration.
- TypeScript type exports for `OpenAgentIdentity`, `CapabilityChecker`,
  `SkillsPolicy`, `AuditSink`, `AuditRecord`, and the full hook input /
  output set.

### Notes

- Peer deps: `@anthropic-ai/claude-agent-sdk` (required),
  `@openagent/sdk` (optional — the plugin is structurally compatible
  but does not import it at runtime).
- BLAKE3 is loaded lazily; if the `blake3` npm package is not installed
  the plugin falls back to Node's built-in SHA-256.

### Changed

- **Breaking:** the package is `@openagentid/claude-agent`; the source previously used the `@openagent/claude-agent` name, which this project never published because a third party holds the `@openagent` npm scope. Dependency names and imports use `@openagentid/*`.
