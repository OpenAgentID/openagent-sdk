# `openagent-mcp`

OpenAgent middleware for the [Model Context Protocol](https://modelcontextprotocol.io), in Rust.

Add OAS identity verification, Arsenal capability tokens, and AEGIS authorization to any MCP server in three lines.

## Install

```toml
[dependencies]
openagent-mcp = "0.1"
# Optional: pull in the upstream rmcp adapter
# openagent-mcp = { version = "0.1", features = ["rmcp"] }
```

## Server: add auth to MCP in 3 lines

```rust
use openagent_mcp::{Config, OpenAgentMiddleware, ToolHandler, WithOpenAgent};
use std::sync::Arc;

# async fn example(my_handler: impl ToolHandler + 'static, agent: Arc<dyn openagent_mcp::Agent>) {
let middleware = OpenAgentMiddleware::new(Config::new(agent));
let authed = my_handler.with_openagent(middleware);
# }
```

That is it. Every tool call now:

1. Pulls the identity envelope from `call.meta.openagent.identity`.
2. Verifies it via the configured `IdentityVerifier` (OAS DID + Arsenal ACT + AEGIS policy).
3. Enforces the per-tool scopes returned by `require_scopes`.
4. Runs the optional `skills_policy` hook (consults SKILLS.md-style rules).
5. Runs the user's tool body.
6. Stamps `audit_id`, `verified_did`, and `scopes` into the response `meta.openagent`.

## Trait surface

The middleware is generic over a small `ToolHandler` trait so it can wrap:

- The upstream `rmcp::ServerHandler` (via the optional `rmcp` adapter behind the `rmcp` feature flag).
- Any custom MCP server runtime your application has built.
- The `InMemoryToolHandler` shipped here for tests.

```rust
use async_trait::async_trait;
use openagent_mcp::{McpAuthError, RegisteredTool, ToolCall, ToolHandler, ToolResult};

struct MyServer;

#[async_trait]
impl ToolHandler for MyServer {
    async fn list_tools(&self) -> Vec<RegisteredTool> {
        vec![RegisteredTool {
            name: "search_web".into(),
            description: Some("search the web".into()),
        }]
    }

    async fn call_tool(&self, call: ToolCall) -> Result<ToolResult, McpAuthError> {
        let q = call.arguments.get("q").and_then(|v| v.as_str()).unwrap_or("");
        Ok(ToolResult::text(format!("results for {q}")))
    }
}
```

## Hooks

`Config` accepts three optional hooks plus the skills policy:

```rust
use openagent_mcp::{Config, OpenAgentMiddleware};
use std::sync::Arc;

# fn example(agent: std::sync::Arc<dyn openagent_mcp::Agent>) {
let config = Config::new(agent)
    .with_pre_call(Arc::new(|ctx| {
        let tool = ctx.tool_name.to_owned();
        let did = ctx.identity.did.clone();
        Box::pin(async move {
            tracing::info!(tool = %tool, did = %did, "tool invoked");
        })
    }))
    .with_post_call(Arc::new(|ctx| {
        let duration = ctx.duration_ms;
        Box::pin(async move {
            tracing::info!(duration_ms = duration, "tool completed");
        })
    }));
let _middleware = OpenAgentMiddleware::new(config);
# }
```

## Skills policy

MCP tools and SKILLS.md entries describe the same thing — a capability an
agent can invoke. When an MCP server exposes a skill-like tool (default
matchers: `invoke_skill`, `run_skill`, `execute_skill`, `skill.invoke`,
`skill.run`), the middleware consults a `SkillsPolicy` before allowing
the call.

```rust
use openagent_mcp::{
    Config, InMemorySkillsStore, OpenAgentMiddleware, SkillsPolicy, SkillsRule,
};
use std::sync::Arc;

# fn example(agent: std::sync::Arc<dyn openagent_mcp::Agent>) {
let store = InMemorySkillsStore::new([
    SkillsRule {
        skill_name: "cook_dinner".into(),
        dids: Some(vec!["did:oas:org:kitchen:agent:alice".into()]),
        reason: None,
    },
    SkillsRule {
        skill_name: "order_pizza".into(),
        dids: None, // any verified caller
        reason: None,
    },
]);
let middleware = OpenAgentMiddleware::new(
    Config::new(agent).with_skills_policy(SkillsPolicy::new(Arc::new(store))),
);
# let _ = middleware;
# }
```

You can implement your own `SkillsStore` that reads from `SKILLS.md`
files, a remote service, or AEGIS policy bundles.

## Errors

Every middleware-rejected call surfaces an `McpAuthError`:

| Variant                 | Code     | When                                            |
| ----------------------- | -------- | ----------------------------------------------- |
| `MissingIdentity`       | `-32001` | `meta.openagent.identity` was absent            |
| `VerificationFailed`    | `-32001` | The verifier rejected the envelope              |
| `AuthorizationDenied`   | `-32002` | Caller does not hold the required scopes        |
| `SkillsPolicyDenied`    | `-32003` | The skills policy hook returned `allow: false`  |
| `ToolFailed`            | `-32603` | The tool body returned an error                 |

`McpAuthError::to_json_rpc()` produces a serializable error envelope
ready to send across an MCP transport.

## rmcp adapter (optional)

Enable the `rmcp` feature to compile in the `RmcpOpenAgent` newtype:

```toml
openagent-mcp = { version = "0.1", features = ["rmcp"] }
```

Then plug it into your `rmcp::ServerHandler::call_tool` implementation.
The adapter performs JSON conversion only — keeping the rmcp wire types
out of the core crate insulates this library from rmcp API churn.

## Versioning

- `openagent-mcp` is at `0.1.0`.
- The optional `rmcp` adapter is built against `rmcp@^0.2`.
- `tokio` is pinned to `^1.36`.

## Testing

```bash
cargo test
```

The test suite uses `tokio::test` and exercises the middleware against
the in-memory tool handler shipped under `src/handler.rs`.

## Documentation

- Spec: <https://openagent.id/docs/integrations/mcp>
- OpenAgent SDK: <https://openagent.id/docs/sdk>
- MCP: <https://modelcontextprotocol.io>

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](../../../LICENSE-APACHE) or [MIT license](../../../LICENSE-MIT), at your option.
