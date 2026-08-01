# 02 — MCP Server with OpenAgent Auth

An MCP server exposing a `summarize_url` tool, gated by OpenAgent authentication and scoped to the `tavily:search:invoke` scope. Demonstrates how to integrate OpenAgent into an HTTP-based MCP server.

## What it shows

- Authenticating inbound MCP RPC requests with `OpenAgent.authenticate`.
- Stashing the auth `Context` on the MCP transport so tool handlers can read it.
- Per-tool scope enforcement.
- Calling an upstream API (Tavily search) via `credentialsFor` — no raw key in the process.

## Run it

```bash
bun install
bun run start
```

The server listens on `http://localhost:3000`. Send an MCP-formatted JSON-RPC request with a valid OpenAgent token in the `Authorization` header.

A synthetic test client is included:

```bash
bun run test-client
```

This mints an agent, sends a `tools/call` request to summarize `https://example.com`, and prints the response.

## Security model

Every tool call:
1. Authenticates the caller via OpenAgent.
2. Checks that the caller holds `tavily:search:invoke`.
3. Fetches via the Arsenal broker (the Tavily API key never enters this process).
4. Writes an audit entry.

A caller who authenticates but lacks the scope gets a structured denial. The server never leaks the Tavily key even under full compromise.

## Try this next

- Add a second tool (e.g., `list_recent_files`) with different scope requirements and observe the per-tool gating.
- Point `OPENAGENT_BROKER_URL` at a real broker and register a real Tavily credential.
- Move on to [03-claude-agent-plugin](../03-claude-agent-plugin) to see the same auth layer integrated into a Claude Agent SDK run.

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](../../../LICENSE-APACHE) or [MIT license](../../../LICENSE-MIT), at your option.
