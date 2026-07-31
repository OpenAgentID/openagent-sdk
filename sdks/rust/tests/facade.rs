//! Integration tests exercising the OpenAgent SDK facade.
//!
//! These hit the real OAS / Arsenal / AEGIS Rust SDKs. They do not require
//! network access; everything runs against in-memory components.
//!
//! The whole file requires both optional subsystems: with default features
//! the facade's Arsenal and AEGIS layers are not compiled, so there is
//! nothing here to exercise.
#![cfg(all(feature = "arsenal", feature = "aegis"))]

use std::sync::Arc;

use arsenal_core::identity::TenantId;
use arsenal_sdk::{AgentIdentityLoader, ArsenalClient};
use oas_lineage::provider::InMemoryProvider;
use openagent_aegis_core::PluginRegistry;

use openagent_sdk::{
    AllowListPolicy, CreateAgentOptions, OpenAgent, OpenAgentBuilder, OpenAgentConfig,
    OpenAgentError, ParsedDid,
};

fn fresh_arsenal_client() -> ArsenalClient {
    // Arsenal 2.0: the loader mints key material, not identity - a DID must
    // already exist for the agent whose keys these are.
    let did = oas_did::OasDid::new("l1fe", oas_did::EntityKind::Agent, "facade-test")
        .unwrap_or_else(|e| unreachable!("did construction failed: {e}"));
    let identity = AgentIdentityLoader::generate(did, TenantId::generate(), "facade-test")
        .unwrap_or_else(|e| unreachable!("identity gen failed: {e}"));
    ArsenalClient::builder()
        .identity(identity)
        .build()
        .unwrap_or_else(|e| unreachable!("arsenal client build failed: {e:?}"))
}

#[tokio::test]
async fn create_agent_minimal_path_succeeds() {
    let agent = OpenAgent::create_agent(CreateAgentOptions {
        parent: None,
        name: "minimal",
        scopes: &["openai:chat:completions"],
        kind: None,
        derivation_path: None,
    })
    .await
    .unwrap_or_else(|e| unreachable!("create_agent failed: {e}"));

    assert!(agent.did().starts_with("did:oas:openagent:hmr:minimal"));
    assert_eq!(agent.default_scopes().len(), 1);
    assert!(agent.document().proof.is_some());
}

#[tokio::test]
async fn create_agent_with_parent_did_derives_lineage() {
    let parent: ParsedDid = "did:oas:l1fe:hmr:alice"
        .parse()
        .unwrap_or_else(|e: OpenAgentError| {
            unreachable!("parse failed: {e}");
        });
    let agent = OpenAgent::create_agent(CreateAgentOptions {
        parent: Some(parent),
        name: "child",
        scopes: &["github:repo:read"],
        kind: Some("agent"),
        derivation_path: None,
    })
    .await
    .unwrap_or_else(|e| unreachable!("create_agent failed: {e}"));

    assert_eq!(agent.did(), "did:oas:l1fe:agent:child");
    assert!(agent.document().lineage.is_some());
}

#[tokio::test]
async fn lineage_chain_verifies_when_parent_registered() {
    use openagent_sdk::identity::{derive_agent, mint_human_root, verify_lineage_chain};

    let root = mint_human_root("test", "alice").unwrap_or_else(|e| unreachable!("{e}"));
    let agent = derive_agent(
        &root.keypair,
        &root.document,
        "test",
        "agent",
        "bot",
        "agent/bot",
    )
    .unwrap_or_else(|e| unreachable!("{e}"));

    let mut provider = InMemoryProvider::new();
    provider.register(root.document.clone());
    assert!(verify_lineage_chain(&agent.document, &provider).is_ok());
}

#[tokio::test]
async fn builder_attaches_arsenal_client_for_credentials() {
    let arsenal = fresh_arsenal_client();
    let agent = OpenAgentBuilder::new()
        .config(OpenAgentConfig::default())
        .with_arsenal_client(arsenal)
        .build(CreateAgentOptions {
            parent: None,
            name: "credentialed",
            scopes: &["openai:chat:completions"],
            kind: None,
            derivation_path: None,
        })
        .await
        .unwrap_or_else(|e| unreachable!("build failed: {e}"));

    // credentials_for() now succeeds because the broker is wired in (no
    // network is required to *open* the session — only to *use* it).
    let creds = agent
        .credentials_for("openai")
        .await
        .unwrap_or_else(|e| unreachable!("credentials_for failed: {e}"));
    assert!(!creds.default_scopes().is_empty());
}

#[tokio::test]
async fn builder_attaches_aegis_verifier() {
    let registry = Arc::new(PluginRegistry::new());
    let agent = OpenAgentBuilder::new()
        .with_aegis_registry(registry)
        .build(CreateAgentOptions {
            parent: None,
            name: "verified",
            scopes: &[],
            kind: None,
            derivation_path: None,
        })
        .await
        .unwrap_or_else(|e| unreachable!("build failed: {e}"));
    assert!(agent.verifier().is_some());
}

#[tokio::test]
async fn skills_policy_blocks_unknown_skills() {
    let agent = OpenAgent::create_agent(CreateAgentOptions {
        parent: None,
        name: "skill-bot",
        scopes: &[],
        kind: None,
        derivation_path: None,
    })
    .await
    .unwrap_or_else(|e| unreachable!("{e}"));
    let agent = agent.with_skills_policy(AllowListPolicy::with_skills(["frontend-design"]));

    assert!(agent.check_skill("frontend-design").is_ok());
    let denied = agent.check_skill("rocket-science");
    assert!(matches!(denied, Err(OpenAgentError::SkillDenied { .. })));
}

#[tokio::test]
async fn empty_name_is_rejected_by_create_agent() {
    let err = OpenAgent::create_agent(CreateAgentOptions {
        parent: None,
        name: "",
        scopes: &[],
        kind: None,
        derivation_path: None,
    })
    .await;
    assert!(matches!(err, Err(OpenAgentError::Config(_))));
}

#[tokio::test]
async fn empty_name_is_rejected_by_builder() {
    let err = OpenAgentBuilder::new()
        .build(CreateAgentOptions {
            parent: None,
            name: "",
            scopes: &[],
            kind: None,
            derivation_path: None,
        })
        .await;
    assert!(matches!(err, Err(OpenAgentError::Config(_))));
}
