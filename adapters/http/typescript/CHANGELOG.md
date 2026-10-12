# 0.2.0 — 2026-10-12

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

# Changelog — @openagent/http

## Unreleased

- **Breaking:** package renamed from `@openagent/http` to `@openagentid/http`. The `@openagent` npm scope is squatted by a third party; the project now publishes under the `@openagentid` scope, matching the GitHub org OpenAgentID. Consumers must update dependency names and imports. Effective with the first npm publish under the new scope.

## [0.1.1] - 2026-07-31

### Fixed

- Fixed license copyright holder (L1fe Labs, Inc.) and added copyright footers to all READMEs. No functional changes.

## 0.1.0 (2026-04-11)

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
