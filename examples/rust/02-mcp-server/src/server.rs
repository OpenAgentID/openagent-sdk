use axum::{
    body::Body,
    extract::State,
    http::Request,
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use openagent_sdk::{Context, OpenAgent, OpenAgentError};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

#[derive(Clone)]
struct AppState {
    openagent: Arc<OpenAgent>,
}

#[derive(Deserialize)]
struct JsonRpcRequest {
    #[serde(default)]
    jsonrpc: String,
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Serialize)]
struct JsonRpcResponse {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Serialize)]
struct JsonRpcError {
    code: i32,
    message: String,
    data: Option<Value>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("info,openagent_sdk=debug")
        .init();

    let oa = OpenAgent::builder()
        .broker_url(std::env::var("OPENAGENT_BROKER_URL").unwrap_or_else(|_| "fake://in-memory".into()))
        .aegis_url(std::env::var("OPENAGENT_AEGIS_URL").unwrap_or_else(|_| "fake://in-memory".into()))
        .namespace(std::env::var("OPENAGENT_NAMESPACE").unwrap_or_else(|_| "example".into()))
        .build()
        .await?;

    let state = AppState { openagent: Arc::new(oa) };

    let app = Router::new().route("/mcp", post(mcp_handler)).with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    tracing::info!("MCP server with OpenAgent auth listening on :3000/mcp");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn mcp_handler(
    State(state): State<AppState>,
    req: Request<Body>,
) -> Result<impl IntoResponse, OpenAgentError> {
    let ctx = state.openagent.authenticate(&req).await?;

    let body = axum::body::to_bytes(req.into_body(), 1024 * 1024)
        .await
        .map_err(|e| OpenAgentError::invalid_request(e.to_string()))?;

    let rpc: JsonRpcRequest = serde_json::from_slice(&body)
        .map_err(|e| OpenAgentError::invalid_request(format!("parse error: {e}")))?;

    if rpc.jsonrpc != "2.0" {
        return Err(OpenAgentError::invalid_request("expected jsonrpc=2.0"));
    }

    let result = match rpc.method.as_str() {
        "initialize" => json!({
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "acme-tools", "version": "0.1.0" }
        }),
        "tools/list" => json!({
            "tools": [
                {
                    "name": "summarize_url",
                    "description": "Summarize a URL",
                    "inputSchema": { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"] }
                }
            ]
        }),
        "tools/call" => handle_tool_call(&state, &ctx, rpc.params).await?,
        other => return Err(OpenAgentError::invalid_request(format!("unknown method: {other}"))),
    };

    Ok(Json(JsonRpcResponse {
        jsonrpc: "2.0",
        id: rpc.id,
        result: Some(result),
        error: None,
    }))
}

async fn handle_tool_call(
    state: &AppState,
    ctx: &Context,
    params: Value,
) -> Result<Value, OpenAgentError> {
    let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let args = params.get("arguments").cloned().unwrap_or(json!({}));

    match name {
        "summarize_url" => {
            ctx.require_scope("tavily:search:invoke")?;

            let url = args
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or_else(|| OpenAgentError::invalid_request("missing argument: url"))?;

            let agent = state.openagent.load_agent(&ctx.did).await?;
            let tavily = agent.credentials_for("tavily").await?;
            let resp = tavily
                .get(&format!(
                    "https://api.tavily.com/search?q={}",
                    urlencoding::encode(url)
                ))
                .send()
                .await?;

            let text = resp
                .text()
                .await
                .map_err(|e| OpenAgentError::upstream(500, e.to_string()))?;

            Ok(json!({ "content": [{ "type": "text", "text": text }] }))
        }
        other => Err(OpenAgentError::invalid_request(format!("unknown tool: {other}"))),
    }
}

mod urlencoding {
    pub fn encode(s: &str) -> String {
        let mut out = String::with_capacity(s.len() * 3);
        for b in s.bytes() {
            match b {
                b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    out.push(b as char)
                }
                _ => out.push_str(&format!("%{:02X}", b)),
            }
        }
        out
    }
}
