use openagent_sdk::{CreateAgentOptions, OpenAgent};
use serde_json::json;
use std::path::PathBuf;

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
            CreateAgentOptions::new(&parent, "governed-bot").scopes([
                "tavily:search:invoke",
                "github:repo:write",
                "postmark:email:send",
                "deploy:prod:invoke",
            ]),
        )
        .await?;

    let skills_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("SKILLS.md");
    let skills_agent = oa
        .load_agent_with_skills(agent.did(), &skills_path)
        .await?;

    let policy = skills_agent.skills_policy();

    println!("agent did={}", skills_agent.did());
    println!(
        "skills loaded: {}\n",
        policy
            .list()
            .iter()
            .map(|s| s.name.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    );

    let attempts = [
        ("web-search", json!({ "query": "autonomous agents" })),
        ("delete-file", json!({ "path": "README.md" })),
        ("send-email", json!({ "to": "alice@example.com" })),
        ("deploy-prod", json!({ "service": "api" })),
    ];

    for (name, args) in attempts.iter() {
        let decision = policy.can_invoke(name, args)?;
        print!(
            "[decision] skill={} allowed={}",
            decision.skill, decision.allowed
        );
        if let Some(reason) = &decision.reason {
            print!(" reason={reason}");
        }
        println!();
        if decision.requires_approval {
            if let Some(prompt) = &decision.approval_prompt {
                println!("           approvalPrompt: {prompt}");
            }
        }
    }

    println!("\nedit SKILLS.md to change policies and re-run — no code changes needed.");
    Ok(())
}
