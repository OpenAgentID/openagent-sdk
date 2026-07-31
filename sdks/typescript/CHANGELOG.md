# Changelog

All notable changes to `@openagent/sdk` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-04-26

### Changed

- **Breaking. The silent stub fallback is removed.** Until now the SDK
  silently substituted fake implementations - `StubIdentityProvider` minted
  unsigned "signatures", `StubVerificationClient` accepted any `stub:` token,
  and a fallback Arsenal client echoed deterministic proxy URLs - whenever a
  protocol client was missing from `OpenAgentConfig.clients`. A production
  deployment with a misconfigured peer would sign and verify with fake
  cryptography without anyone having chosen that. The subsystems are now
  optional at construction and **fail closed at use**: `createAgent`,
  `loadAgent`, `authenticate`, `credentialsFor`, and the escape hatches throw
  a `ConfigError` naming the missing client, the package a real one comes
  from (`@openagent/oas-sdk`, `@openagent/arsenal-sdk`,
  `@openagent/aegis-sdk`), and the testing package for unit tests. The stub
  exports (`StubIdentityProvider`, `StubVerificationClient`) are gone from
  this package; equivalent in-memory backends now live in
  **`@openagent/sdk-testing`** behind an explicit import that cannot sneak
  into a dependency graph unnoticed, plus a `createTestingConfig()` helper
  that wires all three for tests.
- Added a root GitHub-installable package wrapper so
  `npm install github:OpenAgentID/openagent-sdk` resolves to the TypeScript
  facade before npm registry publication is available.
- `extractBearerToken()` now accepts the canonical `Authorization: OpenAgent <token>` form in addition to Bearer, `X-OpenAgent-Token`, and `oa_token`, so SDK behavior matches the HTTP auth protocol docs.
- Documented the OAS SDK dependency as the required Sigil-backed lineage verifier contract for privileged OpenAgent sessions, ACTs, credentials, and scopes. Local identity remains portable, but privileged authority must fail closed when the OAS verifier cannot prove finalized Sigil lineage.

### Added

- Added `LineageAuthorityContext` to `AuthContext` so production verifiers can attach the OAS/Sigil authority result. `VerifyRequestOptions` can now require privileged authority, and the stub verifier fails closed when that option is requested.
- Added a verification test proving the offline stub rejects privileged authority requests instead of pretending local identity is enough.
- Added `PrivilegedAuthorityVerificationClient` and `PrivilegedAuthorityVerifier` so runtime request verification can wrap an AEGIS verifier, call an OAS-backed authority verifier when `requirePrivilegedAuthority` is set, attach normalized authority context, and fail closed on malformed subject, root, path-kind, or scope results.

## [0.1.0] - 2026-04-11

### Added

- Initial public API surface:
  - `OpenAgent` singleton facade with `configure()`, `createAgent()`,
    `loadAgent()`, `authenticate()`, and `runtime()` entry points.
  - `OpenAgentRuntime` class for multi-runtime scenarios.
  - `OpenAgentInstance` with `did`, `document`, `skillsPolicy()`,
    `withSkillsPolicy()`, `credentialsFor()`, and `identity()` methods.
- Identity module (`src/identity.ts`):
  - `IdentityProvider` interface wrapping `@oas/sdk`.
  - `StubIdentityProvider` for offline development and tests.
  - Runtime-validated `IdentityDocument` and `SignedAssertion` types.
- Credentials module (`src/credentials.ts`):
  - `ArsenalClient` interface wrapping `@arsenal/sdk`.
  - `CredentialHandle` with a drop-in `fetch` that injects scoped credentials
    via the Arsenal proxy. Lazy refresh at `expiresAt - 30s`.
  - First-class streaming (SSE, chunked responses) via native `Response`.
- Verification module (`src/verification.ts`):
  - `VerificationClient` interface wrapping `@aegis/sdk`.
  - `StubVerificationClient` for offline development and tests.
  - `extractBearerToken()`, `assertScopes()`, `assertAncestor()` helpers.
- Skills module (`src/skills.ts`):
  - `SkillsPolicy` interface with immutable `grant`/`revoke`.
  - `InMemorySkillsPolicy` with exact and wildcard-suffix matching.
  - `denyAllSkills` / `allowAllSkills` presets.
- Error hierarchy (`src/errors.ts`):
  - Root `OpenAgentError` with stable `ErrorCode` enum.
  - Specialized `ConfigError`, `InputValidationError`, `IdentityError`,
    `CredentialError`, `VerificationError`, `SkillDeniedError`.
  - `wrapError()` and `getErrorMessage()` helpers.
- Configuration (`src/config.ts`):
  - Zod schemas for DIDs, scopes, provider ids, and `CreateAgentInput`.
  - `resolveConfig()` with sensible defaults.
- Full unit test suite with Vitest (errors, config, identity, credentials,
  verification, skills, agent — 60+ tests).
- `tsup` ESM + CJS dual build with per-module entry points.
- TypeScript strict mode with `noUncheckedIndexedAccess` enabled.
- Runtime support: Node 20+, Bun, Deno, browsers, Cloudflare Workers.
- `README.md` with three-line happy path and escape-hatch documentation.
- `INTEGRATION_NOTES.md` tracking expected API shapes for `@oas/sdk`,
  `@arsenal/sdk`, and `@aegis/sdk` until those SDKs are finalized.
