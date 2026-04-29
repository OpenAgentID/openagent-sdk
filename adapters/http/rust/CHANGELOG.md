# Changelog — openagent-http

## 0.1.0 (2026-04-11)

- Initial release.
- HTTP transport implementing `AuthTransport` trait from `openagent-auth-protocol`.
- Axum integration: `OpenAgentLayer`, `OpenAgentExtractor`, `oaap_routes()`.
- Framework-agnostic server handlers for PRESENT, PROVE, and discovery endpoints.
- HTTP client (`HttpAuthClient`) performing full 4-step handshake.
- `AuthenticatedSession` with auto-header attachment for GET/POST/PUT/DELETE.
- Well-known discovery (`GET /.well-known/openagent`).
- Header constants and `OAS` Authorization scheme parsing.
