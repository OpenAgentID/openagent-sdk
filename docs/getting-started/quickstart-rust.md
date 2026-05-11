# Quickstart — Rust

The Rust SDK is the reference implementation. Everything the TypeScript SDK does, the Rust SDK does natively — no WASM boundary — and slightly faster. Both SDKs share the same public API shape so you can port code between them without surprises.

## The three lines

```rust
use openagent_sdk::{authenticate_with_verifier, CreateAgentOptions, OpenAgent, Verifier};

let agent = OpenAgent::create_agent(CreateAgentOptions::new("did:oas:acme:hmr:alice", "research-bot").scopes(["openai:chat:invoke"])).await?;
let ctx   = authenticate_with_verifier(&Verifier::default(), agent.did()).await?;
let creds = agent.credentials_for("openai").await?;
```

Same shape as the TypeScript quickstart: `create_agent` mints a new DID under a parent and records requested scopes, `authenticate_with_verifier` turns a DID into a verified context through the verifier contract, and `credentials_for` returns a proxy that attaches credentials without ever exposing them to your code.

## A complete Axum server

Here's a real Axum server that gates a `/chat` endpoint:

```rust
use axum::{extract::State, http::Request, response::IntoResponse, routing::post, Router};
use axum::body::Body;
use openagent_sdk::{OpenAgent, Agent, Context, OpenAgentError};
use serde_json::Value;
use std::sync::Arc;

#[derive(Clone)]
struct AppState {
    openagent: Arc<OpenAgent>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let state = AppState {
        openagent: Arc::new(OpenAgent::from_env().await?),
    };

    let app = Router::new()
        .route("/chat", post(chat_handler))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn chat_handler(
    State(state): State<AppState>,
    req: Request<Body>,
) -> Result<impl IntoResponse, OpenAgentError> {
    let ctx: Context = state.openagent.authenticate(&req).await?;
    ctx.require_scope("openai:chat:invoke")?;

    let agent: Agent = state.openagent.load_agent(&ctx.did).await?;
    let openai = agent.credentials_for("openai").await?;

    let body = axum::body::to_bytes(req.into_body(), 1024 * 1024).await
        .map_err(|e| OpenAgentError::invalid_request(e.to_string()))?;

    let upstream = openai
        .post("https://api.openai.com/v1/chat/completions")
        .header("content-type", "application/json")
        .body(body.to_vec())
        .send()
        .await?;

    let status = upstream.status();
    let text: Value = upstream.json().await?;
    Ok((status, axum::Json(text)))
}
```

The `OpenAgent::from_env()` constructor reads `OPENAGENT_BROKER_URL`, `OPENAGENT_AEGIS_URL`, and `OPENAGENT_NAMESPACE` from the environment and connects to your Arsenal broker and AEGIS verifier. In a local dev setup those will default to `http://localhost:7878` and `http://localhost:7979`.

`ctx.require_scope("openai:chat:invoke")?` is a convenience that either succeeds or returns `OpenAgentError::ScopeDenied { required, held }`, which Axum will render as 403 by default thanks to the `IntoResponse` implementation on `OpenAgentError`.

## Minting an agent from a CLI

If you want to create an agent from outside a service (e.g. a provisioning script), it looks like this:

```rust
use openagent_sdk::{OpenAgent, CreateAgentOptions, Namespace};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let oa = OpenAgent::from_env().await?;

    let agent = oa
        .create_agent(
            CreateAgentOptions::new("did:oas:acme:hmr:alice", "research-bot")
                .namespace(Namespace::from("acme"))
                .scopes(["openai:chat:invoke", "anthropic:messages:invoke"])
                .expires_in_hours(24 * 7)
        )
        .await?;

    println!("minted {}", agent.did());
    println!("act   = {}", agent.act_compact_string());

    Ok(())
}
```

That ACT string is the Bearer token your new agent will use in `Authorization` headers. Store it somewhere the agent process can read it (not hard-coded in source). The DID is public and can go anywhere.

## Error handling

`OpenAgentError` is the single error type for all SDK calls. It implements `std::error::Error`, `thiserror::Error`, and `IntoResponse` (when the `axum` feature is enabled). Variants cover invalid input, broker unreachable, scope denied, lineage verification failed, signature invalid, policy denied, and a few more — see [error-codes.md](../reference/error-codes.md) for the full list.

Continue with [core concepts](core-concepts.md), or jump to [creating an agent](../guides/creating-an-agent.md).
