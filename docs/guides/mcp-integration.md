# MCP Integration

The Model Context Protocol (MCP) standardizes how language models call external tools. If you're building an MCP server, you're exposing tools that agents can invoke — and you almost certainly want to know *which* agent is calling, whether it's allowed to call this particular tool, and whether its parent lineage is acceptable. OpenAgent slots in as the auth layer.

## The integration model

An MCP server speaks JSON-RPC over either stdio or HTTP/SSE. For stdio servers (the common case), there isn't really a request context — the client connects once and stays connected, and identity is established at connection time. For HTTP servers, identity is per-request and follows the usual HTTP auth patterns.

OpenAgent handles both. For HTTP MCP servers, use `OpenAgent.authenticate` on the JSON-RPC request. For stdio MCP servers, use `OpenAgent.authenticateHandshake` on the initialize message, which pulls the agent identity from the `clientInfo.openagent` field of the MCP handshake.

## TypeScript — HTTP server

```ts
import { createServer } from 'node:http';
import { OpenAgent } from '@openagentid/sdk';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server';
import { StreamableHTTPTransport } from '@modelcontextprotocol/sdk/server/streamableHttp';

const mcp = new McpServer({ name: 'acme-tools', version: '0.1.0' });

mcp.tool('summarize', 'Summarize a URL', { url: { type: 'string' } }, async (args, extra) => {
  const ctx = extra.authContext;
  if (!ctx.scopes.includes('tavily:search:invoke')) {
    throw new Error('scope denied: tavily:search:invoke');
  }
  const agent = await OpenAgent.loadAgent(ctx.did);
  const tavily = await agent.credentialsFor('tavily');
  const result = await tavily.get(`https://api.tavily.com/search?q=${encodeURIComponent(args.url)}`);
  return { content: [{ type: 'text', text: await result.text() }] };
});

const server = createServer(async (req, res) => {
  try {
    const ctx = await OpenAgent.authenticate(req);
    const transport = new StreamableHTTPTransport(res, { extra: { authContext: ctx } });
    await mcp.connect(transport);
  } catch (err) {
    res.writeHead(401).end((err as Error).message);
  }
});

server.listen(3000);
```

The pattern is: authenticate at the HTTP boundary, shove the `Context` into the MCP transport's `extra` bag, and read it from tool handlers. Every tool invocation now has verified identity, verified scopes, and verified lineage.

## TypeScript — stdio server

```ts
import { OpenAgent } from '@openagentid/sdk';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio';

const mcp = new McpServer({ name: 'acme-tools', version: '0.1.0' });

let authContext: Awaited<ReturnType<typeof OpenAgent.authenticateHandshake>> | null = null;

mcp.setInitializeHandler(async (request) => {
  authContext = await OpenAgent.authenticateHandshake(request);
  return { capabilities: { tools: {} }, serverInfo: { name: 'acme-tools', version: '0.1.0' } };
});

mcp.tool('draft-pr', 'Draft a pull request', { title: { type: 'string' } }, async (args) => {
  if (!authContext) throw new Error('not authenticated');
  authContext.requireScope('github:pulls:write');
  const agent = await OpenAgent.loadAgent(authContext.did);
  const github = await agent.credentialsFor('github');
  const res = await github.post('https://api.github.com/repos/acme/app/pulls', {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: args.title, head: 'dev', base: 'main' }),
  });
  return { content: [{ type: 'text', text: `opened PR: ${(await res.json()).html_url}` }] };
});

mcp.connect(new StdioServerTransport());
```

The stdio case is identical in spirit: authenticate once at handshake, keep the context around, check it on every tool invocation.

## Rust — HTTP server

The Rust MCP SDK has a similar shape. Assuming `mcp-rs` or equivalent:

```rust
use axum::{extract::State, routing::post, Router};
use openagent_sdk::{OpenAgent, Context};
use std::sync::Arc;

async fn mcp_handler(State(oa): State<Arc<OpenAgent>>, req: axum::http::Request<axum::body::Body>) -> impl axum::response::IntoResponse {
    let ctx: Context = match oa.authenticate(&req).await {
        Ok(c) => c,
        Err(e) => return e.into_response(),
    };
    // Pass ctx into the MCP transport extra bag, then dispatch RPC.
    mcp_rs::serve_request(req, &ctx).await.into_response()
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let oa = Arc::new(OpenAgent::from_env().await?);
    let app = Router::new().route("/mcp", post(mcp_handler)).with_state(oa);
    axum::serve(tokio::net::TcpListener::bind("0.0.0.0:3000").await?, app).await?;
    Ok(())
}
```

## Advertising identity to clients

OpenAgent publishes a small extension to the MCP handshake that lets clients advertise their identity without depending on HTTP headers. Clients put their ACT and DID into `clientInfo.openagent`:

```json
{
  "clientInfo": {
    "name": "claude-desktop",
    "version": "1.0.0",
    "openagent": {
      "did": "did:oas:acme:agent:ClaudeDesktop",
      "act": "eyJ..."
    }
  }
}
```

Servers that call `OpenAgent.authenticateHandshake` pick this up automatically. If the client sends both an HTTP header and a handshake field, the handshake field wins (it's scoped to the connection, the header is scoped to the request).

## Listing tools by scope

A nice pattern is to filter the advertised tool list by what the caller can actually invoke. If an agent doesn't hold `github:pulls:write`, don't advertise `draft-pr` in the `tools/list` response — that way the model doesn't even know to try. OpenAgent has a helper for this:

```ts
const tools = mcp.listTools().filter(t =>
  OpenAgent.scopeMatches(authContext!.scopes, t.metadata?.requiredScopes ?? [])
);
```

Tools whose required scopes aren't met simply vanish from the list. This is both a security measure and a UX improvement — models don't waste tokens attempting things they can't do.

## Audit trail

Every authenticated tool invocation automatically writes to the agent's audit log with the tool name, the arguments (redacted by your rules), the upstream URL, the status code, and the latency. You can query the log via `OpenAgent.audit(did).recent({ limit: 100 })` or stream it with `.subscribe()`.

Next: [Claude Agent SDK integration](claude-agent-sdk.md).
