//! Integration tests for the OpenAgent middleware against the
//! in-memory tool handler.

mod common;

use std::sync::{Arc, Mutex};

use openagent_mcp::{
    Config, InMemoryToolHandler, McpAuthError, McpErrorCode, OpenAgentMiddleware, ToolCall,
    ToolHandler, ToolResult, WithOpenAgent,
};

use common::{happy_path, meta_with_identity, FakeAgent, FakeRecord, FakeVerifier};

async fn build_handler() -> InMemoryToolHandler {
    let inner = InMemoryToolHandler::new();
    inner
        .register("search_web", Some("search the web"), |args| async move {
            let q = args
                .get("q")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_owned();
            Ok(ToolResult::text(format!("results for {q}")))
        })
        .await;
    inner
}

#[tokio::test]
async fn happy_path_round_trip() {
    let (verifier, agent) = happy_path(
        "did:oas:test:alice",
        vec!["mcp:search_web:invoke".to_owned()],
    );
    let inner = build_handler().await;
    let middleware = OpenAgentMiddleware::new(Config::new(agent.clone()));
    let wrapped = inner.with_openagent(middleware);

    let result = wrapped
        .call_tool(ToolCall {
            name: "search_web".to_owned(),
            arguments: serde_json::json!({ "q": "mcp" }),
            meta: meta_with_identity("did:oas:test:alice", "valid"),
        })
        .await
        .expect("call should succeed");

    assert_eq!(verifier.call_count(), 1);
    let openagent_meta = result
        .meta
        .get("openagent")
        .expect("audit metadata stamped");
    assert_eq!(
        openagent_meta.get("verified_did").and_then(|v| v.as_str()),
        Some("did:oas:test:alice")
    );
    assert!(openagent_meta
        .get("audit_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .starts_with("audit-"));
}

#[tokio::test]
async fn missing_identity_is_rejected() {
    let (_verifier, agent) = happy_path("did:oas:test:alice", vec![]);
    let inner = build_handler().await;
    let middleware = OpenAgentMiddleware::new(Config::new(agent));
    let wrapped = inner.with_openagent(middleware);

    let err = wrapped
        .call_tool(ToolCall {
            name: "search_web".to_owned(),
            arguments: serde_json::json!({}),
            meta: serde_json::json!({}),
        })
        .await
        .expect_err("missing identity should fail");

    assert!(matches!(err, McpAuthError::MissingIdentity { .. }));
    assert_eq!(err.code(), McpErrorCode::AuthenticationFailed);
}

#[tokio::test]
async fn permissive_mode_allows_anonymous_calls() {
    let (_verifier, agent) = happy_path("did:oas:test:alice", vec![]);
    let inner = build_handler().await;
    let middleware =
        OpenAgentMiddleware::new(Config::new(agent).with_require_identity(false));
    let wrapped = inner.with_openagent(middleware);

    let result = wrapped
        .call_tool(ToolCall {
            name: "search_web".to_owned(),
            arguments: serde_json::json!({ "q": "anon" }),
            meta: serde_json::json!({}),
        })
        .await
        .expect("permissive call should succeed");

    let did = result
        .meta
        .get("openagent")
        .and_then(|m| m.get("verified_did"))
        .and_then(|v| v.as_str());
    assert_eq!(did, Some("did:oas:anonymous"));
}

#[tokio::test]
async fn invalid_identity_is_rejected() {
    let verifier = Arc::new(FakeVerifier::new([FakeRecord {
        did: "did:oas:test:alice".to_owned(),
        proof: "valid".to_owned(),
        scopes: vec![],
    }]));
    let agent = FakeAgent::new("did:oas:test:alice", "valid", verifier);
    let inner = build_handler().await;
    let middleware = OpenAgentMiddleware::new(Config::new(agent));
    let wrapped = inner.with_openagent(middleware);

    let err = wrapped
        .call_tool(ToolCall {
            name: "search_web".to_owned(),
            arguments: serde_json::json!({ "q": "mcp" }),
            meta: meta_with_identity("did:oas:test:alice", "wrong-proof"),
        })
        .await
        .expect_err("bad proof should fail verification");
    assert!(matches!(err, McpAuthError::VerificationFailed { .. }));
}

#[tokio::test]
async fn missing_scope_is_rejected() {
    let (_verifier, agent) = happy_path(
        "did:oas:test:alice",
        vec!["mcp:other:invoke".to_owned()],
    );
    let inner = build_handler().await;
    let middleware = OpenAgentMiddleware::new(Config::new(agent));
    let wrapped = inner.with_openagent(middleware);

    let err = wrapped
        .call_tool(ToolCall {
            name: "search_web".to_owned(),
            arguments: serde_json::json!({ "q": "mcp" }),
            meta: meta_with_identity("did:oas:test:alice", "valid"),
        })
        .await
        .expect_err("missing scope should fail");
    assert!(matches!(err, McpAuthError::AuthorizationDenied { .. }));
    assert_eq!(err.code(), McpErrorCode::AuthorizationDenied);
}

#[tokio::test]
async fn custom_require_scopes_is_used() {
    let (_verifier, agent) = happy_path(
        "did:oas:test:alice",
        vec!["admin:write_file:invoke".to_owned()],
    );
    let inner = InMemoryToolHandler::new();
    inner
        .register("write_file", None, |_args| async move {
            Ok(ToolResult::text("ok"))
        })
        .await;
    let middleware = OpenAgentMiddleware::new(
        Config::new(agent).with_require_scopes(Arc::new(|tool_name, args| {
            if tool_name == "write_file"
                && args.get("dest").and_then(|v| v.as_str()) == Some("/etc")
            {
                vec!["admin:write_file:invoke".to_owned()]
            } else {
                vec![format!("mcp:{tool_name}:invoke")]
            }
        })),
    );
    let wrapped = inner.with_openagent(middleware);

    let result = wrapped
        .call_tool(ToolCall {
            name: "write_file".to_owned(),
            arguments: serde_json::json!({ "dest": "/etc" }),
            meta: meta_with_identity("did:oas:test:alice", "valid"),
        })
        .await
        .expect("custom scope should grant access");
    assert!(result
        .meta
        .get("openagent")
        .and_then(|v| v.get("verified_did"))
        .is_some());
}

#[tokio::test]
async fn pre_post_hooks_run_in_order() {
    let (_verifier, agent) =
        happy_path("did:oas:test:alice", vec!["mcp:do_thing:invoke".to_owned()]);
    let events = Arc::new(Mutex::new(Vec::<&'static str>::new()));
    let inner = InMemoryToolHandler::new();
    let events_for_tool = events.clone();
    inner
        .register("do_thing", None, move |_args| {
            let events = events_for_tool.clone();
            async move {
                events.lock().unwrap().push("handler");
                Ok(ToolResult::text("ok"))
            }
        })
        .await;

    let pre_events = events.clone();
    let post_events = events.clone();
    let middleware = OpenAgentMiddleware::new(
        Config::new(agent)
            .with_pre_call(Arc::new(move |_ctx| {
                let events = pre_events.clone();
                Box::pin(async move {
                    events.lock().unwrap().push("pre");
                })
            }))
            .with_post_call(Arc::new(move |ctx| {
                assert!(ctx.duration_ms < 10_000);
                let events = post_events.clone();
                Box::pin(async move {
                    events.lock().unwrap().push("post");
                })
            })),
    );
    let wrapped = inner.with_openagent(middleware);

    wrapped
        .call_tool(ToolCall {
            name: "do_thing".to_owned(),
            arguments: serde_json::json!({}),
            meta: meta_with_identity("did:oas:test:alice", "valid"),
        })
        .await
        .expect("call should succeed");

    let events = events.lock().unwrap().clone();
    assert_eq!(events, vec!["pre", "handler", "post"]);
}

#[tokio::test]
async fn error_hook_runs_on_failure_and_error_propagates() {
    let (_verifier, agent) =
        happy_path("did:oas:test:alice", vec!["mcp:fail:invoke".to_owned()]);
    let inner = InMemoryToolHandler::new();
    inner
        .register("fail", None, |_args| async move {
            Err(McpAuthError::ToolFailed {
                tool: "fail".to_owned(),
                source: "boom".into(),
            })
        })
        .await;

    let captured = Arc::new(Mutex::new(Vec::<String>::new()));
    let captured_for_hook = captured.clone();
    let middleware =
        OpenAgentMiddleware::new(Config::new(agent).with_on_error(Arc::new(move |ctx| {
            let captured = captured_for_hook.clone();
            let message = ctx.error.to_string();
            Box::pin(async move {
                captured.lock().unwrap().push(message);
            })
        })));
    let wrapped = inner.with_openagent(middleware);

    let err = wrapped
        .call_tool(ToolCall {
            name: "fail".to_owned(),
            arguments: serde_json::json!({}),
            meta: meta_with_identity("did:oas:test:alice", "valid"),
        })
        .await
        .expect_err("tool should fail");
    assert!(matches!(err, McpAuthError::ToolFailed { .. }));
    let captured = captured.lock().unwrap();
    assert_eq!(captured.len(), 1);
    assert!(captured[0].contains("fail"));
}
