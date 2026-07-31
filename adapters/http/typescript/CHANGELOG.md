# Changelog — @openagent/http

## Unreleased

- **Breaking:** package renamed from `@openagent/http` to `@openagentid/http`. The `@openagent` npm scope is squatted by a third party; the project now publishes under the `@openagentid` scope, matching the GitHub org OpenAgentID. Consumers must update dependency names and imports. Effective with the first npm publish under the new scope.

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
