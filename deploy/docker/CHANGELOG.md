# Changelog — openagent-docker

## 0.1.0 (2026-04-11)

- Initial Docker deployment template
- Standalone Node.js HTTP server (zero framework dependencies)
- Multi-stage Docker build with non-root user
- Health check endpoint with Docker HEALTHCHECK
- docker-compose.yml with optional PostgreSQL
- All OpenAgent auth endpoints (discovery, auth, challenge, OIDC bridge)
