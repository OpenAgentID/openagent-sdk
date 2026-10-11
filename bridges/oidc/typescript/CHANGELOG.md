# Changelog

### 0.2.0 qualification correction

- Use the patched Vitest 4.1.11 development runner and coverage tool.
- Accept the existing `agent:instance` DID kind and verify its full RP flow.

## 0.2.0 — 2026-10-11

- Add a maintained OIDC provider adapter with registered clients, real private signing JWKs, discovery/public JWKS, authorization code, mandatory PKCE S256, signed ID tokens and UserInfo.
- Require cryptographic agent possession and signed owner-chain callbacks, authoritative revocation/owner rechecks, durable production storage, persistent grant owner bindings and explicit cookie signing keys.
- Add LifeID human JWT federation through trusted JWKS, exact issuer/audience/expiry checks and proven owner/organization matching; preserve literal legacy DIDs.
- Remove legacy dummy keys, unsigned token responses and fabricated ACTs; require real identity-custody and capability-broker callbacks. Require human JWT audience and expiry and correct the OAS SDK peer range.
- Add real RSA/Ed25519 and HTTP relying-party tests covering discovery, code/PKCE, signatures, replay, owner mismatch and revocation. Node minimum is 20.19; production hosting/LifeID registration is a consumer deployment responsibility.


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
