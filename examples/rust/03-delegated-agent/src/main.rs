use openagent_sdk::{CreateAgentOptions, DelegateOptions, OpenAgent, OpenAgentError};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let oa = OpenAgent::builder()
        .broker_url(std::env::var("OPENAGENT_BROKER_URL").unwrap_or_else(|_| "fake://in-memory".into()))
        .aegis_url(std::env::var("OPENAGENT_AEGIS_URL").unwrap_or_else(|_| "fake://in-memory".into()))
        .namespace(std::env::var("OPENAGENT_NAMESPACE").unwrap_or_else(|_| "example".into()))
        .build()
        .await?;

    let parent_did = std::env::var("OPENAGENT_PARENT_DID")
        .unwrap_or_else(|_| "did:oas:example:hmr:local-dev".to_string());

    // === Parent with broad scopes ===
    let parent = oa
        .create_agent(
            CreateAgentOptions::new(&parent_did, "RootBot")
                .scopes(["github:*:*", "openai:chat:invoke", "tavily:search:invoke"]),
        )
        .await?;

    println!("parent did={}", parent.did());
    println!("parent scopes={:?}\n", parent.scopes());

    // === Child delegation — strict subset ===
    let child = parent
        .delegate(
            DelegateOptions::new("Worker")
                .scopes(["github:pulls:read", "openai:chat:invoke"])
                .expires_in_minutes(30),
        )
        .await?;

    println!("child did={}", child.did());
    println!("child scopes={:?}", child.scopes());
    println!("child lineage={:?}\n", child.lineage());

    // === Grandchild — narrower still ===
    let grandchild = child
        .delegate(
            DelegateOptions::new("Shard1")
                .scopes(["github:pulls:read"])
                .expires_in_minutes(10),
        )
        .await?;

    println!("grandchild did={}", grandchild.did());
    println!("grandchild scopes={:?}", grandchild.scopes());
    println!("grandchild lineage={:?}\n", grandchild.lineage());

    // === Amplification attempt — must fail ===
    println!("attempting amplification: grandchild trying to add github:pulls:write...");
    let result = grandchild
        .delegate(
            DelegateOptions::new("BadShard").scopes(["github:pulls:write"]),
        )
        .await;

    match result {
        Ok(_) => {
            println!("ERROR: amplification was NOT blocked — this is a bug!");
            std::process::exit(1);
        }
        Err(OpenAgentError::ScopeAmplification { added }) => {
            println!("denied: ScopeAmplification {{ added: {:?} }}", added);
        }
        Err(other) => {
            println!("denied with unexpected error: {other}");
            std::process::exit(1);
        }
    }

    println!("\n=== handing the child ACT to a worker ===");
    println!("export AGENT_DID='{}'", child.did());
    println!("export AGENT_ACT='{}'", child.act_compact_string());

    Ok(())
}
