// Copyright (c) 2026 L1fe Labs, Inc. -- Apache-2.0 OR MIT
//
//! Unified error type for the OpenAgent OIDC bridge.

use thiserror::Error;

/// Result alias for OIDC bridge operations.
pub type Result<T> = std::result::Result<T, OidcBridgeError>;

/// Unified error type for OIDC bridge operations.
#[derive(Debug, Error)]
pub enum OidcBridgeError {
    /// OIDC discovery failed (network, parse, missing fields).
    #[error("oidc discovery error: {0}")]
    Discovery(String),

    /// JWKS fetch or parse error.
    #[error("jwks error: {0}")]
    Jwks(String),

    /// JWT validation failed (signature, claims, expiry).
    #[error("jwt validation error: {0}")]
    JwtValidation(String),

    /// No provider matched the JWT issuer claim.
    #[error("unknown issuer: {0}")]
    UnknownIssuer(String),

    /// DID mapping or derivation failed.
    #[error("identity mapping error: {0}")]
    Mapping(String),

    /// Token exchange error (RFC 8693).
    #[error("token exchange error: {0}")]
    Exchange(String),

    /// ACT-to-JWT signing error.
    #[error("signing error: {0}")]
    Signing(String),

    /// Configuration error (missing required fields, invalid values).
    #[error("configuration error: {0}")]
    Config(String),

    /// HTTP transport error.
    #[error("transport error: {0}")]
    Transport(String),

    /// Underlying OAS identity error.
    #[error("identity error: {0}")]
    Identity(String),

    /// JSON serialization/deserialization error.
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

impl OidcBridgeError {
    /// Construct a configuration error.
    pub fn config(msg: impl Into<String>) -> Self {
        Self::Config(msg.into())
    }

    /// Construct a discovery error.
    pub fn discovery(msg: impl Into<String>) -> Self {
        Self::Discovery(msg.into())
    }

    /// Construct a JWKS error.
    pub fn jwks(msg: impl Into<String>) -> Self {
        Self::Jwks(msg.into())
    }

    /// Construct a JWT validation error.
    pub fn jwt_validation(msg: impl Into<String>) -> Self {
        Self::JwtValidation(msg.into())
    }

    /// Construct a mapping error.
    pub fn mapping(msg: impl Into<String>) -> Self {
        Self::Mapping(msg.into())
    }

    /// Construct a transport error.
    pub fn transport(msg: impl Into<String>) -> Self {
        Self::Transport(msg.into())
    }
}

impl From<reqwest::Error> for OidcBridgeError {
    fn from(err: reqwest::Error) -> Self {
        Self::Transport(err.to_string())
    }
}

impl From<jsonwebtoken::errors::Error> for OidcBridgeError {
    fn from(err: jsonwebtoken::errors::Error) -> Self {
        Self::JwtValidation(err.to_string())
    }
}

impl From<oas_sdk::error::OasError> for OidcBridgeError {
    fn from(err: oas_sdk::error::OasError) -> Self {
        Self::Identity(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_error_displays_correctly() {
        let err = OidcBridgeError::config("missing issuer");
        assert!(err.to_string().contains("missing issuer"));
        assert!(matches!(err, OidcBridgeError::Config(_)));
    }

    #[test]
    fn discovery_error_displays_correctly() {
        let err = OidcBridgeError::discovery("timeout");
        assert!(err.to_string().contains("timeout"));
    }

    #[test]
    fn jwt_validation_error_displays_correctly() {
        let err = OidcBridgeError::jwt_validation("expired");
        assert!(err.to_string().contains("expired"));
    }

    #[test]
    fn json_error_converts() {
        let raw = serde_json::from_str::<serde_json::Value>("not json");
        let err: OidcBridgeError = raw.err().unwrap_or_else(|| unreachable!()).into();
        assert!(matches!(err, OidcBridgeError::Json(_)));
    }
}
