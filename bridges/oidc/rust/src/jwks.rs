// Copyright (c) 2026 L1fe Labs, Inc. -- Apache-2.0 OR MIT
//
//! JWKS fetching, caching, and key selection.
//!
//! Implements the JSON Web Key Set (RFC 7517) portion of OIDC JWT validation.
//! Keys are cached per JWKS URI and automatically refreshed on signature
//! verification failure (to handle IdP key rotation).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use jsonwebtoken::jwk::{JwkSet};
use jsonwebtoken::{DecodingKey, Header};
use tokio::sync::RwLock;

use crate::error::{OidcBridgeError, Result};

/// Cached JWKS with a TTL.
#[derive(Debug, Clone)]
struct CachedJwks {
    jwks: JwkSet,
    fetched_at: std::time::Instant,
}

/// JWKS client with per-URI caching and rotation-aware refresh.
#[derive(Debug, Clone)]
pub struct JwksClient {
    http: reqwest::Client,
    cache: Arc<RwLock<HashMap<String, CachedJwks>>>,
    cache_ttl: Duration,
}

impl JwksClient {
    /// Create a new JWKS client.
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

    /// Create a client with default settings (10s timeout, 1h cache TTL).
    pub fn with_defaults() -> Self {
        Self::new(Duration::from_secs(10), Duration::from_secs(3600))
    }

    /// Fetch (or return cached) the JWKS for the given URI.
    ///
    /// # Errors
    ///
    /// Returns [`OidcBridgeError::Jwks`] on network or parse failure.
    pub async fn fetch_jwks(&self, jwks_uri: &str) -> Result<JwkSet> {
        // Check cache.
        {
            let cache = self.cache.read().await;
            if let Some(cached) = cache.get(jwks_uri) {
                if cached.fetched_at.elapsed() < self.cache_ttl {
                    return Ok(cached.jwks.clone());
                }
            }
        }

        self.fetch_and_cache(jwks_uri).await
    }

    /// Force-refresh the JWKS for the given URI (key rotation scenario).
    ///
    /// Call this when JWT signature verification fails — the IdP may have
    /// rotated keys since we last fetched the JWKS.
    pub async fn refresh(&self, jwks_uri: &str) -> Result<JwkSet> {
        tracing::info!(jwks_uri, "force-refreshing JWKS (possible key rotation)");
        self.fetch_and_cache(jwks_uri).await
    }

    /// Select a [`DecodingKey`] from the JWKS that matches the JWT header.
    ///
    /// Matches on `kid` (key ID) first, then falls back to `alg` matching
    /// if there is exactly one key for that algorithm.
    ///
    /// # Errors
    ///
    /// Returns [`OidcBridgeError::Jwks`] if no matching key is found.
    pub fn select_key(jwks: &JwkSet, header: &Header) -> Result<DecodingKey> {
        // First: try matching by kid.
        if let Some(kid) = &header.kid {
            for jwk in &jwks.keys {
                if jwk.common.key_id.as_deref() == Some(kid.as_str()) {
                    return DecodingKey::from_jwk(jwk).map_err(|e| {
                        OidcBridgeError::jwks(format!("failed to build key from JWK (kid={kid}): {e}"))
                    });
                }
            }
            return Err(OidcBridgeError::jwks(format!(
                "no JWK found with kid '{kid}'"
            )));
        }

        // Fallback: match by algorithm if there's exactly one candidate.
        let alg_str = format!("{:?}", header.alg);
        let candidates: Vec<_> = jwks
            .keys
            .iter()
            .filter(|jwk| {
                jwk.common
                    .key_algorithm
                    .map(|a| format!("{a:?}") == alg_str)
                    .unwrap_or(false)
            })
            .collect();

        match candidates.len() {
            0 => Err(OidcBridgeError::jwks(format!(
                "no JWK found for algorithm {alg_str}"
            ))),
            1 => {
                let jwk = candidates[0];
                DecodingKey::from_jwk(jwk).map_err(|e| {
                    OidcBridgeError::jwks(format!(
                        "failed to build key from JWK (alg={alg_str}): {e}"
                    ))
                })
            }
            n => Err(OidcBridgeError::jwks(format!(
                "ambiguous: {n} JWKs match algorithm {alg_str} but JWT has no kid"
            ))),
        }
    }

    /// Internal: fetch, parse, and cache the JWKS.
    async fn fetch_and_cache(&self, jwks_uri: &str) -> Result<JwkSet> {
        tracing::debug!(jwks_uri, "fetching JWKS");

        let response = self.http.get(jwks_uri).send().await.map_err(|e| {
            OidcBridgeError::jwks(format!("failed to fetch JWKS from {jwks_uri}: {e}"))
        })?;

        if !response.status().is_success() {
            return Err(OidcBridgeError::jwks(format!(
                "JWKS endpoint returned HTTP {}: {jwks_uri}",
                response.status()
            )));
        }

        let jwks: JwkSet = response.json().await.map_err(|e| {
            OidcBridgeError::jwks(format!("failed to parse JWKS: {e}"))
        })?;

        if jwks.keys.is_empty() {
            return Err(OidcBridgeError::jwks(format!(
                "JWKS at {jwks_uri} contains no keys"
            )));
        }

        // Cache.
        {
            let mut cache = self.cache.write().await;
            cache.insert(
                jwks_uri.to_string(),
                CachedJwks {
                    jwks: jwks.clone(),
                    fetched_at: std::time::Instant::now(),
                },
            );
        }

        Ok(jwks)
    }

    /// Invalidate a specific JWKS cache entry.
    pub async fn invalidate(&self, jwks_uri: &str) {
        let mut cache = self.cache.write().await;
        cache.remove(jwks_uri);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::jwk::{
        CommonParameters, Jwk, KeyAlgorithm, RsaKeyParameters, RsaKeyType,
    };

    fn make_test_jwks(kid: Option<&str>) -> JwkSet {
        // Create a minimal RSA JWK for testing key selection logic.
        let jwk = Jwk {
            common: CommonParameters {
                public_key_use: None,
                key_operations: None,
                key_algorithm: Some(KeyAlgorithm::RS256),
                key_id: kid.map(|s| s.to_string()),
                x509_url: None,
                x509_chain: None,
                x509_sha1_fingerprint: None,
                x509_sha256_fingerprint: None,
            },
            algorithm: jsonwebtoken::jwk::AlgorithmParameters::RSA(RsaKeyParameters {
                key_type: RsaKeyType::RSA,
                n: "0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw".to_string(),
                e: "AQAB".to_string(),
            }),
        };

        JwkSet { keys: vec![jwk] }
    }

    #[test]
    fn select_key_by_kid_succeeds() {
        let jwks = make_test_jwks(Some("test-key-1"));
        let header = Header {
            kid: Some("test-key-1".into()),
            alg: jsonwebtoken::Algorithm::RS256,
            ..Default::default()
        };
        let result = JwksClient::select_key(&jwks, &header);
        assert!(result.is_ok());
    }

    #[test]
    fn select_key_by_kid_fails_when_not_found() {
        let jwks = make_test_jwks(Some("test-key-1"));
        let header = Header {
            kid: Some("nonexistent".into()),
            alg: jsonwebtoken::Algorithm::RS256,
            ..Default::default()
        };
        let result = JwksClient::select_key(&jwks, &header);
        assert!(result.is_err());
        assert!(result
            .err()
            .unwrap_or_else(|| unreachable!())
            .to_string()
            .contains("nonexistent"));
    }

    #[test]
    fn select_key_by_alg_fallback_succeeds() {
        let jwks = make_test_jwks(None);
        let header = Header {
            kid: None,
            alg: jsonwebtoken::Algorithm::RS256,
            ..Default::default()
        };
        let result = JwksClient::select_key(&jwks, &header);
        assert!(result.is_ok());
    }

    #[test]
    fn select_key_fails_on_empty_jwks() {
        let jwks = JwkSet { keys: vec![] };
        let header = Header {
            kid: None,
            alg: jsonwebtoken::Algorithm::RS256,
            ..Default::default()
        };
        let result = JwksClient::select_key(&jwks, &header);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn invalidate_is_no_op_on_empty_cache() {
        let client = JwksClient::with_defaults();
        client.invalidate("https://example.com/jwks").await;
    }
}
