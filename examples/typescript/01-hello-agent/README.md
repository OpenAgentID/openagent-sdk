# 01 — Hello Agent

The minimal OpenAgent demo. Creates an agent under a parent DID, prints its identity, authenticates a fake request that carries the agent's ACT, and issues a credentialed API call through the broker proxy.

## What it shows

- `OpenAgent.createAgent` — the three-line agent minting path.
- Reading the resulting DID, scopes, and compact ACT string.
- `OpenAgent.authenticate` on a synthetic request to prove round-trip works.
- `agent.credentialsFor('openai')` returning a credential-injected fetch proxy.

## Run it

```bash
bun install
bun run start
```

Expected output (values will differ):

```
minted did:oas:example:agent:8hT3k4Pq2mXrY9vWbCdEfGh1JkLmNo
scopes: ["openai:chat:invoke"]
expires: 2026-04-11T09:14:22.431Z
auth context did: did:oas:example:agent:8hT3k4Pq2mXrY9vWbCdEfGh1JkLmNo
auth context lineage: ["did:oas:example:hmr:local-dev","did:oas:example:agent:8hT..."]
credential proxy ready for service=openai
```

The example runs against `fake://in-memory` by default, so no external broker is needed.

## Try this next

- Change `scopes` to include multiple services and observe them on the printed context.
- Set `OPENAGENT_BROKER_URL` to a real broker (see the [installation docs](../../../docs/getting-started/installation.md)).
- Move on to [02-mcp-server](../02-mcp-server) to see OpenAgent in a real HTTP server.

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](../../../LICENSE-APACHE) or [MIT license](../../../LICENSE-MIT), at your option.
