// Copyright (c) 2026 L1fe Labs, Inc. -- Apache-2.0 OR MIT
//
//! OIDC discovery — fetches and caches `.well-known/openid-configuration`.
//!
//! Implements [OpenID Connect Discovery 1.0](https://openid.net/specs/openid-connect-discovery-1_0.html).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::error::{OidcBridgeError, Result};

/// Subset of the OpenID Connect Discovery document that we need.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveryDocument {
    /// The OIDC issuer identifier (MUST match the `issuer` in our config).
    pub issuer: String,
    /// URL of the authorization endpoint.
    #[serde(default)]
    pub authorization_endpoint: String,
    /// URL of the token endpoint.
    #[serde(default)]
    pub token_endpoint: String,
    /// URL of the JWKS endpoint.
    pub jwks_uri: String,
    /// Supported response types.
    #[serde(default)]
    pub response_types_supported: Vec<String>,
    /// Supported subject identifier types.
    #[serde(default)]
    pub subject_types_supported: Vec<String>,
    /// Supported ID token signing algorithms.
    #[serde(default)]
    pub id_token_signing_alg_values_supported: Vec<String>,
    /// Supported scopes.
    #[serde(default)]
    pub scopes_supported: Vec<String>,
    /// Token exchange endpoint (may differ from token_endpoint for some providers).
    #[serde(default)]
    pub token_exchange_endpoint: Option<String>,
}

/// Cached discovery document with a TTL.
#[derive(Debug, Clone)]
struct CachedDiscovery {
    document: DiscoveryDocument,
    fetched_at: std::time::Instant,
}

/// OIDC discovery client with per-issuer caching.
///
/// Cache entries expire after the configured TTL (default: 1 hour).
#[derive(Debug, Clone)]
pub struct DiscoveryClient {
    http: reqwest::Client,
    cache: Arc<RwLock<HashMap<String, CachedDiscovery>>>,
    cache_ttl: Duration,
}

impl DiscoveryClient {
    /// Create a new discovery client.
    pub fn new(timeout: Duration, cache_ttl: Duration) -> Self {
        let http = reqwest::Client::builder()
            .timeout(timeout)
            .user_agent("openagent-oidc/0.1.0")
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            http,
            cache: Arc::new(RwLock::new(HashMap::new())),
            cache_ttl,
        }
    }

    /// Create a discovery client with default settings (10s timeout, 1h cache TTL).
    pub fn with_defaults() -> Self {
        Self::new(Duration::from_secs(10), Duration::from_secs(3600))
    }

    /// Fetch (or return cached) the discovery document for the given issuer.
    ///
    /// # Errors
    ///
    /// Returns [`OidcBridgeError::Discovery`] if the fetch or parse fails.
    pub async fn discover(&self, issuer: &str) -> Result<DiscoveryDocument> {
        // Check cache first.
        {
            let cache = self.cache.read().await;
            if let Some(cached) = cache.get(issuer) {
                if cached.fetched_at.elapsed() < self.cache_ttl {
                    return Ok(cached.document.clone());
                }
            }
        }

        // Fetch from the well-known endpoint.
        let url = well_known_url(issuer)?;
        tracing::debug!(issuer, url = %url, "fetching OIDC discovery document");

        let response = self.http.get(&url).send().await.map_err(|e| {
            OidcBridgeError::discovery(format!("failed to fetch discovery for {issuer}: {e}"))
        })?;

        if !response.status().is_success() {
            return Err(OidcBridgeError::discovery(format!(
                "discovery endpoint returned HTTP {}: {url}",
                response.status()
            )));
        }

        let doc: DiscoveryDocument = response.json().await.map_err(|e| {
            OidcBridgeError::discovery(format!("failed to parse discovery document: {e}"))
        })?;

        // Validate issuer match (OIDC spec requirement).
        if doc.issuer != issuer {
            return Err(OidcBridgeError::discovery(format!(
                "issuer mismatch: config says '{}', discovery says '{}'",
                issuer, doc.issuer
            )));
        }

        if doc.jwks_uri.is_empty() {
            return Err(OidcBridgeError::discovery(format!(
                "discovery document for {issuer} has no jwks_uri"
            )));
        }

        // Cache the result.
        {
            let mut cache = self.cache.write().await;
            cache.insert(
                issuer.to_string(),
                CachedDiscovery {
                    document: doc.clone(),
                    fetched_at: std::time::Instant::now(),
                },
            );
        }

        Ok(doc)
    }

    /// Invalidate the cache for a specific issuer.
    pub async fn invalidate(&self, issuer: &str) {
        let mut cache = self.cache.write().await;
        cache.remove(issuer);
    }

    /// Invalidate the entire cache.
    pub async fn invalidate_all(&self) {
        let mut cache = self.cache.write().await;
        cache.clear();
    }
}

/// Build the `.well-known/openid-configuration` URL from an issuer.
///
/// Handles trailing slashes correctly per the OIDC Discovery spec.
fn well_known_url(issuer: &str) -> Result<String> {
    let base = issuer.trim_end_matches('/');
    if base.is_empty() {
        return Err(OidcBridgeError::discovery("issuer URL is empty"));
    }
    Ok(format!("{base}/.well-known/openid-configuration"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn well_known_url_strips_trailing_slash() {
        let url = well_known_url("https://example.com/")
            .unwrap_or_else(|e| unreachable!("{e}"));
        assert_eq!(
            url,
            "https://example.com/.well-known/openid-configuration"
        );
    }

    #[test]
    fn well_known_url_no_trailing_slash() {
        let url = well_known_url("https://example.com")
            .unwrap_or_else(|e| unreachable!("{e}"));
        assert_eq!(
            url,
            "https://example.com/.well-known/openid-configuration"
        );
    }

    #[test]
    fn well_known_url_with_path() {
        let url = well_known_url("https://dev-123.okta.com/oauth2/default")
            .unwrap_or_else(|e| unreachable!("{e}"));
        assert_eq!(
            url,
            "https://dev-123.okta.com/oauth2/default/.well-known/openid-configuration"
        );
    }

    #[test]
    fn well_known_url_empty_fails() {
        assert!(well_known_url("").is_err());
    }

    #[test]
    fn discovery_document_deserializes() {
        let json = r#"{
            "issuer": "https://example.com",
            "jwks_uri": "https://example.com/jwks",
            "authorization_endpoint": "https://example.com/authorize",
            "token_endpoint": "https://example.com/token",
            "response_types_supported": ["code"],
            "subject_types_supported": ["public"],
            "id_token_signing_alg_values_supported": ["RS256"]
        }"#;
        let doc: DiscoveryDocument =
            serde_json::from_str(json).unwrap_or_else(|e| unreachable!("{e}"));
        assert_eq!(doc.issuer, "https://example.com");
        assert_eq!(doc.jwks_uri, "https://example.com/jwks");
    }

    #[test]
    fn discovery_document_handles_missing_optional_fields() {
        let json = r#"{
            "issuer": "https://example.com",
            "jwks_uri": "https://example.com/jwks"
        }"#;
        let doc: DiscoveryDocument =
            serde_json::from_str(json).unwrap_or_else(|e| unreachable!("{e}"));
        assert!(doc.authorization_endpoint.is_empty());
        assert!(doc.scopes_supported.is_empty());
    }

    #[tokio::test]
    async fn invalidate_clears_specific_issuer() {
        let client = DiscoveryClient::with_defaults();
        // No cache entry exists, invalidate should be a no-op.
        client.invalidate("https://example.com").await;
    }

    #[tokio::test]
    async fn invalidate_all_clears_cache() {
        let client = DiscoveryClient::with_defaults();
        client.invalidate_all().await;
    }
}
