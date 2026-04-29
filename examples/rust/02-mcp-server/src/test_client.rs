use openagent_sdk::{CreateAgentOptions, OpenAgent};
use serde_json::json;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let oa = OpenAgent::builder()
        .broker_url(std::env::var("OPENAGENT_BROKER_URL").unwrap_or_else(|_| "fake://in-memory".into()))
        .aegis_url(std::env::var("OPENAGENT_AEGIS_URL").unwrap_or_else(|_| "fake://in-memory".into()))
        .namespace(std::env::var("OPENAGENT_NAMESPACE").unwrap_or_else(|_| "example".into()))
        .build()
        .await?;

    let parent = std::env::var("OPENAGENT_PARENT_DID")
        .unwrap_or_else(|_| "did:oas:example:hmr:local-dev".to_string());

    let agent = oa
        .create_agent(
            CreateAgentOptions::new(&parent, "mcp-test-client")
                .scopes(["tavily:search:invoke"]),
        )
        .await?;

    println!("client agent: {}", agent.did());

    let url = std::env::var("MCP_URL").unwrap_or_else(|_| "http://localhost:3000/mcp".into());
    let client = reqwest::Client::new();
    let auth = format!("OpenAgent {}", agent.act_compact_string());

    let call = |method: &str, params: serde_json::Value| {
        let client = client.clone();
        let url = url.clone();
        let auth = auth.clone();
        let method = method.to_string();
        async move {
            let body = json!({
                "jsonrpc": "2.0",
                "id": chrono_now_millis(),
                "method": method,
                "params": params
            });
            let res = client
                .post(&url)
                .header("authorization", &auth)
                .header("content-type", "application/json")
                .body(body.to_string())
                .send()
                .await?;
            let json: serde_json::Value = res.json().await?;
            Ok::<_, reqwest::Error>(json)
        }
    };

    println!("initialize: {}", call("initialize", json!({})).await?);
    println!("tools/list: {}", call("tools/list", json!({})).await?);
    println!(
        "tools/call: {}",
        call(
            "tools/call",
            json!({ "name": "summarize_url", "arguments": { "url": "https://example.com" } })
        )
        .await?
    );

    Ok(())
}

fn chrono_now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
