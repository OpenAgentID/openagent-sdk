# Changelog — openagent-cloudflare-worker

## 0.2.1 (2026-10-15)

- Accept `@openagentid/sdk` 0.8.0 beside 0.7.x (`^0.7.2 || ^0.8.0`). No receiver change; the deployment
  examples' typecheck and tests are qualified against a packed SDK 0.8.0.

## 0.2.0 (2026-10-12)

- Replace placeholder authentication with the shared SDK ACT receiver and explicit broker, audience, tenant, scope and revocation policy.
- Verify actual signed capabilities and preserve request bodies; remove fake discovery, stub tokens and unimplemented OAuth/challenge routes.
- Add a real local broker/client example and package-level signature, refusal and runtime checks.
- Instantiate the released WASM module in Workers and exercise the built bundle in workerd.

## 0.1.0 (2026-04-11)

- Initial Cloudflare Worker deployment template
- Well-known OpenAgent discovery endpoints (agent.json, auth, challenge, challenge/verify)
- OIDC bridge token exchange at /oauth/token
- Authenticated upstream proxy with X-OpenAgent-* headers
- KV namespace for session/challenge state
- Optional D1 binding for agent DID storage
- Health check at /health
