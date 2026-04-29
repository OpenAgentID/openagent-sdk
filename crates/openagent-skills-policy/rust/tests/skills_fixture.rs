//! Integration tests that exercise the engine against the realistic
//! `fixtures/SKILLS.md` and a matching YAML policy authored against it.

use std::path::PathBuf;

use openagent_skills_policy::{
    Did, InvocationContext, SkillsManifest, SkillsPolicy, SkillsPolicyError,
};
use serde_json::json;
use time::OffsetDateTime;

fn fixture_path(name: &str) -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("fixtures");
    p.push(name);
    p
}

const POLICY_YAML: &str = r#"
version: 1
agent: did:oas:l1fe:agent:my-bot
description: Policy authored against fixtures/SKILLS.md
skills:
  frontend-design:
    allow: true
    rate_limit:
      window: 1h
      max: 5
    arg_constraints:
      type: object
      required: [component]
      properties:
        component:
          type: string
    audit_level: hash
  backend-scaffold:
    allow: true
    audit_level: full
  deploy-production:
    allow: true
    require_consent: true
    audit_level: full
  run-migrations:
    allow: true
    require_consent: true
    rate_limit:
      window: 1d
      max: 3
    audit_level: full
  rm-rf:
    allow: false
  read-logs:
    allow: true
    audit_level: none
  send-email:
    allow: true
    rate_limit:
      window: 1h
      max: 10
    audit_level: hash
default:
  allow: false
  audit_level: hash
"#;

fn agent_did() -> Did {
    Did::new("did:oas:l1fe:agent:my-bot").expect("valid did")
}

fn ctx(args: serde_json::Value) -> InvocationContext {
    InvocationContext::new(agent_did(), "session-test", args)
}

#[test]
fn skills_md_parses_fixture() {
    let manifest = SkillsManifest::from_file(&fixture_path("SKILLS.md")).expect("parses");
    assert_eq!(manifest.len(), 7);
    let names: Vec<&str> = manifest.names().collect();
    assert!(names.contains(&"frontend-design"));
    assert!(names.contains(&"deploy-production"));
    assert!(names.contains(&"rm-rf"));
    assert!(names.contains(&"read-logs"));

    let frontend = manifest.get("frontend-design").expect("present");
    assert!(frontend
        .description
        .contains("Generate production-grade React components"));
}

#[test]
fn policy_matches_fixture_surface() {
    let manifest = SkillsManifest::from_file(&fixture_path("SKILLS.md")).expect("parses");
    let policy = SkillsPolicy::from_yaml(POLICY_YAML).expect("loads");
    // Every skill in SKILLS.md should have a matching policy rule — this is
    // the "author policies against the actual skill surface" guarantee.
    for name in manifest.names() {
        assert!(
            policy.has_rule(name),
            "skill `{name}` missing from policy"
        );
    }
}

#[test]
fn denied_skill_blocks_invocation() {
    let policy = SkillsPolicy::from_yaml(POLICY_YAML).expect("loads");
    let err = policy.can_invoke("rm-rf", &ctx(json!({}))).unwrap_err();
    assert!(matches!(err, SkillsPolicyError::NotAllowed { .. }));
}

#[test]
fn consent_required_skill_blocks_without_consent() {
    let policy = SkillsPolicy::from_yaml(POLICY_YAML).expect("loads");
    let c = ctx(json!({ "manifest_path": "k8s/prod.yaml" }));
    assert!(matches!(
        policy.can_invoke("deploy-production", &c).unwrap_err(),
        SkillsPolicyError::ConsentRequired { .. }
    ));
    assert!(policy
        .can_invoke("deploy-production", &c.with_consent())
        .is_ok());
}

#[test]
fn frontend_schema_rejects_missing_component() {
    let policy = SkillsPolicy::from_yaml(POLICY_YAML).expect("loads");
    let err = policy
        .can_invoke("frontend-design", &ctx(json!({})))
        .unwrap_err();
    assert!(matches!(err, SkillsPolicyError::ArgumentConstraint { .. }));
}

#[test]
fn frontend_schema_accepts_valid_component() {
    let policy = SkillsPolicy::from_yaml(POLICY_YAML).expect("loads");
    assert!(policy
        .can_invoke(
            "frontend-design",
            &ctx(json!({ "component": "LoginForm" }))
        )
        .is_ok());
}

#[test]
fn rate_limit_bounds_frontend_invocations() {
    let mut policy = SkillsPolicy::from_yaml(POLICY_YAML).expect("loads");
    let t = OffsetDateTime::from_unix_timestamp(1_700_000_000).expect("ts");
    for _ in 0..5 {
        let c = ctx(json!({ "component": "Button" })).with_invoked_at(t);
        assert!(policy.record_invocation("frontend-design", &c).is_ok());
    }
    let sixth = ctx(json!({ "component": "Button" })).with_invoked_at(t);
    let err = policy
        .record_invocation("frontend-design", &sixth)
        .unwrap_err();
    let is_rate = matches!(
        &err,
        SkillsPolicyError::RateLimitExceeded { skill, max, .. }
            if skill == "frontend-design" && *max == 5
    );
    assert!(is_rate, "expected RateLimitExceeded, got {err:?}");
}

#[test]
fn audit_chain_intact_after_many_invocations() {
    let mut policy = SkillsPolicy::from_yaml(POLICY_YAML).expect("loads");
    for i in 0..10 {
        let c = ctx(json!({ "to": format!("user{i}@example.com"),
                            "subject": "ping", "body_markdown": "hi" }));
        if i < 10 {
            let _ = policy.record_invocation("send-email", &c);
        }
    }
    assert!(policy.audit_chain().len() >= 5);
    assert!(policy.audit_chain().verify());
}

#[test]
fn default_deny_blocks_unknown_skill() {
    let policy = SkillsPolicy::from_yaml(POLICY_YAML).expect("loads");
    let err = policy
        .can_invoke("not-a-real-skill", &ctx(json!({})))
        .unwrap_err();
    assert!(matches!(err, SkillsPolicyError::NotAllowed { .. }));
}

#[test]
fn read_logs_allows_without_audit() {
    let mut policy = SkillsPolicy::from_yaml(POLICY_YAML).expect("loads");
    let before = policy.audit_chain().len();
    let c = ctx(json!({ "service": "foundry", "lines": 50 }));
    let receipt = policy.record_invocation("read-logs", &c).expect("ok");
    // audit_level: none — sequence is sentinel, chain is not extended.
    assert_eq!(receipt.sequence, u64::MAX);
    assert_eq!(policy.audit_chain().len(), before);
}

