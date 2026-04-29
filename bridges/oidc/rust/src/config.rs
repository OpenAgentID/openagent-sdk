// Copyright (c) 2026 L1fe Labs, Inc. -- Apache-2.0 OR MIT
//
//! Configuration types for the OIDC bridge.
//!
//! Supports single-provider and multi-provider setups. The bridge auto-detects
//! the correct provider from the JWT `iss` claim at validation time.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::error::{OidcBridgeError, Result};

/// Configuration for a single OIDC provider (Okta, Auth0, Azure AD, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    /// Human-readable provider name (e.g. `"okta"`, `"azure"`).
    pub name: String,
    /// OIDC issuer URL (must match the `iss` claim in JWTs from this provider).
    pub issuer: String,
    /// Expected `aud` claim. Omit to skip audience validation (not recommended).
    pub audience: Option<String>,
    /// Override for the JWKS URI. If `None`, auto-discovered from
    /// `{issuer}/.well-known/openid-configuration`.
    pub jwks_url: Option<String>,
    /// Which JWT claim maps to the human identity (default: `"sub"`).
    #[serde(default = "default_hmr_claim")]
    pub hmr_claim: String,
    /// Mapping from OIDC scopes / roles to Arsenal-style scopes.
    ///
    /// Example: `{ "admin": ["*:*:*"], "agent-user": ["openai:chat:*"] }`.
    #[serde(default)]
    pub scope_mapping: HashMap<String, Vec<String>>,
}

fn default_hmr_claim() -> String {
    "sub".to_string()
}

impl ProviderConfig {
    /// Create a minimal provider config with just issuer and audience.
    pub fn new(name: impl Into<String>, issuer: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            issuer: issuer.into(),
            audience: None,
            jwks_url: None,
            hmr_claim: default_hmr_claim(),
            scope_mapping: HashMap::new(),
        }
    }

    /// Set the expected audience.
    pub fn with_audience(mut self, audience: impl Into<String>) -> Self {
        self.audience = Some(audience.into());
        self
    }

    /// Set a custom JWKS URL (skip discovery).
    pub fn with_jwks_url(mut self, url: impl Into<String>) -> Self {
        self.jwks_url = Some(url.into());
        self
    }

    /// Set the JWT claim that identifies the human root.
    pub fn with_hmr_claim(mut self, claim: impl Into<String>) -> Self {
        self.hmr_claim = claim.into();
        self
    }

    /// Add a scope mapping entry.
    pub fn with_scope_mapping(mut self, role: impl Into<String>, scopes: Vec<String>) -> Self {
        self.scope_mapping.insert(role.into(), scopes);
        self
    }

    /// Validate that the configuration is usable.
    pub fn validate(&self) -> Result<()> {
        if self.name.is_empty() {
            return Err(OidcBridgeError::config("provider name cannot be empty"));
        }
        if self.issuer.is_empty() {
            return Err(OidcBridgeError::config("issuer URL cannot be empty"));
        }
        // Issuer must be a valid URL.
        url::Url::parse(&self.issuer).map_err(|e| {
            OidcBridgeError::config(format!("invalid issuer URL '{}': {e}", self.issuer))
        })?;
        Ok(())
    }
}

/// Top-level OIDC bridge configuration.
///
/// Supports either a single provider (for simple setups) or multiple providers
/// (for enterprises with several IdPs). The bridge routes JWTs to the correct
/// provider based on the `iss` claim.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OidcConfig {
    /// List of OIDC providers. At least one is required.
    pub providers: Vec<ProviderConfig>,
    /// OAS namespace for minted DIDs (default: `"openagent"`).
    #[serde(default = "default_namespace")]
    pub namespace: String,
    /// Default TTL in seconds for emitted JWTs (Flow 2). Default: 3600.
    #[serde(default = "default_jwt_ttl")]
    pub jwt_ttl_seconds: i64,
    /// HTTP client timeout in milliseconds for discovery / JWKS fetches.
    #[serde(default = "default_http_timeout_ms")]
    pub http_timeout_ms: u64,
}

fn default_namespace() -> String {
    "openagent".to_string()
}

fn default_jwt_ttl() -> i64 {
    3600
}

fn default_http_timeout_ms() -> u64 {
    10_000
}

impl OidcConfig {
    /// Create a config with a single OIDC provider.
    pub fn single(provider: ProviderConfig) -> Self {
        Self {
            providers: vec![provider],
            namespace: default_namespace(),
            jwt_ttl_seconds: default_jwt_ttl(),
            http_timeout_ms: default_http_timeout_ms(),
        }
    }

    /// Create a config with multiple providers.
    pub fn multi(providers: Vec<ProviderConfig>) -> Self {
        Self {
            providers,
            namespace: default_namespace(),
            jwt_ttl_seconds: default_jwt_ttl(),
            http_timeout_ms: default_http_timeout_ms(),
        }
    }

    /// Override the OAS namespace.
    pub fn with_namespace(mut self, ns: impl Into<String>) -> Self {
        self.namespace = ns.into();
        self
    }

    /// Override the JWT TTL for Flow 2 (ACT -> JWT).
    pub fn with_jwt_ttl(mut self, seconds: i64) -> Self {
        self.jwt_ttl_seconds = seconds;
        self
    }

    /// Validate the entire configuration.
    pub fn validate(&self) -> Result<()> {
        if self.providers.is_empty() {
            return Err(OidcBridgeError::config(
                "at least one OIDC provider is required",
            ));
        }
        for p in &self.providers {
            p.validate()?;
        }
        // Check for duplicate issuers.
        let mut seen = std::collections::HashSet::new();
        for p in &self.providers {
            if !seen.insert(&p.issuer) {
                return Err(OidcBridgeError::config(format!(
                    "duplicate issuer: {}",
                    p.issuer
                )));
            }
        }
        if self.namespace.is_empty() {
            return Err(OidcBridgeError::config("namespace cannot be empty"));
        }
        if self.jwt_ttl_seconds <= 0 {
            return Err(OidcBridgeError::config("jwt_ttl_seconds must be positive"));
        }
        Ok(())
    }

    /// Find the provider whose issuer matches the given string.
    pub fn find_provider(&self, issuer: &str) -> Option<&ProviderConfig> {
        self.providers.iter().find(|p| p.issuer == issuer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn okta_provider() -> ProviderConfig {
        ProviderConfig::new("okta", "https://dev-123.okta.com/oauth2/default")
            .with_audience("my-app")
    }

    #[test]
    fn single_provider_config_validates() {
        let cfg = OidcConfig::single(okta_provider());
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn empty_providers_fails_validation() {
        let cfg = OidcConfig::multi(vec![]);
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn duplicate_issuers_fails_validation() {
        let p1 = okta_provider();
        let p2 = ProviderConfig::new("okta-dup", "https://dev-123.okta.com/oauth2/default");
        let cfg = OidcConfig::multi(vec![p1, p2]);
        let err = cfg.validate();
        assert!(err.is_err());
        assert!(err
            .err()
            .unwrap_or_else(|| unreachable!())
            .to_string()
            .contains("duplicate issuer"));
    }

    #[test]
    fn find_provider_returns_match() {
        let cfg = OidcConfig::single(okta_provider());
        let found = cfg.find_provider("https://dev-123.okta.com/oauth2/default");
        assert!(found.is_some());
        assert_eq!(
            found.unwrap_or_else(|| unreachable!()).name,
            "okta"
        );
    }

    #[test]
    fn find_provider_returns_none_for_unknown() {
        let cfg = OidcConfig::single(okta_provider());
        assert!(cfg.find_provider("https://unknown.com").is_none());
    }

    #[test]
    fn provider_with_scope_mapping() {
        let p = ProviderConfig::new("auth0", "https://test.auth0.com/")
            .with_scope_mapping("admin", vec!["*:*:*".into()])
            .with_scope_mapping("viewer", vec!["openai:chat:read".into()]);
        assert_eq!(p.scope_mapping.len(), 2);
    }

    #[test]
    fn empty_issuer_fails_validation() {
        let p = ProviderConfig::new("bad", "");
        assert!(p.validate().is_err());
    }

    #[test]
    fn invalid_issuer_url_fails_validation() {
        let p = ProviderConfig::new("bad", "not a url");
        assert!(p.validate().is_err());
    }

    #[test]
    fn default_hmr_claim_is_sub() {
        let p = ProviderConfig::new("test", "https://example.com");
        assert_eq!(p.hmr_claim, "sub");
    }
}
