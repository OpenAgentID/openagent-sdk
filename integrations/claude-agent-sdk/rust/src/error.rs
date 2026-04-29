//! Error types for the plugin.

use thiserror::Error;

/// Result alias used throughout the crate.
pub type Result<T> = std::result::Result<T, Error>;

/// All errors produced by `openagent-claude-agent`.
#[derive(Debug, Error)]
pub enum Error {
    /// Configuration was invalid at construction time.
    #[error("invalid configuration: {0}")]
    Config(String),

    /// A hook was invoked before the session was started.
    #[error("hook called before session_start")]
    NoActiveSession,

    /// A tool call was rejected because the agent lacks the required scope.
    #[error("tool denied: {tool} (required scope: {required_scope}; reason: {reason})")]
    ToolDenied {
        /// Tool name.
        tool: String,
        /// Scope that was checked.
        required_scope: String,
        /// Human-readable reason.
        reason: String,
    },

    /// A skill invocation was rejected by the skills policy.
    #[error("skill denied: {skill} (reason: {reason})")]
    SkillDenied {
        /// Skill name.
        skill: String,
        /// Reason for denial.
        reason: String,
    },

    /// Identity signing failed.
    #[error("signing failed: {0}")]
    Sign(String),

    /// Audit chain verification failed.
    #[error("audit chain broken at index {index}")]
    AuditBroken {
        /// Index in the chain where verification failed.
        index: usize,
    },

    /// JSON (de)serialisation failure.
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    /// I/O failure (sink, file, etc).
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}
