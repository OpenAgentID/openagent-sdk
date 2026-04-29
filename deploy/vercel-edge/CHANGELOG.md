# Changelog — openagent-vercel-edge

## 0.1.0 (2026-04-11)

- Initial Vercel Edge middleware deployment template
- Edge-level OpenAgent auth for protected /api/* routes
- Well-known endpoint rewrites to API routes
- OIDC bridge token exchange at /oauth/token
- Stub mode for local development (stub:did:oas:* tokens)
- Injects X-OpenAgent-DID/Root/Scopes headers for downstream routes
