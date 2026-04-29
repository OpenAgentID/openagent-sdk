//! Skill policy interface.
//!
//! This module is intentionally minimal. The real `openagent-skills-policy`
//! crate is being built in parallel; once it lands, the OpenAgent SDK will
//! depend on it directly. Until then, the SDK ships:
//!
//! - the [`SkillsPolicy`] trait that the future crate will implement,
//! - a default [`AllowListPolicy`] backed by an explicit set of skill names,
//! - the [`SkillsPolicyHandle`] facade that [`crate::OpenAgent`] exposes.
//!
//! When the real crate replaces this stub, the public surface (`can_invoke`,
//! `allowed_skills`, `SkillsPolicyHandle`) is intended to remain stable.

use std::collections::BTreeSet;
use std::sync::Arc;

use crate::errors::{OpenAgentError, Result};

/// Trait every skill policy must implement.
///
/// A policy answers a single question: "is this agent allowed to invoke the
/// named skill, given the current verified context?". Implementations may be
/// pure (an in-memory allow-list) or remote (an HTTP call to a policy
/// service); the SDK does not care.
pub trait SkillsPolicy: Send + Sync {
    /// Return `Ok(())` if the skill is allowed, `Err` otherwise.
    fn can_invoke(&self, skill: &str) -> Result<()>;

    /// Return the set of skills currently allowed by this policy.
    ///
    /// Used by tooling and tests; the policy may return an empty set if it
    /// does not enumerate skills (e.g., a remote service).
    fn allowed_skills(&self) -> BTreeSet<String>;
}

/// Default in-memory allow-list skill policy.
///
/// `AllowListPolicy` lets callers register skill names up front and allow
/// them by exact match. Useful for tests, CLI tools, and bootstrap before
/// the real `openagent-skills-policy` crate is wired in.
#[derive(Debug, Clone, Default)]
pub struct AllowListPolicy {
    allowed: BTreeSet<String>,
}

impl AllowListPolicy {
    /// Create an empty policy that denies every skill.
    pub fn new() -> Self {
        Self::default()
    }

    /// Build a policy from an iterator of skill names.
    pub fn with_skills<I, S>(skills: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        Self {
            allowed: skills.into_iter().map(Into::into).collect(),
        }
    }

    /// Mutably add a skill to the allow-list.
    pub fn allow(&mut self, skill: impl Into<String>) {
        self.allowed.insert(skill.into());
    }
}

impl SkillsPolicy for AllowListPolicy {
    fn can_invoke(&self, skill: &str) -> Result<()> {
        if self.allowed.contains(skill) {
            Ok(())
        } else {
            Err(OpenAgentError::SkillDenied {
                skill: skill.to_string(),
                reason: "skill not in allow-list".to_string(),
            })
        }
    }

    fn allowed_skills(&self) -> BTreeSet<String> {
        self.allowed.clone()
    }
}

/// Cheap-to-clone facade returned by [`crate::OpenAgent::skills_policy`].
///
/// Wraps an `Arc<dyn SkillsPolicy>` so the same policy object can be shared
/// across multiple agent handles without lifetime headaches.
#[derive(Clone)]
pub struct SkillsPolicyHandle {
    inner: Arc<dyn SkillsPolicy>,
}

impl SkillsPolicyHandle {
    /// Wrap any [`SkillsPolicy`] implementation.
    pub fn new<P: SkillsPolicy + 'static>(policy: P) -> Self {
        Self {
            inner: Arc::new(policy),
        }
    }

    /// Wrap an already-`Arc`'d policy (useful when sharing one policy across
    /// many `OpenAgent` instances).
    pub fn from_arc(policy: Arc<dyn SkillsPolicy>) -> Self {
        Self { inner: policy }
    }

    /// Return `Ok(())` if the named skill may be invoked, otherwise an error.
    pub fn can_invoke(&self, skill: &str) -> Result<()> {
        self.inner.can_invoke(skill)
    }

    /// All skills currently allowed by the wrapped policy.
    pub fn allowed_skills(&self) -> BTreeSet<String> {
        self.inner.allowed_skills()
    }
}

impl Default for SkillsPolicyHandle {
    fn default() -> Self {
        Self::new(AllowListPolicy::new())
    }
}

impl std::fmt::Debug for SkillsPolicyHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SkillsPolicyHandle")
            .field("allowed_skills", &self.allowed_skills())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allow_list_policy_allows_registered_skills() {
        let policy = AllowListPolicy::with_skills(["frontend-design", "code-review"]);
        assert!(policy.can_invoke("frontend-design").is_ok());
        assert!(policy.can_invoke("code-review").is_ok());
    }

    #[test]
    fn allow_list_policy_denies_unknown_skills() {
        let policy = AllowListPolicy::with_skills(["frontend-design"]);
        let result = policy.can_invoke("rocket-science");
        assert!(matches!(result, Err(OpenAgentError::SkillDenied { .. })));
    }

    #[test]
    fn handle_passes_through_to_inner_policy() {
        let policy = AllowListPolicy::with_skills(["x"]);
        let handle = SkillsPolicyHandle::new(policy);
        assert!(handle.can_invoke("x").is_ok());
        assert!(handle.can_invoke("y").is_err());
        assert_eq!(handle.allowed_skills().len(), 1);
    }

    #[test]
    fn default_handle_denies_everything() {
        let handle = SkillsPolicyHandle::default();
        assert!(handle.can_invoke("anything").is_err());
        assert!(handle.allowed_skills().is_empty());
    }
}
