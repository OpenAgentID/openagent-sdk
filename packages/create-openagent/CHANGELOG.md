# Changelog — create-openagent

## [0.1.1] - 2026-07-31

### Fixed

- Fixed license copyright holder (L1fe Labs, Inc.) and added copyright footers to all READMEs. No functional changes.

## 0.1.0 (2026-04-11)

- Initial release of `create-openagent` CLI scaffolding tool
- 4 project templates: agent, mcp-server, web-dashboard, full-stack
- Interactive prompts via @clack/prompts
- CLI flags for non-interactive mode (--template, --deploy, --adapter, --bridge)
- Auth adapter selection: HTTP, WebSocket, gRPC
- Enterprise bridge options: OIDC, SCIM
- Deploy target selection: Cloudflare, Vercel, AWS, Docker, Local
- Optional Bioagentic entity classification integration
- Optional Fabrics routing integration
- Shared template files: tsconfig, .gitignore, .env.example
