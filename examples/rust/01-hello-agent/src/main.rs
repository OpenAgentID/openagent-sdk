use openagent_sdk::{CreateAgentOptions, OpenAgent};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Build the OpenAgent facade. `from_env()` reads OPENAGENT_BROKER_URL,
    // OPENAGENT_AEGIS_URL, and OPENAGENT_NAMESPACE. Defaults are fine for dev.
    let oa = OpenAgent::builder()
        .broker_url(std::env::var("OPENAGENT_BROKER_URL").unwrap_or_else(|_| "fake://in-memory".into()))
        .aegis_url(std::env::var("OPENAGENT_AEGIS_URL").unwrap_or_else(|_| "fake://in-memory".into()))
        .namespace(std::env::var("OPENAGENT_NAMESPACE").unwrap_or_else(|_| "example".into()))
        .build()
        .await?;

    let parent = std::env::var("OPENAGENT_PARENT_DID")
        .unwrap_or_else(|_| "did:oas:example:hmr:local-dev".to_string());

    // === 1. Create an agent ===
    let agent = oa
        .create_agent(
            CreateAgentOptions::new(&parent, "hello-world")
                .scopes(["openai:chat:invoke"]),
        )
        .await?;

    println!("minted {}", agent.did());
    println!("scopes: {:?}", agent.scopes());
    println!("expires: {}", agent.expires_at());

    // === 2. Authenticate a synthetic request carrying the agent's ACT ===
    let req = http::Request::builder()
        .method("POST")
        .uri("http://localhost:3000/hello")
        .header(
            "authorization",
            format!("OpenAgent {}", agent.act_compact_string()),
        )
        .header("content-type", "application/json")
        .body(b"{\"message\":\"hello\"}".to_vec())?;

    let ctx = oa.authenticate(&req).await?;
    println!("auth context did: {}", ctx.did);
    println!("auth context lineage: {:?}", ctx.lineage);

    // === 3. Get a credential proxy ===
    let _openai = agent.credentials_for("openai").await?;
    println!("credential proxy ready for service=openai");

    // In a real program we'd call:
    //   let res = _openai.post("https://api.openai.com/v1/chat/completions")
    //                    .json(&chat_body)
    //                    .send()
    //                    .await?;
    // The raw credential never enters this process.

    println!("\ndemo complete. try the other examples in ../");

    Ok(())
}
