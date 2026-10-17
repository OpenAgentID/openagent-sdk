# Changelog

All notable changes to `@openagentid/http` are documented in this file. The format follows
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

- Bind every proof and session to an authoritative DID authentication key; add
  the SDK IdentityVerifier bridge and live revocation/rotation checks.
- Require atomic SessionStore.take to prevent simultaneous challenge replay.
- Provide real Node Ed25519 and secp256k1 verification, validate service origins
  and returned identities, and refuse credential-bearing redirects.
- Preserve Express JSON/query data and expose the verified request principal.
- Remove the unpublished auth-protocol peer; support SDK ^0.7.2 with a runnable
  local Express example and real cryptographic, replay and SDK integration tests.
- Breaking: explicit origin/key resolver, DID in proofs and atomic store take
  are now required. See README migration instructions.
- Require current identity authority for direct `authenticateRequest` calls as
  well as middleware; reject missing resolvers, rotation, revocation and outages.

## [0.1.1] - 2026-08-01

### Fixed

- Fixed license copyright holder (L1fe Labs, Inc.) and added copyright footers to all READMEs. No functional changes.

## [0.1.0] - 2026-08-01

- Initial release.
- `HttpTransport` implementing OAAP 4-step handshake over native `fetch`.
- `createOpenAgentHandler` for fetch-based frameworks (Hono, Bun, Deno, Workers).
- `createOpenAgentMiddleware` for Express-compatible frameworks.
- `HttpAuthClient` performing full handshake with pluggable signing function.
- `AuthenticatedSession` with `fetch`/`get`/`post`/`put`/`delete` wrappers.
- `fetchDiscovery` for `GET /.well-known/openagent` resolution.
- `InMemorySessionStore` for development/testing.
- Zod schemas for all wire types.
- Header constants and `OAS` Authorization scheme parsing.

### Changed

- **Breaking:** the package is `@openagentid/http`; the source previously used the `@openagent/http` name, which this project never published because a third party holds the `@openagent` npm scope. Dependency names and imports use `@openagentid/*`.
