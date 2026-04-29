# Changelog

All notable changes to `openagent-mcp` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-11

### Added

- `OpenAgentMiddleware` — async auth pipeline that runs on every tool
  call: extract identity envelope, verify, enforce scopes, run skills
  policy, run pre/post hooks, stamp audit metadata, surface typed
  errors on failure.
- `WithOpenAgent` extension trait — `handler.with_openagent(middleware)`
  wraps any `ToolHandler` and produces a `WrappedHandler` that is itself
  a `ToolHandler`. Drop-in replacement for the original.
- `ToolHandler` trait — minimal `list_tools` + `call_tool` surface so
  the middleware works with any MCP server runtime, not just upstream
  `rmcp`.
- `InMemoryToolHandler` — reference handler used by the test suite and
  as a tiny example of what a custom handler looks like.
- `Config` builder — `with_require_scopes`, `with_require_identity`,
  `with_skills_policy`, `with_pre_call`, `with_post_call`, `with_on_error`,
  `with_extra`. Cheap to clone via `Arc`.
- `Identity`, `VerifiedIdentity`, `IdentityVerifier`, `Agent` — core
  trait surface that production deployments wire up against the
  `openagent-sdk` Rust crate.
- `SkillsPolicy` + `InMemorySkillsStore` — SKILLS.md-style policy
  enforcement for skill-like tool calls. Default matchers:
  `invoke_skill`, `run_skill`, `execute_skill`, `skill.invoke`,
  `skill.run`. Customizable via `SkillsPolicy::with_extractor`.
- `McpAuthError` — typed error enum with variants for each rejection
  reason. `to_json_rpc()` renders the JSON-RPC error envelope. All
  codes lie in the `-32000..=-32099` server-error range.
- Audit metadata stamping — successful tool results carry an
  `audit_id`, `verified_did`, and `scopes` block under `meta.openagent`.
- Optional `rmcp` feature flag — pulls in `rmcp@^0.2` and exposes
  `RmcpOpenAgent`, a thin newtype that translates rmcp wire types to
  the middleware's internal `ToolCall` / `ToolResult` types so the rest
  of this crate stays insulated from rmcp API churn.
- `tokio::test` integration tests under `tests/server.rs` and
  `tests/skills.rs`. Shared test fakes live in `tests/common/mod.rs`.
- Documentation: README quickstart, hooks reference, errors table,
  versioning notes, links to <https://openagent.id/docs/integrations/mcp>.
