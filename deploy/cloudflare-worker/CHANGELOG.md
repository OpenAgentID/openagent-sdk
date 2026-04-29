# Changelog — openagent-cloudflare-worker

## 0.1.0 (2026-04-11)

- Initial Cloudflare Worker deployment template
- Well-known OpenAgent discovery endpoints (agent.json, auth, challenge, challenge/verify)
- OIDC bridge token exchange at /oauth/token
- Authenticated upstream proxy with X-OpenAgent-* headers
- KV namespace for session/challenge state
- Optional D1 binding for agent DID storage
- Health check at /health
