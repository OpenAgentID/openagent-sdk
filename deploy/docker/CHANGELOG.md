# Changelog — openagent-docker

## 0.2.0 (2026-10-12)

- Replace placeholder authentication with the shared SDK ACT receiver and explicit broker, audience, tenant, scope and revocation policy.
- Verify actual signed capabilities and preserve request bodies; remove fake discovery, stub tokens and unimplemented OAuth/challenge routes.
- Add a real local broker/client example and package-level signature, refusal and runtime checks.

## 0.1.0 (2026-04-11)

- Initial Docker deployment template
- Standalone Node.js HTTP server (zero framework dependencies)
- Multi-stage Docker build with non-root user
- Health check endpoint with Docker HEALTHCHECK
- docker-compose.yml with optional PostgreSQL
- All OpenAgent auth endpoints (discovery, auth, challenge, OIDC bridge)
