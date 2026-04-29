//! Integration tests for the skills policy.

mod common;

use std::sync::Arc;

use openagent_mcp::{
    Config, InMemorySkillsStore, InMemoryToolHandler, McpAuthError, OpenAgentMiddleware,
    SkillsPolicy, SkillsRule, ToolCall, ToolHandler, ToolResult, VerifiedIdentity, WithOpenAgent,
};

use common::{happy_path, meta_with_identity};

async fn build_skill_handler() -> InMemoryToolHandler {
    let inner = InMemoryToolHandler::new();
    inner
        .register("invoke_skill", Some("invoke a skill"), |_args| async move {
            Ok(ToolResult::text("invoked"))
        })
        .await;
    inner
}

#[tokio::test]
async fn skills_policy_allows_authorized_did() {
    let (_verifier, agent) = happy_path(
        "did:oas:test:alice",
        vec!["mcp:invoke_skill:invoke".to_owned()],
    );
    let store = InMemorySkillsStore::new([SkillsRule {
        skill_name: "cook_dinner".to_owned(),
        dids: Some(vec!["did:oas:test:alice".to_owned()]),
        reason: None,
    }]);
    let middleware = OpenAgentMiddleware::new(
        Config::new(agent).with_skills_policy(SkillsPolicy::new(Arc::new(store))),
    );
    let inner = build_skill_handler().await;
    let wrapped = inner.with_openagent(middleware);

    wrapped
        .call_tool(ToolCall {
            name: "invoke_skill".to_owned(),
            arguments: serde_json::json!({ "skill": "cook_dinner" }),
            meta: meta_with_identity("did:oas:test:alice", "valid"),
        })
        .await
        .expect("skill call should succeed");
}

#[tokio::test]
async fn skills_policy_denies_unauthorized_did() {
    let (_verifier, agent) = happy_path(
        "did:oas:test:alice",
        vec!["mcp:invoke_skill:invoke".to_owned()],
    );
    let store = InMemorySkillsStore::new([SkillsRule {
        skill_name: "cook_dinner".to_owned(),
        dids: Some(vec!["did:oas:test:bob".to_owned()]),
        reason: Some("only bob may cook".to_owned()),
    }]);
    let middleware = OpenAgentMiddleware::new(
        Config::new(agent).with_skills_policy(SkillsPolicy::new(Arc::new(store))),
    );
    let inner = build_skill_handler().await;
    let wrapped = inner.with_openagent(middleware);

    let err = wrapped
        .call_tool(ToolCall {
            name: "invoke_skill".to_owned(),
            arguments: serde_json::json!({ "skill": "cook_dinner" }),
            meta: meta_with_identity("did:oas:test:alice", "valid"),
        })
        .await
        .expect_err("skill call should be denied");
    assert!(matches!(err, McpAuthError::SkillsPolicyDenied { .. }));
}

#[tokio::test]
async fn skills_policy_allows_wildcard_rules() {
    let (_verifier, agent) = happy_path(
        "did:oas:test:alice",
        vec!["mcp:invoke_skill:invoke".to_owned()],
    );
    let store = InMemorySkillsStore::new([SkillsRule {
        skill_name: "order_pizza".to_owned(),
        dids: None,
        reason: None,
    }]);
    let middleware = OpenAgentMiddleware::new(
        Config::new(agent).with_skills_policy(SkillsPolicy::new(Arc::new(store))),
    );
    let inner = build_skill_handler().await;
    let wrapped = inner.with_openagent(middleware);

    wrapped
        .call_tool(ToolCall {
            name: "invoke_skill".to_owned(),
            arguments: serde_json::json!({ "skill": "order_pizza" }),
            meta: meta_with_identity("did:oas:test:alice", "valid"),
        })
        .await
        .expect("wildcard rule should allow any DID");
}

#[tokio::test]
async fn skills_policy_denies_skill_call_without_skill_name() {
    let (_verifier, agent) = happy_path(
        "did:oas:test:alice",
        vec!["mcp:invoke_skill:invoke".to_owned()],
    );
    let store = InMemorySkillsStore::new([]);
    let middleware = OpenAgentMiddleware::new(
        Config::new(agent).with_skills_policy(SkillsPolicy::new(Arc::new(store))),
    );
    let inner = build_skill_handler().await;
    let wrapped = inner.with_openagent(middleware);

    let err = wrapped
        .call_tool(ToolCall {
            name: "invoke_skill".to_owned(),
            arguments: serde_json::json!({}),
            meta: meta_with_identity("did:oas:test:alice", "valid"),
        })
        .await
        .expect_err("missing skill name should be denied");
    assert!(matches!(err, McpAuthError::SkillsPolicyDenied { .. }));
}

#[tokio::test]
async fn skills_policy_passes_through_non_skill_tools() {
    let (_verifier, agent) = happy_path(
        "did:oas:test:alice",
        vec!["mcp:search_web:invoke".to_owned()],
    );
    let store = InMemorySkillsStore::new([]);
    let middleware = OpenAgentMiddleware::new(
        Config::new(agent).with_skills_policy(SkillsPolicy::new(Arc::new(store))),
    );
    let inner = InMemoryToolHandler::new();
    inner
        .register("search_web", None, |_args| async move {
            Ok(ToolResult::text("ok"))
        })
        .await;
    let wrapped = inner.with_openagent(middleware);

    wrapped
        .call_tool(ToolCall {
            name: "search_web".to_owned(),
            arguments: serde_json::json!({}),
            meta: meta_with_identity("did:oas:test:alice", "valid"),
        })
        .await
        .expect("non-skill tool should not be checked against skills policy");
}

#[tokio::test]
async fn skills_policy_decision_helpers_work() {
    use openagent_mcp::SkillsPolicyDecision;
    let allow = SkillsPolicyDecision::allow();
    assert!(allow.allow);
    let deny = SkillsPolicyDecision::deny("nope");
    assert!(!deny.allow);
    assert_eq!(deny.reason.as_deref(), Some("nope"));

    let _identity = VerifiedIdentity {
        did: "did:oas:test:alice".to_owned(),
        scopes: vec![],
        audit_id: "audit-1".to_owned(),
        claims: serde_json::json!({}),
    };
}
