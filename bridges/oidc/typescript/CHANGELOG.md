# Changelog

All notable changes to `@openagent/oidc` (TypeScript) will be documented in this file.

## [Unreleased]

### Changed

- **Breaking:** package renamed from `@openagent/oidc` to `@openagentid/oidc`. The `@openagent` npm scope is squatted by a third party; the project now publishes under the `@openagentid` scope, matching the GitHub org OpenAgentID. Consumers must update dependency names and imports. Effective with the first npm publish under the new scope.

## [0.1.1] - 2026-07-31

### Fixed

- Fixed license copyright holder (L1fe Labs, Inc.) and added copyright footers to all READMEs. No functional changes.

## [0.1.0] - 2026-04-11

### Added

- `OidcBridge` class with three core flows:
  - Flow 1: Human JWT -> Agent DID (derive agent under human lineage)
  - Flow 2: Agent ACT -> Bearer JWT (wrap for OAuth2-only services)
  - Flow 3: RFC 8693 Token Exchange
- Multi-provider support with auto-detection from JWT `iss` claim
- Single-provider shorthand constructor
- OIDC discovery with per-issuer caching
- JWKS fetching with caching and rotation-aware refresh
- JWT validation via `jose` (runtime-agnostic: Node, Bun, Deno, browsers, Workers)
- Deterministic HMR identifier derivation from OIDC subject claims
- Scope mapping (OIDC roles/scopes -> Arsenal capability scopes)
- Zod schema validation for all configuration and request types
- Comprehensive error types with error codes
