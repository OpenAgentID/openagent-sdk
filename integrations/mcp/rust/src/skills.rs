//! Skills policy support.
//!
//! MCP tools and SKILLS.md entries describe the same thing — a
//! capability an agent can invoke. When an MCP server exposes a
//! skill-like tool (default matchers below), the middleware consults a
//! [`SkillsPolicy`] before allowing the call.
//!
//! Production deployments will typically back the policy with a
//! file-watcher that re-reads `SKILLS.md` on change, an HTTP fetch from
//! a central registry, or an AEGIS policy bundle. The
//! [`InMemorySkillsStore`] shipped here is a small reference
//! implementation suitable for tests.

use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Arc;

use crate::types::VerifiedIdentity;

/// Tool name prefixes the middleware treats as skill-like by default.
pub const DEFAULT_SKILL_TOOL_NAMES: &[&str] = &[
    "invoke_skill",
    "run_skill",
    "execute_skill",
    "skill.invoke",
    "skill.run",
];

/// A single rule mapping a skill name to the DIDs allowed to invoke it.
/// `dids: None` means "any verified caller".
#[derive(Debug, Clone)]
pub struct SkillsRule {
    /// The skill name as it appears in SKILLS.md.
    pub skill_name: String,
    /// DIDs allowed to invoke this skill, or `None` for any.
    pub dids: Option<Vec<String>>,
    /// Optional human-readable reason returned on denial.
    pub reason: Option<String>,
}

/// Decision returned by [`SkillsPolicy::decide`].
#[derive(Debug, Clone)]
pub struct SkillsPolicyDecision {
    /// Whether to allow the call.
    pub allow: bool,
    /// Optional reason — set on denial.
    pub reason: Option<String>,
}

impl SkillsPolicyDecision {
    /// Build an allow decision.
    pub fn allow() -> Self {
        Self {
            allow: true,
            reason: None,
        }
    }

    /// Build a deny decision with a reason.
    pub fn deny(reason: impl Into<String>) -> Self {
        Self {
            allow: false,
            reason: Some(reason.into()),
        }
    }
}

/// Storage backend for skills rules. Implementations may be in-memory,
/// file-backed, or fetched from a remote service.
#[async_trait]
pub trait SkillsStore: Send + Sync {
    /// Look up the rule for a given skill name. Return `None` if no
    /// rule is configured.
    async fn lookup(&self, skill_name: &str) -> Option<SkillsRule>;
}

/// In-memory store. Construct from a list of rules and pass to
/// [`SkillsPolicy::new`].
#[derive(Debug, Default)]
pub struct InMemorySkillsStore {
    rules: HashMap<String, SkillsRule>,
}

impl InMemorySkillsStore {
    /// Build a store from a list of rules.
    pub fn new(rules: impl IntoIterator<Item = SkillsRule>) -> Self {
        let mut map = HashMap::new();
        for rule in rules {
            map.insert(rule.skill_name.clone(), rule);
        }
        Self { rules: map }
    }

    /// Return a NEW store with the given rule applied (immutable
    /// update — the original is left untouched).
    pub fn with_rule(&self, rule: SkillsRule) -> Self {
        let mut map = self.rules.clone();
        map.insert(rule.skill_name.clone(), rule);
        Self { rules: map }
    }
}

#[async_trait]
impl SkillsStore for InMemorySkillsStore {
    async fn lookup(&self, skill_name: &str) -> Option<SkillsRule> {
        self.rules.get(skill_name).cloned()
    }
}

/// Configurable matcher: returns the skill name if a tool call should
/// be checked against the skills policy, or `None` to skip the check.
pub type SkillNameExtractor = Arc<dyn Fn(&str, &serde_json::Value) -> Option<String> + Send + Sync>;

/// The skills policy hook.
///
/// Construct via [`SkillsPolicy::new`]. The policy decides per call
/// whether the tool is skill-like, looks up a rule from the configured
/// store, and matches the verified DID against the rule.
#[derive(Clone)]
pub struct SkillsPolicy {
    store: Arc<dyn SkillsStore>,
    extractor: SkillNameExtractor,
}

impl std::fmt::Debug for SkillsPolicy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SkillsPolicy").finish_non_exhaustive()
    }
}

impl SkillsPolicy {
    /// Build a policy from a store, using the default skill-name
    /// extractor that:
    ///
    ///   * Treats the tool as a skill if its name is in
    ///     [`DEFAULT_SKILL_TOOL_NAMES`].
    ///   * Reads `args["skill"]` or `args["skillName"]` for the skill
    ///     name.
    pub fn new(store: Arc<dyn SkillsStore>) -> Self {
        Self {
            store,
            extractor: Arc::new(default_skill_name_extractor),
        }
    }

    /// Override the extractor with a custom matcher.
    pub fn with_extractor(mut self, extractor: SkillNameExtractor) -> Self {
        self.extractor = extractor;
        self
    }

    /// Decide whether a call should be allowed.
    pub async fn decide(
        &self,
        tool_name: &str,
        args: &serde_json::Value,
        identity: &VerifiedIdentity,
    ) -> SkillsPolicyDecision {
        let Some(skill_name) = (self.extractor)(tool_name, args) else {
            return SkillsPolicyDecision::allow();
        };
        if skill_name.is_empty() {
            return SkillsPolicyDecision::deny(format!(
                "Skill tool '{tool_name}' invoked without a skill name"
            ));
        }
        let rule = self.store.lookup(&skill_name).await;
        let Some(rule) = rule else {
            return SkillsPolicyDecision::deny(format!(
                "No policy entry for skill '{skill_name}'"
            ));
        };
        match &rule.dids {
            None => SkillsPolicyDecision::allow(),
            Some(dids) if dids.contains(&identity.did) => SkillsPolicyDecision::allow(),
            Some(_) => SkillsPolicyDecision::deny(rule.reason.clone().unwrap_or_else(|| {
                format!(
                    "DID '{}' is not authorized for skill '{}'",
                    identity.did, skill_name
                )
            })),
        }
    }
}

fn default_skill_name_extractor(tool_name: &str, args: &serde_json::Value) -> Option<String> {
    if !DEFAULT_SKILL_TOOL_NAMES.contains(&tool_name) {
        return None;
    }
    if let Some(name) = args.get("skill").and_then(|v| v.as_str()) {
        if !name.is_empty() {
            return Some(name.to_owned());
        }
    }
    if let Some(name) = args.get("skillName").and_then(|v| v.as_str()) {
        if !name.is_empty() {
            return Some(name.to_owned());
        }
    }
    Some(String::new()) // skill tool with no name — denied below
}
