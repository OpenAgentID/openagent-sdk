// Copyright (c) 2026 L1fe Labs, Inc. -- Apache-2.0 OR MIT
//
//! RFC 8693 Token Exchange implementation.
//!
//! Implements the OAuth 2.0 Token Exchange grant type, enabling a human JWT
//! to be exchanged for an Arsenal ACT through the OIDC bridge.

use serde::{Deserialize, Serialize};

use crate::error::{OidcBridgeError, Result};

/// Standard grant type for RFC 8693 Token Exchange.
pub const GRANT_TYPE_TOKEN_EXCHANGE: &str =
    "urn:ietf:params:oauth:grant-type:token-exchange";

/// Standard token type for JWT subject tokens.
pub const TOKEN_TYPE_JWT: &str = "urn:ietf:params:oauth:token-type:jwt";

/// Custom token type for OpenAgent ACTs.
pub const TOKEN_TYPE_ACT: &str = "urn:openagent:token-type:act";

/// Standard token type for access tokens.
pub const TOKEN_TYPE_ACCESS: &str = "urn:ietf:params:oauth:token-type:access_token";

/// Token exchange request (RFC 8693 Section 2.1).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenExchangeRequest {
    /// Must be `urn:ietf:params:oauth:grant-type:token-exchange`.
    pub grant_type: String,
    /// The subject token (typically a human JWT).
    pub subject_token: String,
    /// Type of the subject token.
    pub subject_token_type: String,
    /// Desired type of the issued token.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requested_token_type: Option<String>,
    /// Requested scopes for the exchanged token.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    /// Target audience for the exchanged token.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audience: Option<String>,
    /// Logical name of the target service.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource: Option<String>,
    /// Actor token (for delegation / impersonation scenarios).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_token: Option<String>,
    /// Type of the actor token.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_token_type: Option<String>,
}

/// Token exchange response (RFC 8693 Section 2.2).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenExchangeResponse {
    /// The issued token.
    pub access_token: String,
    /// Type of the issued token.
    pub issued_token_type: String,
    /// Token type (always `"Bearer"` for our use case).
    pub token_type: String,
    /// Lifetime of the token in seconds.
    pub expires_in: i64,
    /// Scope of the issued token.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
}

impl TokenExchangeRequest {
    /// Create a new token exchange request for exchanging a human JWT for an ACT.
    pub fn new_jwt_to_act(subject_token: impl Into<String>, scopes: &[&str]) -> Self {
        Self {
            grant_type: GRANT_TYPE_TOKEN_EXCHANGE.to_string(),
            subject_token: subject_token.into(),
            subject_token_type: TOKEN_TYPE_JWT.to_string(),
            requested_token_type: Some(TOKEN_TYPE_ACT.to_string()),
            scope: if scopes.is_empty() {
                None
            } else {
                Some(scopes.join(" "))
            },
            audience: None,
            resource: None,
            actor_token: None,
            actor_token_type: None,
        }
    }

    /// Validate the request structure.
    pub fn validate(&self) -> Result<()> {
        if self.grant_type != GRANT_TYPE_TOKEN_EXCHANGE {
            return Err(OidcBridgeError::Exchange(format!(
                "invalid grant_type: expected '{}', got '{}'",
                GRANT_TYPE_TOKEN_EXCHANGE, self.grant_type
            )));
        }

        if self.subject_token.is_empty() {
            return Err(OidcBridgeError::Exchange(
                "subject_token cannot be empty".into(),
            ));
        }

        if self.subject_token_type.is_empty() {
            return Err(OidcBridgeError::Exchange(
                "subject_token_type cannot be empty".into(),
            ));
        }

        // Validate known token types.
        let valid_subject_types = [TOKEN_TYPE_JWT, TOKEN_TYPE_ACCESS];
        if !valid_subject_types.contains(&self.subject_token_type.as_str()) {
            return Err(OidcBridgeError::Exchange(format!(
                "unsupported subject_token_type: '{}'",
                self.subject_token_type
            )));
        }

        if let Some(ref requested) = self.requested_token_type {
            let valid_requested_types = [TOKEN_TYPE_ACT, TOKEN_TYPE_JWT, TOKEN_TYPE_ACCESS];
            if !valid_requested_types.contains(&requested.as_str()) {
                return Err(OidcBridgeError::Exchange(format!(
                    "unsupported requested_token_type: '{requested}'"
                )));
            }
        }

        Ok(())
    }

    /// Parse requested scopes into a vector.
    pub fn requested_scopes(&self) -> Vec<String> {
        self.scope
            .as_ref()
            .map(|s| s.split_whitespace().map(|s| s.to_string()).collect())
            .unwrap_or_default()
    }
}

impl TokenExchangeResponse {
    /// Build a successful token exchange response.
    pub fn success(
        access_token: impl Into<String>,
        issued_token_type: impl Into<String>,
        expires_in: i64,
        scope: Option<String>,
    ) -> Self {
        Self {
            access_token: access_token.into(),
            issued_token_type: issued_token_type.into(),
            token_type: "Bearer".to_string(),
            expires_in,
            scope,
        }
    }
}

/// RFC 8693 error response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenExchangeError {
    /// Error code (per RFC 6749 Section 5.2).
    pub error: String,
    /// Human-readable error description.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_description: Option<String>,
}

impl TokenExchangeError {
    /// Create an `invalid_request` error.
    pub fn invalid_request(description: impl Into<String>) -> Self {
        Self {
            error: "invalid_request".into(),
            error_description: Some(description.into()),
        }
    }

    /// Create an `invalid_grant` error (e.g., JWT validation failed).
    pub fn invalid_grant(description: impl Into<String>) -> Self {
        Self {
            error: "invalid_grant".into(),
            error_description: Some(description.into()),
        }
    }

    /// Create an `unsupported_token_type` error.
    pub fn unsupported_token_type(description: impl Into<String>) -> Self {
        Self {
            error: "unsupported_token_type".into(),
            error_description: Some(description.into()),
        }
    }

    /// Create an `invalid_target` error.
    pub fn invalid_target(description: impl Into<String>) -> Self {
        Self {
            error: "invalid_target".into(),
            error_description: Some(description.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_jwt_to_act_sets_correct_grant_type() {
        let req = TokenExchangeRequest::new_jwt_to_act("eyJ...", &["openai:chat"]);
        assert_eq!(req.grant_type, GRANT_TYPE_TOKEN_EXCHANGE);
        assert_eq!(req.subject_token_type, TOKEN_TYPE_JWT);
        assert_eq!(
            req.requested_token_type.as_deref(),
            Some(TOKEN_TYPE_ACT)
        );
        assert_eq!(req.scope.as_deref(), Some("openai:chat"));
    }

    #[test]
    fn new_jwt_to_act_no_scopes() {
        let req = TokenExchangeRequest::new_jwt_to_act("eyJ...", &[]);
        assert!(req.scope.is_none());
    }

    #[test]
    fn validate_succeeds_on_valid_request() {
        let req = TokenExchangeRequest::new_jwt_to_act("eyJ...", &["openai:chat"]);
        assert!(req.validate().is_ok());
    }

    #[test]
    fn validate_fails_on_wrong_grant_type() {
        let mut req = TokenExchangeRequest::new_jwt_to_act("eyJ...", &[]);
        req.grant_type = "bad_grant".into();
        assert!(req.validate().is_err());
    }

    #[test]
    fn validate_fails_on_empty_subject_token() {
        let mut req = TokenExchangeRequest::new_jwt_to_act("eyJ...", &[]);
        req.subject_token = String::new();
        assert!(req.validate().is_err());
    }

    #[test]
    fn validate_fails_on_unsupported_subject_type() {
        let mut req = TokenExchangeRequest::new_jwt_to_act("eyJ...", &[]);
        req.subject_token_type = "urn:custom:type".into();
        assert!(req.validate().is_err());
    }

    #[test]
    fn validate_fails_on_unsupported_requested_type() {
        let mut req = TokenExchangeRequest::new_jwt_to_act("eyJ...", &[]);
        req.requested_token_type = Some("urn:custom:bad".into());
        assert!(req.validate().is_err());
    }

    #[test]
    fn requested_scopes_parses_space_delimited() {
        let req = TokenExchangeRequest::new_jwt_to_act(
            "eyJ...",
            &["openai:chat", "github:repo:read"],
        );
        let scopes = req.requested_scopes();
        assert_eq!(scopes, vec!["openai:chat", "github:repo:read"]);
    }

    #[test]
    fn requested_scopes_empty_when_none() {
        let req = TokenExchangeRequest::new_jwt_to_act("eyJ...", &[]);
        assert!(req.requested_scopes().is_empty());
    }

    #[test]
    fn success_response_builds_correctly() {
        let resp = TokenExchangeResponse::success(
            "token-value",
            TOKEN_TYPE_ACT,
            3600,
            Some("openai:chat".into()),
        );
        assert_eq!(resp.access_token, "token-value");
        assert_eq!(resp.token_type, "Bearer");
        assert_eq!(resp.expires_in, 3600);
        assert_eq!(resp.scope.as_deref(), Some("openai:chat"));
    }

    #[test]
    fn error_responses_set_correct_codes() {
        let e1 = TokenExchangeError::invalid_request("bad request");
        assert_eq!(e1.error, "invalid_request");

        let e2 = TokenExchangeError::invalid_grant("bad jwt");
        assert_eq!(e2.error, "invalid_grant");

        let e3 = TokenExchangeError::unsupported_token_type("unknown");
        assert_eq!(e3.error, "unsupported_token_type");

        let e4 = TokenExchangeError::invalid_target("no target");
        assert_eq!(e4.error, "invalid_target");
    }

    #[test]
    fn token_exchange_request_serializes() {
        let req = TokenExchangeRequest::new_jwt_to_act("eyJ...", &["openai:chat"]);
        let json = serde_json::to_string(&req).unwrap_or_else(|e| unreachable!("{e}"));
        assert!(json.contains("token-exchange"));
        assert!(json.contains("openai:chat"));
    }

    #[test]
    fn token_exchange_response_serializes() {
        let resp = TokenExchangeResponse::success("tok", TOKEN_TYPE_ACT, 300, None);
        let json = serde_json::to_string(&resp).unwrap_or_else(|e| unreachable!("{e}"));
        assert!(json.contains("Bearer"));
        assert!(json.contains("300"));
    }
}
