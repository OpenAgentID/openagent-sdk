# Changelog — @openagent/http

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
