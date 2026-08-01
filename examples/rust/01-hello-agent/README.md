# 01 — Hello Agent (Rust)

The minimal OpenAgent demo in Rust. Creates an agent under a parent DID, authenticates a synthetic request, and prepares a credential proxy.

## What it shows

- `OpenAgent::from_env()` / `OpenAgent::builder()` setup.
- `OpenAgent::create_agent` with typed options.
- `authenticate_with_verifier` on a synthetic identity.
- `agent.credentials_for("openai")` returning a reqwest-shaped builder.

## Run it

```bash
cargo run
```

Expected output (values will differ):

```
minted did:oas:example:agent:8hT3k4Pq2mXrY9vWbCdEfGh1JkLmNo
scopes: ["openai:chat:invoke"]
expires: 2026-04-11T09:14:22Z
auth context did: did:oas:example:agent:8hT3...
auth context lineage: ["did:oas:example:hmr:local-dev", "did:oas:example:agent:..."]
credential proxy ready for service=openai
```

By default the example runs against `fake://in-memory`, so no broker is needed. Set `OPENAGENT_BROKER_URL` to point at a real broker.

## Try this next

- Inspect the agent's lineage via `agent.lineage()`.
- Compare this example with the TypeScript version — the API shape is deliberately identical.
- Move on to [02-mcp-server](../02-mcp-server) for a real HTTP server integration.

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](../../../LICENSE-APACHE) or [MIT license](../../../LICENSE-MIT), at your option.
