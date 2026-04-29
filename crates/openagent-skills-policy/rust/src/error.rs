//! Error types for the skills policy engine.
//!
//! All fallible operations return [`Result<T, SkillsPolicyError>`]. Errors are
//! typed to enable fine-grained handling at the call site (e.g., a denied
//! invocation vs a rate-limit violation vs a schema mismatch).

use std::path::PathBuf;

use thiserror::Error;

/// Result alias for the skills policy engine.
pub type Result<T> = std::result::Result<T, SkillsPolicyError>;

/// All errors produced by the skills policy engine.
#[derive(Debug, Error)]
pub enum SkillsPolicyError {
    /// The policy YAML failed to parse or validate.
    #[error("invalid policy document: {0}")]
    InvalidPolicy(String),

    /// Failed to read a file from disk.
    #[error("failed to read {path}: {source}")]
    Io {
        /// The path we tried to read.
        path: PathBuf,
        /// The underlying I/O error.
        #[source]
        source: std::io::Error,
    },

    /// The skill name is not allowed under the current policy.
    ///
    /// This covers both explicit `deny_list` hits and the implicit deny from
    /// `default.allow: false` when the skill is not in any allow list.
    #[error("skill `{skill}` is not allowed by policy: {reason}")]
    NotAllowed {
        /// The skill name that was rejected.
        skill: String,
        /// Why it was rejected (e.g. "in deny_list", "no matching rule").
        reason: String,
    },

    /// The invocation exceeded the configured rate limit for this skill.
    #[error("rate limit exceeded for skill `{skill}`: {used}/{max} in {window_secs}s window")]
    RateLimitExceeded {
        /// The skill name.
        skill: String,
        /// How many invocations were observed in the window.
        used: u64,
        /// The maximum allowed in the window.
        max: u64,
        /// The window length in seconds.
        window_secs: u64,
    },

    /// Arguments did not match the declared JSON Schema.
    #[error("argument constraints violated for skill `{skill}`: {details}")]
    ArgumentConstraint {
        /// The skill name.
        skill: String,
        /// Human-readable detail about the violation.
        details: String,
    },

    /// The current time is outside any permitted time window.
    #[error("skill `{skill}` cannot be invoked at this time: outside allowed time windows")]
    OutsideTimeWindow {
        /// The skill name.
        skill: String,
    },

    /// Human-in-the-loop consent is required and has not been granted.
    #[error("skill `{skill}` requires consent but none was provided")]
    ConsentRequired {
        /// The skill name.
        skill: String,
    },

    /// The SKILLS.md file could not be parsed.
    #[error("failed to parse SKILLS.md: {0}")]
    InvalidSkillsMarkdown(String),
}

impl SkillsPolicyError {
    /// Convenience constructor for a "not allowed" denial.
    pub(crate) fn not_allowed(skill: impl Into<String>, reason: impl Into<String>) -> Self {
        Self::NotAllowed {
            skill: skill.into(),
            reason: reason.into(),
        }
    }
}
