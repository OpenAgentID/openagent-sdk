//! Capability + skills policy traits and default implementations.

use std::collections::HashSet;
use std::sync::Arc;

use async_trait::async_trait;

use crate::error::Result;
use crate::identity::OpenAgentIdentity;

/// Canonical scope prefix for tool invocations.
pub const TOOL_SCOPE_PREFIX: &str = "tools:invoke:";

/// Canonical scope prefix for skill invocations.
pub const SKILL_SCOPE_PREFIX: &str = "skills:invoke:";

/// Build a canonical scope string for a tool name.
#[must_use]
pub fn tool_scope(name: &str) -> String {
    format!("{TOOL_SCOPE_PREFIX}{name}")
}

/// Build a canonical scope string for a skill name.
#[must_use]
pub fn skill_scope(name: &str) -> String {
    format!("{SKILL_SCOPE_PREFIX}{name}")
}

/// Result of a single scope check.
#[derive(Debug, Clone)]
pub struct ScopeDecision {
    /// Whether the request is allowed.
    pub allowed: bool,
    /// Matched scope string (if any).
    pub matched_scope: Option<String>,
    /// Human-readable reason for denial.
    pub reason: Option<String>,
}

impl ScopeDecision {
    /// Build an allow decision.
    pub fn allow(matched: impl Into<String>) -> Self {
        Self {
            allowed: true,
            matched_scope: Some(matched.into()),
            reason: None,
        }
    }

    /// Build a deny decision.
    pub fn deny(reason: impl Into<String>) -> Self {
        Self {
            allowed: false,
            matched_scope: None,
            reason: Some(reason.into()),
        }
    }
}

/// Trait implemented by anything that can authorise scope requests.
#[async_trait]
pub trait CapabilityChecker: Send + Sync {
    /// Check whether the agent currently holds the requested scope.
    async fn check(&self, scope: &str) -> Result<ScopeDecision>;
}

/// Static capability checker backed by a fixed allow-list.
///
/// Supports literal scopes and one wildcard form: any entry ending in `*`
/// matches anything starting with the prefix preceding the `*`.
#[derive(Debug, Default)]
pub struct StaticCapabilityChecker {
    literal: HashSet<String>,
    wildcards: Vec<String>,
}

impl StaticCapabilityChecker {
    /// Construct a checker from an iterator of scope strings.
    pub fn new<I, S>(scopes: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let mut literal = HashSet::new();
        let mut wildcards = Vec::new();
        for s in scopes {
            let s: String = s.into();
            if let Some(prefix) = s.strip_suffix('*') {
                wildcards.push(prefix.to_string());
            } else {
                literal.insert(s);
            }
        }
        Self { literal, wildcards }
    }
}

#[async_trait]
impl CapabilityChecker for StaticCapabilityChecker {
    async fn check(&self, scope: &str) -> Result<ScopeDecision> {
        if self.literal.contains(scope) {
            return Ok(ScopeDecision::allow(scope.to_string()));
        }
        for prefix in &self.wildcards {
            if scope.starts_with(prefix) {
                return Ok(ScopeDecision::allow(format!("{prefix}*")));
            }
        }
        Ok(ScopeDecision::deny(format!("no matching scope for {scope}")))
    }
}

/// Decision returned by [`SkillsPolicy`].
#[derive(Debug, Clone)]
pub struct SkillDecision {
    /// Allow / deny.
    pub allowed: bool,
    /// Reason on deny.
    pub reason: Option<String>,
    /// Matched scope on allow.
    pub matched_scope: Option<String>,
}

/// Skills policy: gates SKILLS.md skill invocations.
#[async_trait]
pub trait SkillsPolicy: Send + Sync {
    /// Evaluate whether the named skill may be invoked by the current agent.
    async fn evaluate(
        &self,
        skill_name: &str,
        identity: &dyn OpenAgentIdentity,
        capabilities: &dyn CapabilityChecker,
    ) -> Result<SkillDecision>;
}

/// Default policy: deny unless the agent holds `skills:invoke:<name>`.
#[derive(Debug, Default, Clone, Copy)]
pub struct DenyUnlessScopedSkillsPolicy;

#[async_trait]
impl SkillsPolicy for DenyUnlessScopedSkillsPolicy {
    async fn evaluate(
        &self,
        skill_name: &str,
        _identity: &dyn OpenAgentIdentity,
        capabilities: &dyn CapabilityChecker,
    ) -> Result<SkillDecision> {
        let required = skill_scope(skill_name);
        let decision = capabilities.check(&required).await?;
        if decision.allowed {
            Ok(SkillDecision {
                allowed: true,
                reason: None,
                matched_scope: decision.matched_scope,
            })
        } else {
            Ok(SkillDecision {
                allowed: false,
                reason: Some(
                    decision
                        .reason
                        .unwrap_or_else(|| format!("missing scope: {required}")),
                ),
                matched_scope: None,
            })
        }
    }
}

/// Allow-list skills policy: only listed skills are permitted, and the
/// inner policy (defaults to [`DenyUnlessScopedSkillsPolicy`]) must also
/// allow the call.
pub struct AllowListSkillsPolicy {
    allowed: HashSet<String>,
    inner: Arc<dyn SkillsPolicy>,
}

impl AllowListSkillsPolicy {
    /// Construct a new allow-list policy.
    pub fn new<I, S>(allowed: I, inner: Option<Arc<dyn SkillsPolicy>>) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        Self {
            allowed: allowed.into_iter().map(Into::into).collect(),
            inner: inner.unwrap_or_else(|| Arc::new(DenyUnlessScopedSkillsPolicy)),
        }
    }
}

#[async_trait]
impl SkillsPolicy for AllowListSkillsPolicy {
    async fn evaluate(
        &self,
        skill_name: &str,
        identity: &dyn OpenAgentIdentity,
        capabilities: &dyn CapabilityChecker,
    ) -> Result<SkillDecision> {
        if !self.allowed.contains(skill_name) {
            return Ok(SkillDecision {
                allowed: false,
                reason: Some(format!("skill not in allow-list: {skill_name}")),
                matched_scope: None,
            });
        }
        self.inner.evaluate(skill_name, identity, capabilities).await
    }
}

/// Adapter that bridges the OpenAgent SDK's `SkillsPolicy` (synchronous,
/// owned by an `OpenAgent`) into this crate's async [`SkillsPolicy`].
///
/// Use this when you've already configured a skills policy on an
/// `openagent_sdk::OpenAgent` (e.g., via `with_skills_policy`) and want
/// the same policy to gate Claude Agent SDK skill invocations.
pub struct OpenAgentSdkSkillsPolicy {
    inner: openagent_sdk::SkillsPolicyHandle,
}

impl OpenAgentSdkSkillsPolicy {
    /// Wrap an `openagent_sdk::SkillsPolicyHandle`.
    pub fn new(inner: openagent_sdk::SkillsPolicyHandle) -> Self {
        Self { inner }
    }
}

#[async_trait]
impl SkillsPolicy for OpenAgentSdkSkillsPolicy {
    async fn evaluate(
        &self,
        skill_name: &str,
        _identity: &dyn OpenAgentIdentity,
        _capabilities: &dyn CapabilityChecker,
    ) -> Result<SkillDecision> {
        match self.inner.can_invoke(skill_name) {
            Ok(()) => Ok(SkillDecision {
                allowed: true,
                reason: None,
                matched_scope: Some(skill_scope(skill_name)),
            }),
            Err(e) => Ok(SkillDecision {
                allowed: false,
                reason: Some(e.to_string()),
                matched_scope: None,
            }),
        }
    }
}

/// Composite policy: every inner policy must allow.
pub struct CompositeSkillsPolicy {
    policies: Vec<Arc<dyn SkillsPolicy>>,
}

impl CompositeSkillsPolicy {
    /// Construct a composite policy from a Vec of inner policies.
    pub fn new(policies: Vec<Arc<dyn SkillsPolicy>>) -> Self {
        Self { policies }
    }
}

#[async_trait]
impl SkillsPolicy for CompositeSkillsPolicy {
    async fn evaluate(
        &self,
        skill_name: &str,
        identity: &dyn OpenAgentIdentity,
        capabilities: &dyn CapabilityChecker,
    ) -> Result<SkillDecision> {
        let mut last_matched: Option<String> = None;
        for p in &self.policies {
            let d = p.evaluate(skill_name, identity, capabilities).await?;
            if !d.allowed {
                return Ok(d);
            }
            if let Some(m) = d.matched_scope {
                last_matched = Some(m);
            }
        }
        Ok(SkillDecision {
            allowed: true,
            reason: None,
            matched_scope: last_matched,
        })
    }
}
