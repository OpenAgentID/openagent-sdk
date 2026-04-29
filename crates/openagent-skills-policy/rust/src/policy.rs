//! Policy document types.
//!
//! A [`SkillsPolicyDoc`] is the deserialized shape of a policy YAML file. It
//! carries an agent binding (`agent: did:...`), a per-skill rules map, and a
//! default rule used when no per-skill entry matches.
//!
//! The engine validates the document up-front so that `SkillsPolicy::from_yaml`
//! fails fast on authoring mistakes rather than surfacing them at invocation
//! time.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::did::Did;
use crate::error::{Result, SkillsPolicyError};

/// Maximum number of skill rules in a single policy document.
///
/// Mirrors Arsenal's `MAX_RULES_PER_POLICY` to keep the two in lockstep.
pub const MAX_SKILL_RULES: usize = 256;

/// Current policy schema version.
pub const CURRENT_VERSION: u32 = 1;

/// How much detail to record for each invocation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AuditLevel {
    /// No audit event produced.
    None,
    /// Record only the skill name, DID, and a hash of the arguments.
    #[default]
    Hash,
    /// Record the full arguments JSON in the receipt.
    Full,
}

/// A rate limit for a single skill.
///
/// The window is expressed as a human-friendly string (`1s`, `30m`, `1h`,
/// `24h`) which the engine parses at load time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimit {
    /// Window length as a string (parsed to seconds at load time).
    pub window: String,
    /// Maximum invocations allowed within a single window.
    pub max: u64,
}

/// A time window during which a skill may be invoked.
///
/// Hours are interpreted in UTC. `start_hour` may be greater than `end_hour`
/// to express an overnight window (e.g. 22..6).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeWindow {
    /// Inclusive start hour in UTC (0..=23).
    pub start_hour: u8,
    /// Exclusive end hour in UTC (0..=24). 24 means midnight.
    pub end_hour: u8,
    /// Optional weekday filter (0=Sunday..6=Saturday). Empty = all days.
    #[serde(default)]
    pub weekdays: Vec<u8>,
}

/// Per-skill policy rule.
///
/// Every field is optional; the engine applies only what is present.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillRule {
    /// Whether the agent may invoke this skill at all.
    ///
    /// Defaults to `true` when the skill appears in the policy map. Use
    /// `allow: false` to explicitly deny while still documenting the rule.
    #[serde(default = "default_allow")]
    pub allow: bool,

    /// Rate limit applied to this skill.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rate_limit: Option<RateLimit>,

    /// JSON Schema that invocation arguments must satisfy.
    ///
    /// Stored as a raw `serde_json::Value` to avoid premature compilation;
    /// the engine compiles and caches it at load time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arg_constraints: Option<serde_json::Value>,

    /// Time windows during which the skill may be invoked. Empty = always.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub time_windows: Vec<TimeWindow>,

    /// If `true`, the caller must supply a consent token alongside the
    /// invocation context.
    #[serde(default)]
    pub require_consent: bool,

    /// How much invocation detail to record in the audit chain.
    #[serde(default)]
    pub audit_level: AuditLevel,
}

fn default_allow() -> bool {
    true
}

impl Default for SkillRule {
    fn default() -> Self {
        Self {
            allow: true,
            rate_limit: None,
            arg_constraints: None,
            time_windows: vec![],
            require_consent: false,
            audit_level: AuditLevel::default(),
        }
    }
}

/// Default rule applied when a skill has no per-skill entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DefaultRule {
    /// Whether unknown skills are allowed by default.
    #[serde(default)]
    pub allow: bool,
    /// Default audit level for unknown skills.
    #[serde(default)]
    pub audit_level: AuditLevel,
}

impl Default for DefaultRule {
    fn default() -> Self {
        Self {
            allow: false,
            audit_level: AuditLevel::default(),
        }
    }
}

/// A skills policy document, as loaded from YAML.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillsPolicyDoc {
    /// Schema version. Must equal [`CURRENT_VERSION`].
    pub version: u32,

    /// DID of the agent this policy applies to.
    pub agent: Did,

    /// Per-skill rules keyed by skill name.
    #[serde(default)]
    pub skills: BTreeMap<String, SkillRule>,

    /// Default rule applied when a skill has no entry in `skills`.
    #[serde(default)]
    pub default: DefaultRule,

    /// Optional human-friendly description.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

impl SkillsPolicyDoc {
    /// Validate all structural invariants. Called automatically by
    /// `SkillsPolicy::from_yaml`.
    pub(crate) fn validate(&self) -> Result<()> {
        if self.version != CURRENT_VERSION {
            return Err(SkillsPolicyError::InvalidPolicy(format!(
                "unsupported policy version {}; expected {}",
                self.version, CURRENT_VERSION
            )));
        }

        if self.skills.len() > MAX_SKILL_RULES {
            return Err(SkillsPolicyError::InvalidPolicy(format!(
                "policy has {} rules; maximum is {}",
                self.skills.len(),
                MAX_SKILL_RULES
            )));
        }

        for (name, rule) in &self.skills {
            if name.is_empty() {
                return Err(SkillsPolicyError::InvalidPolicy(
                    "skill names cannot be empty".to_string(),
                ));
            }
            if name.len() > 256 {
                return Err(SkillsPolicyError::InvalidPolicy(format!(
                    "skill name `{name}` exceeds 256 characters"
                )));
            }
            validate_rule(name, rule)?;
        }

        Ok(())
    }
}

fn validate_rule(name: &str, rule: &SkillRule) -> Result<()> {
    if let Some(ref rl) = rule.rate_limit {
        if rl.max == 0 {
            return Err(SkillsPolicyError::InvalidPolicy(format!(
                "skill `{name}` rate_limit.max must be > 0"
            )));
        }
        crate::duration::parse_duration(&rl.window).map_err(|e| {
            SkillsPolicyError::InvalidPolicy(format!(
                "skill `{name}` has invalid rate_limit.window `{}`: {e}",
                rl.window
            ))
        })?;
    }
    for (i, tw) in rule.time_windows.iter().enumerate() {
        if tw.start_hour > 23 {
            return Err(SkillsPolicyError::InvalidPolicy(format!(
                "skill `{name}` time_windows[{i}].start_hour must be 0..=23"
            )));
        }
        if tw.end_hour > 24 {
            return Err(SkillsPolicyError::InvalidPolicy(format!(
                "skill `{name}` time_windows[{i}].end_hour must be 0..=24"
            )));
        }
        for w in &tw.weekdays {
            if *w > 6 {
                return Err(SkillsPolicyError::InvalidPolicy(format!(
                    "skill `{name}` time_windows[{i}].weekdays must be 0..=6"
                )));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_rule_is_deny() {
        let r = DefaultRule::default();
        assert!(!r.allow);
    }

    #[test]
    fn skill_rule_allows_by_default() {
        let r = SkillRule::default();
        assert!(r.allow);
        assert!(r.rate_limit.is_none());
        assert!(!r.require_consent);
    }

    #[test]
    fn validate_rejects_bad_hours() {
        let mut doc = SkillsPolicyDoc {
            version: CURRENT_VERSION,
            agent: Did::new("did:oas:l1fe:agent:a").expect("did"),
            skills: BTreeMap::new(),
            default: DefaultRule::default(),
            description: None,
        };
        doc.skills.insert(
            "s".to_string(),
            SkillRule {
                time_windows: vec![TimeWindow {
                    start_hour: 25,
                    end_hour: 26,
                    weekdays: vec![],
                }],
                ..Default::default()
            },
        );
        assert!(doc.validate().is_err());
    }

    #[test]
    fn validate_rejects_zero_rate_max() {
        let mut doc = SkillsPolicyDoc {
            version: CURRENT_VERSION,
            agent: Did::new("did:oas:l1fe:agent:a").expect("did"),
            skills: BTreeMap::new(),
            default: DefaultRule::default(),
            description: None,
        };
        doc.skills.insert(
            "s".to_string(),
            SkillRule {
                rate_limit: Some(RateLimit {
                    window: "1h".to_string(),
                    max: 0,
                }),
                ..Default::default()
            },
        );
        assert!(doc.validate().is_err());
    }
}
