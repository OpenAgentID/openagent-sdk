# Changelog

All notable changes to `@openagent/mcp` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Breaking:** package renamed from `@openagent/mcp` to `@openagentid/mcp`. The `@openagent` npm scope is squatted by a third party; the project now publishes under the `@openagentid` scope, matching the GitHub org OpenAgentID. Consumers must update dependency names and imports. Effective with the first npm publish under the new scope.

## [0.1.0] - 2026-04-11

### Added

- `withOpenAgent(server, config)` — Proxy-based middleware that wraps any
  `@modelcontextprotocol/sdk` `McpServer` instance and runs every tool
  call through an OpenAgent identity verification + scope enforcement
  pipeline. Intercepts both `tool()` (deprecated) and `registerTool()`
  registration paths.
- `withOpenAgentClient(client, config)` — Client-side interceptor that
  signs outbound `callTool` requests with the caller's DID and proof
  (Arsenal ACT or challenge response), injecting an
  `_meta.openagent.identity` envelope. Forwards all other client
  methods unchanged.
- `OpenAgentMcpConfig` — `agent`, `requireScopes`, `requireIdentity`,
  `skillsPolicy`, `preCall`, `postCall`, `onError`, `scopeFormat`.
- `createSkillsPolicy(options)` — Composable hook for SKILLS.md-style
  policy enforcement on skill-like tool calls. Default matchers:
  `invoke_skill`, `run_skill`, `execute_skill`, `skill.invoke`,
  `skill.run`.
- `InMemorySkillsPolicyStore` — Reference implementation of the
  `SkillsPolicyStore` interface, suitable for tests and small
  deployments.
- Typed errors: `OpenAgentMcpError`, `MissingIdentityError`,
  `IdentityVerificationError`, `AuthorizationDeniedError`,
  `SkillsPolicyDeniedError`. Each carries a JSON-RPC error code in the
  `-32000`..`-32099` server-error range.
- Audit metadata stamping — successful tool results carry an
  `audit_id`, `verified_did`, and `scopes` block under
  `_meta.openagent` so callers can correlate logs end-to-end.
- Vitest test suite — unit tests against a synthetic server and
  integration tests against a real `@modelcontextprotocol/sdk`
  `McpServer` connected via `InMemoryTransport`.
- Built and published against `@modelcontextprotocol/sdk@^1.27.0`.
- Documentation: README quickstart, hooks reference, errors table,
  configuration reference, links to <https://openagent.id/docs/integrations/mcp>.
