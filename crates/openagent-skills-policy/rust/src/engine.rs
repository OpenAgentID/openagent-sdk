//! The [`SkillsPolicy`] engine.
//!
//! This is the top-level type agents and runtimes interact with. It owns:
//!
//! - The parsed [`SkillsPolicyDoc`]
//! - A per-skill GCRA rate limiter
//! - The hash-chained audit log
//! - A compiled cache of JSON Schema validators
//!
//! All "can this agent invoke this skill right now?" questions flow through
//! [`SkillsPolicy::can_invoke`], which is a read-only check. State-changing
//! calls go through [`SkillsPolicy::record_invocation`], which enforces the
//! same checks and additionally advances the rate limiter and appends to
//! the audit chain.

use std::collections::HashMap;
use std::path::Path;

use jsonschema::JSONSchema;
use time::OffsetDateTime;

use crate::audit::{AuditChain, Receipt};
use crate::did::Did;
use crate::error::{Result, SkillsPolicyError};
use crate::policy::{AuditLevel, SkillRule, SkillsPolicyDoc, TimeWindow};
use crate::rate::{RateLimitDecision, RateLimiter};

/// Context passed into `can_invoke` / `record_invocation` describing who is
/// attempting to use a skill, when, and with what arguments.
#[derive(Debug, Clone)]
pub struct InvocationContext {
    /// DID of the invoking agent.
    pub agent_did: Did,
    /// Session ID (opaque string — matches `arsenal-core::SessionId` shape).
    pub session_id: String,
    /// Arguments that will be passed to the skill.
    pub arguments: serde_json::Value,
    /// Wall-clock time of the attempted invocation (UTC).
    pub invoked_at: OffsetDateTime,
    /// Whether the caller has already collected human-in-the-loop consent.
    pub consent_granted: bool,
}

impl InvocationContext {
    /// Convenience constructor. `consent_granted` defaults to `false`.
    pub fn new(
        agent_did: Did,
        session_id: impl Into<String>,
        arguments: serde_json::Value,
    ) -> Self {
        Self {
            agent_did,
            session_id: session_id.into(),
            arguments,
            invoked_at: OffsetDateTime::now_utc(),
            consent_granted: false,
        }
    }

    /// Mark consent as granted (e.g. after a HITL approval flow).
    #[must_use]
    pub fn with_consent(mut self) -> Self {
        self.consent_granted = true;
        self
    }

    /// Override the invocation timestamp (primarily for testing).
    #[must_use]
    pub fn with_invoked_at(mut self, t: OffsetDateTime) -> Self {
        self.invoked_at = t;
        self
    }
}

/// Governance engine for agent skill invocations.
pub struct SkillsPolicy {
    doc: SkillsPolicyDoc,
    limiter: RateLimiter,
    audit: AuditChain,
    /// Compiled JSON Schema validators, keyed by skill name. Computed lazily
    /// at load time so that `can_invoke` is branch-free on the hot path.
    schemas: HashMap<String, JSONSchema>,
}

impl std::fmt::Debug for SkillsPolicy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SkillsPolicy")
            .field("agent", &self.doc.agent)
            .field("rules", &self.doc.skills.len())
            .field("audit_length", &self.audit.len())
            .finish()
    }
}

impl SkillsPolicy {
    /// Parse a policy YAML document.
    ///
    /// # Errors
    /// Returns [`SkillsPolicyError::InvalidPolicy`] if the YAML is malformed
    /// or fails structural validation.
    pub fn from_yaml(yaml: &str) -> Result<Self> {
        let doc: SkillsPolicyDoc = serde_yaml::from_str(yaml)
            .map_err(|e| SkillsPolicyError::InvalidPolicy(format!("YAML parse error: {e}")))?;
        doc.validate()?;
        let schemas = compile_schemas(&doc)?;
        Ok(Self {
            doc,
            limiter: RateLimiter::new(),
            audit: AuditChain::new(),
            schemas,
        })
    }

    /// Load a policy YAML document from a file path.
    ///
    /// # Errors
    /// Returns [`SkillsPolicyError::Io`] on read failure, or any error from
    /// [`SkillsPolicy::from_yaml`] on parse/validation failure.
    pub fn from_file(path: &Path) -> Result<Self> {
        let content = std::fs::read_to_string(path).map_err(|source| SkillsPolicyError::Io {
            path: path.to_path_buf(),
            source,
        })?;
        Self::from_yaml(&content)
    }

    /// The DID of the agent this policy applies to.
    #[must_use]
    pub fn agent(&self) -> &Did {
        &self.doc.agent
    }

    /// Whether the policy has a per-skill rule for `skill`.
    #[must_use]
    pub fn has_rule(&self, skill: &str) -> bool {
        self.doc.skills.contains_key(skill)
    }

    /// Read-only check: can `ctx` invoke `skill` right now?
    ///
    /// This runs every policy dimension except the rate-limit *advance*. A
    /// successful return does not consume any rate-limit tokens — use
    /// `record_invocation` for that.
    ///
    /// # Errors
    /// Returns a specific [`SkillsPolicyError`] variant per failed dimension.
    pub fn can_invoke(&self, skill: &str, ctx: &InvocationContext) -> Result<()> {
        // 1. Agent binding: the context DID must match the policy's DID.
        if ctx.agent_did != self.doc.agent {
            return Err(SkillsPolicyError::not_allowed(
                skill,
                format!(
                    "policy is bound to `{}`, got `{}`",
                    self.doc.agent, ctx.agent_did
                ),
            ));
        }

        // 2. Resolve the effective rule for this skill.
        let (rule, is_default) = self.resolve_rule(skill);

        // 3. Allow/deny.
        if !rule.allow {
            let reason = if is_default {
                "no matching rule and default.allow = false".to_string()
            } else {
                "rule has allow = false".to_string()
            };
            return Err(SkillsPolicyError::not_allowed(skill, reason));
        }

        // 4. Time window.
        if !rule.time_windows.is_empty()
            && !time_matches(&rule.time_windows, ctx.invoked_at)
        {
            return Err(SkillsPolicyError::OutsideTimeWindow {
                skill: skill.to_string(),
            });
        }

        // 5. Consent.
        if rule.require_consent && !ctx.consent_granted {
            return Err(SkillsPolicyError::ConsentRequired {
                skill: skill.to_string(),
            });
        }

        // 6. Argument constraints (JSON Schema).
        if let Some(schema) = self.schemas.get(skill) {
            if let Err(mut errors) = schema.validate(&ctx.arguments).map(|_| ()) {
                let first = errors
                    .next()
                    .map_or_else(|| "unknown violation".to_string(), |e| e.to_string());
                return Err(SkillsPolicyError::ArgumentConstraint {
                    skill: skill.to_string(),
                    details: first,
                });
            }
        }

        Ok(())
    }

    /// Authorize and record an invocation.
    ///
    /// This runs `can_invoke`, then checks and advances the rate limiter,
    /// then appends a [`Receipt`] to the hash-chained audit log. On any
    /// failure no state changes.
    ///
    /// # Errors
    /// Returns the first dimension that failed. On rate-limit failure the
    /// caller gets `used` and `max` values to surface a friendly error.
    pub fn record_invocation(
        &mut self,
        skill: &str,
        ctx: &InvocationContext,
    ) -> Result<Receipt> {
        self.can_invoke(skill, ctx)?;

        let (rule, _) = self.resolve_rule(skill);
        let audit_level = rule.audit_level;

        // Rate limit — enforce AFTER validation, BEFORE append, so we don't
        // advance the counter when the arguments are invalid.
        if let Some(ref rl) = rule.rate_limit {
            match self.limiter.check_and_record(skill, rl, ctx.invoked_at) {
                RateLimitDecision::Allowed => {}
                RateLimitDecision::Denied { used } => {
                    let window_secs = crate::duration::parse_duration(&rl.window)
                        .map(|d| d.as_secs())
                        .unwrap_or_default();
                    return Err(SkillsPolicyError::RateLimitExceeded {
                        skill: skill.to_string(),
                        used,
                        max: rl.max,
                        window_secs,
                    });
                }
            }
        }

        // Append to audit chain if enabled.
        match audit_level {
            AuditLevel::None => {
                // Still build a receipt so callers get a stable return type,
                // but don't persist it in the chain.
                let synthetic = Receipt {
                    sequence: u64::MAX,
                    skill: skill.to_string(),
                    agent: ctx.agent_did.as_str().to_string(),
                    session: ctx.session_id.clone(),
                    invoked_at: format_iso(ctx.invoked_at),
                    audit_level,
                    arguments_hash: crate::audit::HashHex::from_bytes(&[0u8; 32]),
                    arguments: None,
                    previous_hash: self.audit.head(),
                    receipt_hash: self.audit.head(),
                };
                Ok(synthetic)
            }
            AuditLevel::Hash | AuditLevel::Full => self
                .audit
                .append(
                    skill,
                    ctx.agent_did.as_str(),
                    &ctx.session_id,
                    ctx.invoked_at,
                    audit_level,
                    &ctx.arguments,
                )
                .map_err(|e| {
                    SkillsPolicyError::InvalidPolicy(format!(
                        "failed to serialize audit receipt: {e}"
                    ))
                }),
        }
    }

    /// Borrow the audit chain for inspection (verification, export).
    #[must_use]
    pub fn audit_chain(&self) -> &AuditChain {
        &self.audit
    }

    /// Reset the rate-limit state for a single skill.
    pub fn reset_rate_limit(&mut self, skill: &str) {
        self.limiter.reset(skill);
    }

    /// Resolve the effective rule for a given skill, returning whether we
    /// fell back to the default.
    fn resolve_rule(&self, skill: &str) -> (SkillRule, bool) {
        if let Some(rule) = self.doc.skills.get(skill) {
            (rule.clone(), false)
        } else {
            let default = &self.doc.default;
            (
                SkillRule {
                    allow: default.allow,
                    rate_limit: None,
                    arg_constraints: None,
                    time_windows: vec![],
                    require_consent: false,
                    audit_level: default.audit_level,
                },
                true,
            )
        }
    }
}

fn compile_schemas(doc: &SkillsPolicyDoc) -> Result<HashMap<String, JSONSchema>> {
    let mut out = HashMap::new();
    for (name, rule) in &doc.skills {
        if let Some(ref schema_value) = rule.arg_constraints {
            let compiled = JSONSchema::options()
                .with_draft(jsonschema::Draft::Draft7)
                .compile(schema_value)
                .map_err(|e| {
                    SkillsPolicyError::InvalidPolicy(format!(
                        "skill `{name}` has invalid JSON Schema: {e}"
                    ))
                })?;
            out.insert(name.clone(), compiled);
        }
    }
    Ok(out)
}

fn time_matches(windows: &[TimeWindow], now: OffsetDateTime) -> bool {
    let hour = now.hour();
    let weekday = match now.weekday() {
        // time::Weekday: Monday=1..Sunday=7. We map to 0=Sunday..6=Saturday
        // to match ISO/JS conventions used in the YAML.
        time::Weekday::Sunday => 0,
        time::Weekday::Monday => 1,
        time::Weekday::Tuesday => 2,
        time::Weekday::Wednesday => 3,
        time::Weekday::Thursday => 4,
        time::Weekday::Friday => 5,
        time::Weekday::Saturday => 6,
    };
    windows
        .iter()
        .any(|w| window_contains(w, hour, weekday))
}

fn window_contains(w: &TimeWindow, hour: u8, weekday: u8) -> bool {
    if !w.weekdays.is_empty() && !w.weekdays.contains(&weekday) {
        return false;
    }
    if w.start_hour <= w.end_hour {
        hour >= w.start_hour && hour < w.end_hour
    } else {
        // Overnight window (e.g. 22..6).
        hour >= w.start_hour || hour < w.end_hour
    }
}

fn format_iso(t: OffsetDateTime) -> String {
    let format = time::format_description::well_known::Rfc3339;
    t.format(&format)
        .unwrap_or_else(|_| t.unix_timestamp().to_string())
}

/// Used by integration with Arsenal: convert a `SkillsPolicyError` into an
/// `arsenal_core::ArsenalError`. Kept behind the engine module so that
/// downstream crates can depend on this without pulling the whole module
/// graph.
pub fn arsenal_error_from(err: &SkillsPolicyError) -> arsenal_core::ArsenalError {
    use arsenal_core::error::{ArsenalError, ErrorCode};
    match err {
        SkillsPolicyError::NotAllowed { .. } => {
            ArsenalError::new(ErrorCode::PolicyDenied, err.to_string())
        }
        SkillsPolicyError::RateLimitExceeded { .. } => {
            ArsenalError::rate_limit_exceeded(None)
        }
        SkillsPolicyError::ArgumentConstraint { .. } => {
            ArsenalError::new(ErrorCode::ValidationFailed, err.to_string())
        }
        SkillsPolicyError::OutsideTimeWindow { .. } => {
            ArsenalError::new(ErrorCode::TimeConstraintViolation, err.to_string())
        }
        SkillsPolicyError::ConsentRequired { .. } => {
            ArsenalError::new(ErrorCode::PolicyDenied, err.to_string())
        }
        _ => ArsenalError::new(ErrorCode::ValidationFailed, err.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agent() -> Did {
        Did::new("did:oas:l1fe:agent:my-bot").expect("did")
    }

    #[test]
    fn default_denies_unknown_skills() {
        let yaml = "version: 1\nagent: did:oas:l1fe:agent:my-bot\ndefault:\n  allow: false\n";
        let policy = SkillsPolicy::from_yaml(yaml).expect("loads");
        let ctx = InvocationContext::new(agent(), "s1", serde_json::json!({}));
        assert!(matches!(
            policy.can_invoke("unknown", &ctx).unwrap_err(),
            SkillsPolicyError::NotAllowed { .. }
        ));
    }

    #[test]
    fn allow_list_hit_passes() {
        let yaml = r#"
version: 1
agent: did:oas:l1fe:agent:my-bot
skills:
  frontend-design:
    allow: true
default:
  allow: false
"#;
        let policy = SkillsPolicy::from_yaml(yaml).expect("loads");
        let ctx = InvocationContext::new(agent(), "s1", serde_json::json!({}));
        assert!(policy.can_invoke("frontend-design", &ctx).is_ok());
    }

    #[test]
    fn deny_rule_blocks() {
        let yaml = r#"
version: 1
agent: did:oas:l1fe:agent:my-bot
skills:
  rm-rf:
    allow: false
default:
  allow: true
"#;
        let policy = SkillsPolicy::from_yaml(yaml).expect("loads");
        let ctx = InvocationContext::new(agent(), "s1", serde_json::json!({}));
        assert!(matches!(
            policy.can_invoke("rm-rf", &ctx).unwrap_err(),
            SkillsPolicyError::NotAllowed { .. }
        ));
    }

    #[test]
    fn arg_schema_enforced() {
        let yaml = r#"
version: 1
agent: did:oas:l1fe:agent:my-bot
skills:
  frontend-design:
    allow: true
    arg_constraints:
      type: object
      required: [component]
      properties:
        component:
          type: string
default:
  allow: false
"#;
        let policy = SkillsPolicy::from_yaml(yaml).expect("loads");
        // Missing `component`
        let ctx = InvocationContext::new(agent(), "s1", serde_json::json!({}));
        assert!(matches!(
            policy.can_invoke("frontend-design", &ctx).unwrap_err(),
            SkillsPolicyError::ArgumentConstraint { .. }
        ));
        // Valid
        let ctx2 = InvocationContext::new(
            agent(),
            "s1",
            serde_json::json!({ "component": "Button" }),
        );
        assert!(policy.can_invoke("frontend-design", &ctx2).is_ok());
    }

    #[test]
    fn consent_gate() {
        let yaml = r#"
version: 1
agent: did:oas:l1fe:agent:my-bot
skills:
  deploy:
    allow: true
    require_consent: true
default:
  allow: false
"#;
        let policy = SkillsPolicy::from_yaml(yaml).expect("loads");
        let ctx = InvocationContext::new(agent(), "s1", serde_json::json!({}));
        assert!(matches!(
            policy.can_invoke("deploy", &ctx).unwrap_err(),
            SkillsPolicyError::ConsentRequired { .. }
        ));
        let ctx_ok = ctx.with_consent();
        assert!(policy.can_invoke("deploy", &ctx_ok).is_ok());
    }

    #[test]
    fn rate_limit_enforced_and_tracked_by_record() {
        let yaml = r#"
version: 1
agent: did:oas:l1fe:agent:my-bot
skills:
  foo:
    allow: true
    rate_limit:
      window: 60s
      max: 2
    audit_level: hash
default:
  allow: false
"#;
        let mut policy = SkillsPolicy::from_yaml(yaml).expect("loads");
        let t = OffsetDateTime::from_unix_timestamp(1_700_000_000).expect("ts");
        let ctx = InvocationContext::new(agent(), "s1", serde_json::json!({}))
            .with_invoked_at(t);
        assert!(policy.record_invocation("foo", &ctx).is_ok());
        assert!(policy.record_invocation("foo", &ctx).is_ok());
        let err = policy.record_invocation("foo", &ctx).unwrap_err();
        assert!(matches!(err, SkillsPolicyError::RateLimitExceeded { .. }));
    }

    #[test]
    fn record_invocation_appends_audit() {
        let yaml = r#"
version: 1
agent: did:oas:l1fe:agent:my-bot
skills:
  foo:
    allow: true
    audit_level: hash
default:
  allow: false
"#;
        let mut policy = SkillsPolicy::from_yaml(yaml).expect("loads");
        let ctx = InvocationContext::new(agent(), "s1", serde_json::json!({ "a": 1 }));
        assert_eq!(policy.audit_chain().len(), 0);
        let r = policy.record_invocation("foo", &ctx).expect("ok");
        assert_eq!(r.sequence, 0);
        assert_eq!(policy.audit_chain().len(), 1);
        assert!(policy.audit_chain().verify());
    }

    #[test]
    fn agent_binding_mismatch() {
        let yaml = "version: 1\nagent: did:oas:l1fe:agent:a\ndefault:\n  allow: true\n";
        let policy = SkillsPolicy::from_yaml(yaml).expect("loads");
        let wrong =
            InvocationContext::new(Did::new("did:oas:l1fe:agent:b").expect("did"), "s1", serde_json::json!({}));
        assert!(matches!(
            policy.can_invoke("foo", &wrong).unwrap_err(),
            SkillsPolicyError::NotAllowed { .. }
        ));
    }

    #[test]
    fn time_window_blocks_outside() {
        // Window 10..12 UTC, record at 14:00 UTC
        let yaml = r#"
version: 1
agent: did:oas:l1fe:agent:my-bot
skills:
  foo:
    allow: true
    time_windows:
      - start_hour: 10
        end_hour: 12
default:
  allow: false
"#;
        let policy = SkillsPolicy::from_yaml(yaml).expect("loads");
        // 2024-01-01 14:00:00 UTC
        let at = OffsetDateTime::from_unix_timestamp(1_704_117_600).expect("ts");
        let ctx = InvocationContext::new(agent(), "s1", serde_json::json!({}))
            .with_invoked_at(at);
        assert!(matches!(
            policy.can_invoke("foo", &ctx).unwrap_err(),
            SkillsPolicyError::OutsideTimeWindow { .. }
        ));
    }

    #[test]
    fn invalid_schema_fails_load() {
        let yaml = r#"
version: 1
agent: did:oas:l1fe:agent:my-bot
skills:
  foo:
    arg_constraints:
      type: "not-a-real-type"
default:
  allow: false
"#;
        assert!(SkillsPolicy::from_yaml(yaml).is_err());
    }

    #[test]
    fn rate_limit_denied_does_not_append_audit() {
        let yaml = r#"
version: 1
agent: did:oas:l1fe:agent:my-bot
skills:
  foo:
    allow: true
    rate_limit:
      window: 60s
      max: 1
    audit_level: hash
default:
  allow: false
"#;
        let mut policy = SkillsPolicy::from_yaml(yaml).expect("loads");
        let ctx = InvocationContext::new(agent(), "s1", serde_json::json!({}));
        assert!(policy.record_invocation("foo", &ctx).is_ok());
        assert_eq!(policy.audit_chain().len(), 1);
        assert!(policy.record_invocation("foo", &ctx).is_err());
        // Audit length is unchanged on rate-limit denial.
        assert_eq!(policy.audit_chain().len(), 1);
    }
}
