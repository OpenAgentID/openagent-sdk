//! Unified error type for the OpenAgent SDK.
//!
//! [`OpenAgentError`] flattens errors from the wrapped layers (OAS / Arsenal / AEGIS)
//! into a single type so SDK users only need one `?` and one `match`.

use thiserror::Error;

/// Result alias for OpenAgent SDK operations.
pub type Result<T> = std::result::Result<T, OpenAgentError>;

/// Unified error type for the OpenAgent SDK.
///
/// Wraps every error returned by the underlying OAS, Arsenal, and AEGIS layers
/// so consumers don't need to learn three different error taxonomies.
///
/// # Examples
///
/// ```
/// use openagent_sdk::errors::{OpenAgentError, Result};
///
/// fn example() -> Result<()> {
///     // Errors from any wrapped SDK convert via `?`.
///     Ok(())
/// }
/// ```
#[derive(Debug, Error)]
pub enum OpenAgentError {
    /// An error from the OAS identity layer.
    #[error("identity error: {0}")]
    Identity(#[from] oas_sdk::error::OasError),

    /// An error from the Arsenal capability/credential layer.
    #[cfg(feature = "arsenal")]
    #[error("credential error: {code:?}: {message}")]
    Credential {
        /// Numeric Arsenal error code.
        code: arsenal_core::error::ErrorCode,
        /// Human-readable description of what went wrong.
        message: String,
    },

    /// An error from the AEGIS verification layer.
    #[error("verification error: {0}")]
    Verification(String),

    /// An error from the AEGIS authentication layer.
    #[error("authentication error: {0}")]
    Authentication(String),

    /// An error from the AEGIS policy / authorization layer.
    #[error("authorization error: {0}")]
    Authorization(String),

    /// An error from the AEGIS delegation layer.
    #[error("delegation error: {0}")]
    Delegation(String),

    /// A skill policy violation reported by the [`crate::skills`] layer.
    #[error("skill denied: {skill}: {reason}")]
    SkillDenied {
        /// Name of the skill that was denied.
        skill: String,
        /// Reason the skill is denied.
        reason: String,
    },

    /// A configuration error in the SDK itself (missing parent, invalid scope, etc.).
    #[error("configuration error: {0}")]
    Config(String),

    /// An error in the underlying HTTP transport when proxying credentials.
    #[error("transport error: {0}")]
    Transport(String),

    /// A JSON serialization error from any of the layers.
    #[error("serialization error: {0}")]
    Json(#[from] serde_json::Error),
}

impl OpenAgentError {
    /// Construct a configuration error from any displayable value.
    pub fn config(msg: impl Into<String>) -> Self {
        Self::Config(msg.into())
    }

    /// Construct a transport error from any displayable value.
    pub fn transport(msg: impl Into<String>) -> Self {
        Self::Transport(msg.into())
    }
}

#[cfg(feature = "arsenal")]
impl From<arsenal_core::error::ArsenalError> for OpenAgentError {
    fn from(err: arsenal_core::error::ArsenalError) -> Self {
        Self::Credential {
            code: err.code(),
            message: err.message().to_string(),
        }
    }
}

#[cfg(feature = "aegis")]
impl From<openagent_aegis_core::VerificationError> for OpenAgentError {
    fn from(err: openagent_aegis_core::VerificationError) -> Self {
        Self::Verification(err.to_string())
    }
}

#[cfg(feature = "aegis")]
impl From<openagent_aegis_core::AuthError> for OpenAgentError {
    fn from(err: openagent_aegis_core::AuthError) -> Self {
        Self::Authentication(err.to_string())
    }
}

#[cfg(feature = "aegis")]
impl From<openagent_aegis_core::PolicyError> for OpenAgentError {
    fn from(err: openagent_aegis_core::PolicyError) -> Self {
        Self::Authorization(err.to_string())
    }
}

#[cfg(feature = "aegis")]
impl From<openagent_aegis_core::DelegationError> for OpenAgentError {
    fn from(err: openagent_aegis_core::DelegationError) -> Self {
        Self::Delegation(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_helper_constructs_config_variant() {
        let err = OpenAgentError::config("missing parent DID");
        assert!(matches!(err, OpenAgentError::Config(_)));
        assert!(err.to_string().contains("missing parent DID"));
    }

    #[test]
    fn skill_denied_message_includes_name_and_reason() {
        let err = OpenAgentError::SkillDenied {
            skill: "frontend-design".into(),
            reason: "not granted to this agent".into(),
        };
        let s = err.to_string();
        assert!(s.contains("frontend-design"));
        assert!(s.contains("not granted"));
    }

    #[test]
    fn oas_error_converts() {
        let oas_err = oas_sdk::error::OasError::Sdk {
            reason: "boom".into(),
        };
        let err: OpenAgentError = oas_err.into();
        assert!(matches!(err, OpenAgentError::Identity(_)));
    }
}
