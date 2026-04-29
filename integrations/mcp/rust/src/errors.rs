//! Error types for `openagent-mcp`.
//!
//! Errors are mapped onto JSON-RPC server-error codes in the
//! `-32000..=-32099` range so they round-trip cleanly through the MCP
//! wire format. Use [`McpAuthError::code`] to get the integer code for
//! serialization, and [`McpAuthError::to_json_rpc`] to render the
//! complete error envelope.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// JSON-RPC + MCP error codes used by the middleware.
///
/// All entries lie inside the `-32000..=-32099` server-error range
/// reserved by the JSON-RPC spec for application use.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(i32)]
pub enum McpErrorCode {
    /// Generic server error.
    ServerError = -32000,
    /// Identity verification failed (no envelope, bad proof, etc.).
    AuthenticationFailed = -32001,
    /// Caller does not hold the required scopes.
    AuthorizationDenied = -32002,
    /// Skills policy hook returned `allow: false`.
    SkillsPolicyDenied = -32003,
    /// Method or tool not found.
    MethodNotFound = -32601,
    /// Invalid parameters.
    InvalidParams = -32602,
    /// Internal error.
    InternalError = -32603,
}

impl McpErrorCode {
    /// Return the underlying integer code.
    pub fn as_i32(self) -> i32 {
        self as i32
    }
}

/// All errors produced by the middleware. Subclasses set a default
/// [`McpErrorCode`] that maps to a JSON-RPC error code.
#[derive(Debug, Error)]
pub enum McpAuthError {
    /// `_meta.openagent.identity` was absent on a tool call.
    #[error("Tool '{tool}' requires an OpenAgent identity in _meta.openagent.identity")]
    MissingIdentity {
        /// The tool name the call targeted.
        tool: String,
    },

    /// The verifier rejected the supplied envelope.
    #[error("Identity verification failed for tool '{tool}': {reason}")]
    VerificationFailed {
        /// The tool name.
        tool: String,
        /// Human-readable reason from the verifier.
        reason: String,
    },

    /// The verified identity does not hold the required scopes.
    #[error(
        "Tool '{tool}' requires scopes [{required}], caller holds [{held}]"
    )]
    AuthorizationDenied {
        /// The tool name.
        tool: String,
        /// Required scopes, comma-joined for display.
        required: String,
        /// Held scopes, comma-joined for display.
        held: String,
    },

    /// The skills policy denied the call.
    #[error("Skills policy denied tool '{tool}'{}", reason.as_ref().map(|r| format!(": {r}")).unwrap_or_default())]
    SkillsPolicyDenied {
        /// The tool name.
        tool: String,
        /// Optional reason from the policy hook.
        reason: Option<String>,
    },

    /// Tool body or downstream component returned an error.
    #[error("Tool '{tool}' failed: {source}")]
    ToolFailed {
        /// The tool name.
        tool: String,
        /// Underlying error type-erased to a string.
        source: Box<dyn std::error::Error + Send + Sync>,
    },

    /// Generic internal error. Use sparingly — prefer one of the variants
    /// above when the failure category is known.
    #[error("Internal middleware error: {0}")]
    Internal(String),
}

impl McpAuthError {
    /// Map the error to a JSON-RPC error code.
    pub fn code(&self) -> McpErrorCode {
        match self {
            Self::MissingIdentity { .. } => McpErrorCode::AuthenticationFailed,
            Self::VerificationFailed { .. } => McpErrorCode::AuthenticationFailed,
            Self::AuthorizationDenied { .. } => McpErrorCode::AuthorizationDenied,
            Self::SkillsPolicyDenied { .. } => McpErrorCode::SkillsPolicyDenied,
            Self::ToolFailed { .. } => McpErrorCode::InternalError,
            Self::Internal(_) => McpErrorCode::InternalError,
        }
    }

    /// Render the error as a JSON-RPC error envelope.
    pub fn to_json_rpc(&self) -> JsonRpcError {
        JsonRpcError {
            code: self.code().as_i32(),
            message: self.to_string(),
            data: self.error_data(),
        }
    }

    fn error_data(&self) -> Option<serde_json::Value> {
        match self {
            Self::MissingIdentity { tool } => Some(serde_json::json!({ "tool": tool })),
            Self::VerificationFailed { tool, reason } => {
                Some(serde_json::json!({ "tool": tool, "reason": reason }))
            }
            Self::AuthorizationDenied {
                tool,
                required,
                held,
            } => Some(serde_json::json!({
                "tool": tool,
                "required_scopes": required.split(", ").collect::<Vec<_>>(),
                "held_scopes": held.split(", ").collect::<Vec<_>>(),
            })),
            Self::SkillsPolicyDenied { tool, reason } => {
                Some(serde_json::json!({ "tool": tool, "reason": reason }))
            }
            Self::ToolFailed { tool, .. } => Some(serde_json::json!({ "tool": tool })),
            Self::Internal(_) => None,
        }
    }
}

/// Serializable JSON-RPC error envelope.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    /// JSON-RPC error code.
    pub code: i32,
    /// Human-readable message.
    pub message: String,
    /// Optional structured data payload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}
