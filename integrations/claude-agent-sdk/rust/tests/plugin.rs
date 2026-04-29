//! Integration tests for the OpenAgent x Claude Agent Rust plugin.
#![allow(clippy::expect_used)]
#![allow(clippy::unwrap_used)]
#![allow(clippy::panic)]

use std::sync::Arc;

use openagent_claude_agent::audit::{verify_chain, AuditKind, InMemoryAuditSink, Outcome};
use openagent_claude_agent::error::Error;
use openagent_claude_agent::identity::{Identity, OpenAgentIdentity};
use openagent_claude_agent::plugin::{DenyMode, OpenAgentPlugin, PluginConfig};
use openagent_claude_agent::policy::{DenyUnlessScopedSkillsPolicy, StaticCapabilityChecker};
use serde_json::json;

fn make_identity() -> Arc<dyn OpenAgentIdentity> {
    Arc::new(Identity::new(
        "did:oas:test:agent:refactor-bot",
        "agent",
        [1u8; 32],
    ))
}

fn build_plugin(
    scopes: &[&str],
    sink: Arc<InMemoryAuditSink>,
    deny_mode: DenyMode,
) -> OpenAgentPlugin {
    OpenAgentPlugin::new(PluginConfig {
        identity: make_identity(),
        capabilities: Arc::new(StaticCapabilityChecker::new(
            scopes.iter().map(|s| s.to_string()),
        )),
        skills_policy: Arc::new(DenyUnlessScopedSkillsPolicy),
        sink,
        sign_messages: false,
        deny_mode,
    })
}

#[tokio::test]
async fn session_lifecycle_emits_open_and_close_records() {
    let sink = Arc::new(InMemoryAuditSink::new());
    let plugin = build_plugin(&[], sink.clone(), DenyMode::Throw);
    plugin
        .session_start("sess-1")
        .await
        .expect("session start should succeed");
    plugin
        .session_end()
        .await
        .expect("session end should succeed");
    let records = sink.snapshot();
    assert_eq!(records.len(), 2);
    assert_eq!(records[0].kind, AuditKind::SessionStart);
    assert_eq!(records[1].kind, AuditKind::SessionStop);
    assert_eq!(records[0].agent_did, "did:oas:test:agent:refactor-bot");
}

#[tokio::test]
async fn pre_tool_use_allows_when_scope_held() {
    let sink = Arc::new(InMemoryAuditSink::new());
    let plugin = build_plugin(&["tools:invoke:bash"], sink.clone(), DenyMode::Throw);
    plugin
        .session_start("sess")
        .await
        .expect("session start should succeed");
    plugin
        .pre_tool_use("bash", &json!({"cmd": "ls"}))
        .await
        .expect("pre_tool_use should allow");
    let records = sink.snapshot();
    let preflight = records
        .iter()
        .find(|r| r.kind == AuditKind::ToolPreflight)
        .expect("preflight record");
    assert_eq!(preflight.outcome, Outcome::Allow);
    assert_eq!(preflight.name.as_deref(), Some("bash"));
}

#[tokio::test]
async fn pre_tool_use_throws_when_scope_missing() {
    let sink = Arc::new(InMemoryAuditSink::new());
    let plugin = build_plugin(&[], sink.clone(), DenyMode::Throw);
    plugin
        .session_start("sess")
        .await
        .expect("session start should succeed");
    let err = plugin
        .pre_tool_use("bash", &json!({"cmd": "rm -rf /"}))
        .await
        .err()
        .expect("expected ToolDenied error");
    match err {
        Error::ToolDenied { tool, .. } => assert_eq!(tool, "bash"),
        other => panic!("wrong error variant: {other:?}"),
    }
    let records = sink.snapshot();
    let denied = records
        .iter()
        .find(|r| r.kind == AuditKind::ToolPreflight && r.outcome == Outcome::Deny);
    assert!(denied.is_some(), "expected a deny preflight record");
}

#[tokio::test]
async fn pre_tool_use_block_mode_returns_ok_with_audit() {
    let sink = Arc::new(InMemoryAuditSink::new());
    let plugin = build_plugin(&[], sink.clone(), DenyMode::Block);
    plugin
        .session_start("sess")
        .await
        .expect("session start should succeed");
    plugin
        .pre_tool_use("bash", &json!({}))
        .await
        .expect("block mode should not throw");
    let records = sink.snapshot();
    assert!(records.iter().any(|r| r.outcome == Outcome::Deny));
}

#[tokio::test]
async fn wildcard_scopes_match() {
    let sink = Arc::new(InMemoryAuditSink::new());
    let plugin = build_plugin(&["tools:invoke:*"], sink.clone(), DenyMode::Throw);
    plugin
        .session_start("sess")
        .await
        .expect("session start should succeed");
    plugin
        .pre_tool_use("bash", &json!({}))
        .await
        .expect("wildcard should allow bash");
    plugin
        .pre_tool_use("read_file", &json!({}))
        .await
        .expect("wildcard should allow read_file");
}

#[tokio::test]
async fn skill_invoke_default_deny() {
    let sink = Arc::new(InMemoryAuditSink::new());
    let plugin = build_plugin(&[], sink.clone(), DenyMode::Throw);
    plugin
        .session_start("sess")
        .await
        .expect("session start should succeed");
    let err = plugin
        .on_skill_invoke("web.search", None)
        .await
        .err()
        .expect("expected SkillDenied");
    match err {
        Error::SkillDenied { skill, .. } => assert_eq!(skill, "web.search"),
        other => panic!("wrong error variant: {other:?}"),
    }
}

#[tokio::test]
async fn skill_invoke_with_scope_allows() {
    let sink = Arc::new(InMemoryAuditSink::new());
    let plugin = build_plugin(
        &["skills:invoke:web.search"],
        sink.clone(),
        DenyMode::Throw,
    );
    plugin
        .session_start("sess")
        .await
        .expect("session start should succeed");
    plugin
        .on_skill_invoke("web.search", Some(&json!({"q": "rust"})))
        .await
        .expect("scoped skill should be allowed");
    let records = sink.snapshot();
    let skill_rec = records
        .iter()
        .find(|r| r.kind == AuditKind::SkillPreflight);
    assert!(skill_rec.is_some());
}

#[tokio::test]
async fn audit_chain_verifies() {
    let sink = Arc::new(InMemoryAuditSink::new());
    let plugin = build_plugin(
        &["tools:invoke:bash", "skills:invoke:web.search"],
        sink.clone(),
        DenyMode::Throw,
    );
    plugin
        .session_start("sess")
        .await
        .expect("session start should succeed");
    plugin
        .pre_tool_use("bash", &json!({"cmd": "echo hi"}))
        .await
        .expect("preflight allow");
    plugin
        .post_tool_use("bash", &json!("hi"), true, None)
        .await
        .expect("post-tool record");
    plugin
        .on_skill_invoke("web.search", None)
        .await
        .expect("skill allow");
    plugin
        .session_end()
        .await
        .expect("session end");
    let records = sink.snapshot();
    verify_chain(&records).expect("chain should verify");
    assert!(records.len() >= 5);
}

#[tokio::test]
async fn audit_chain_detects_tampering() {
    let sink = Arc::new(InMemoryAuditSink::new());
    let plugin = build_plugin(&["tools:invoke:bash"], sink.clone(), DenyMode::Throw);
    plugin
        .session_start("sess")
        .await
        .expect("session start should succeed");
    plugin
        .pre_tool_use("bash", &json!({}))
        .await
        .expect("preflight allow");
    plugin
        .session_end()
        .await
        .expect("session end");
    let mut records = sink.snapshot();
    if let Some(r) = records.get_mut(1) {
        r.outcome = Outcome::Deny;
    }
    let result = verify_chain(&records);
    assert!(result.is_err());
}

#[tokio::test]
async fn signed_message_emits_signature() {
    let sink = Arc::new(InMemoryAuditSink::new());
    let plugin = OpenAgentPlugin::new(PluginConfig {
        identity: make_identity(),
        capabilities: Arc::new(StaticCapabilityChecker::new(Vec::<String>::new())),
        skills_policy: Arc::new(DenyUnlessScopedSkillsPolicy),
        sink: sink.clone(),
        sign_messages: true,
        deny_mode: DenyMode::Throw,
    });
    plugin
        .session_start("sess")
        .await
        .expect("session start should succeed");
    let sig = plugin
        .on_message(b"hello world", true)
        .await
        .expect("signing should succeed");
    let signature = sig.expect("signed message should have signature");
    assert_eq!(signature.len(), 128); // 64 bytes hex
}

#[tokio::test]
async fn inbound_messages_not_signed() {
    let sink = Arc::new(InMemoryAuditSink::new());
    let plugin = OpenAgentPlugin::new(PluginConfig {
        identity: make_identity(),
        capabilities: Arc::new(StaticCapabilityChecker::new(Vec::<String>::new())),
        skills_policy: Arc::new(DenyUnlessScopedSkillsPolicy),
        sink: sink.clone(),
        sign_messages: true,
        deny_mode: DenyMode::Throw,
    });
    plugin
        .session_start("sess")
        .await
        .expect("session start should succeed");
    let sig = plugin
        .on_message(b"incoming", false)
        .await
        .expect("inbound message");
    assert!(sig.is_none());
}

#[tokio::test]
async fn no_active_session_errors() {
    let sink = Arc::new(InMemoryAuditSink::new());
    let plugin = build_plugin(&["tools:invoke:bash"], sink, DenyMode::Throw);
    let err = plugin
        .pre_tool_use("bash", &json!({}))
        .await
        .err()
        .expect("expected NoActiveSession");
    matches!(err, Error::NoActiveSession);
}
