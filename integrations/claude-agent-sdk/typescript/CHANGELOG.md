# Changelog

All notable changes to `@openagent/claude-agent` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-04-11

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
