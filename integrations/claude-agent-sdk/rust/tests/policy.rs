//! Unit tests for capability + skills policies.
#![allow(clippy::expect_used)]
#![allow(clippy::unwrap_used)]
#![allow(clippy::panic)]

use std::sync::Arc;

use openagent_claude_agent::identity::Identity;
use openagent_claude_agent::policy::{
    skill_scope, tool_scope, AllowListSkillsPolicy, CapabilityChecker, CompositeSkillsPolicy,
    DenyUnlessScopedSkillsPolicy, SkillsPolicy, StaticCapabilityChecker,
};

fn id() -> Identity {
    Identity::new("did:oas:test:agent:x", "agent", [0u8; 32])
}

#[tokio::test]
async fn static_checker_literal_match() {
    let c = StaticCapabilityChecker::new(["tools:invoke:bash"]);
    assert!(c.check("tools:invoke:bash").await.expect("ok").allowed);
    assert!(!c.check("tools:invoke:read").await.expect("ok").allowed);
}

#[tokio::test]
async fn static_checker_wildcard_match() {
    let c = StaticCapabilityChecker::new(["skills:invoke:web.*"]);
    assert!(c.check("skills:invoke:web.search").await.expect("ok").allowed);
    assert!(c.check("skills:invoke:web.fetch").await.expect("ok").allowed);
    assert!(!c.check("skills:invoke:fs.read").await.expect("ok").allowed);
}

#[tokio::test]
async fn deny_unless_scoped_denies_missing() {
    let p = DenyUnlessScopedSkillsPolicy;
    let c = StaticCapabilityChecker::new(Vec::<String>::new());
    let id = id();
    let d = p.evaluate("foo", &id, &c).await.expect("ok");
    assert!(!d.allowed);
    // The policy propagates the capability checker's denial reason verbatim;
    // its own "missing scope: ..." message is only a fallback for checkers
    // that deny without giving a reason. StaticCapabilityChecker always
    // supplies "no matching scope for ...", so that is what surfaces here —
    // same semantics as the TypeScript suite's "denies when scope is missing"
    // (integrations/claude-agent-sdk/typescript/test/policy.test.ts).
    assert!(d.reason.unwrap_or_default().contains("no matching scope"));
}

#[tokio::test]
async fn deny_unless_scoped_allows_when_held() {
    let p = DenyUnlessScopedSkillsPolicy;
    let c = StaticCapabilityChecker::new(["skills:invoke:foo"]);
    let id = id();
    let d = p.evaluate("foo", &id, &c).await.expect("ok");
    assert!(d.allowed);
    assert_eq!(d.matched_scope.as_deref(), Some("skills:invoke:foo"));
}

#[tokio::test]
async fn allow_list_blocks_unlisted_skills() {
    let p = AllowListSkillsPolicy::new(["web.search"], None);
    let c = StaticCapabilityChecker::new(["skills:invoke:web.search", "skills:invoke:fs.write"]);
    let id = id();
    assert!(p.evaluate("web.search", &id, &c).await.expect("ok").allowed);
    assert!(!p.evaluate("fs.write", &id, &c).await.expect("ok").allowed);
}

#[tokio::test]
async fn composite_requires_all_to_allow() {
    let inner_a: Arc<dyn SkillsPolicy> =
        Arc::new(AllowListSkillsPolicy::new(["web.search", "fs.read"], None));
    let inner_b: Arc<dyn SkillsPolicy> = Arc::new(DenyUnlessScopedSkillsPolicy);
    let composite = CompositeSkillsPolicy::new(vec![inner_a, inner_b]);
    let c = StaticCapabilityChecker::new(["skills:invoke:web.search"]);
    let id = id();
    assert!(composite.evaluate("web.search", &id, &c).await.expect("ok").allowed);
    // fs.read is in the allow-list but missing scope:
    assert!(!composite.evaluate("fs.read", &id, &c).await.expect("ok").allowed);
    // fs.write is not in the allow-list:
    assert!(!composite.evaluate("fs.write", &id, &c).await.expect("ok").allowed);
}

#[test]
fn scope_helpers() {
    assert_eq!(tool_scope("bash"), "tools:invoke:bash");
    assert_eq!(skill_scope("web.search"), "skills:invoke:web.search");
}
