# 02 — MCP Server with OpenAgent Auth (Rust)

An Axum-based MCP server exposing a `summarize_url` tool, gated by OpenAgent authentication. Same idea as the TypeScript example, idiomatic Rust.

## What it shows

- Axum middleware pattern for OpenAgent authentication.
- `OpenAgentError` rendering as proper HTTP responses via `IntoResponse`.
- Per-tool scope enforcement with `ctx.require_scope(...)`.
- Upstream calls via `credentials_for(...)` — no raw API key in the process.

## Run it

```bash
cargo run
```

Listens on `http://localhost:3000/mcp`. Send an MCP-formatted JSON-RPC request with an `Authorization: OpenAgent <act>` header.

A sibling binary mints an agent and sends a test request:

```bash
cargo run --bin test-client
```

## Flow

1. Request arrives at `/mcp`.
2. `authenticate_with_verifier` verifies the caller identity, lineage, and policies.
3. The handler dispatches by method (`initialize`, `tools/list`, `tools/call`).
4. `summarize_url` checks `tavily:search:invoke` scope before calling Tavily through the broker.
5. Every step writes to the audit log.

## Try this next

- Add a tool that calls multiple upstream APIs in parallel — notice each requires its own scope.
- Point the broker at a real Tavily credential and watch the request succeed end-to-end.
- Compare with the TypeScript MCP example — the architecture is identical.
