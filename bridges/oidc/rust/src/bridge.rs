// Copyright (c) 2026 L1fe Labs, Inc. -- Apache-2.0 OR MIT
//
//! Main `OidcBridge` — the entrypoint for all three flows.
//!
//! - **Flow 1**: Human JWT -> Agent DID (spawn agent under human's lineage).
//! - **Flow 2**: Agent ACT -> Opaque Bearer JWT (for OAuth2-only services).
//! - **Flow 3**: Token Exchange (RFC 8693).

use std::time::Duration;

use jsonwebtoken::{Algorithm, EncodingKey};

use crate::config::{OidcConfig, ProviderConfig};
use crate::discovery::DiscoveryClient;
use crate::error::{OidcBridgeError, Result};
use crate::exchange::{
    TokenExchangeRequest, TokenExchangeResponse, GRANT_TYPE_TOKEN_EXCHANGE, TOKEN_TYPE_ACT,
};
use crate::jwks::JwksClient;
use crate::jwt::{
    build_act_claims, decode_jwt_header, sign_act_jwt, validate_jwt, ActJwtClaims,
    ValidatedClaims,
};
use crate::mapping::{derive_agent_from_claims, lineage_depth, map_scopes, DerivedAgent};

/// The OIDC bridge — maps between human OIDC tokens and OAS agent identities.
///
/// Thread-safe and cheaply cloneable (all internal state is behind `Arc`).
///
/// # Example
///
/// ```ignore
/// let bridge = OidcBridge::new(OidcConfig::single(
///     ProviderConfig::new("okta", "https://dev-123.okta.com/oauth2/default")
///         .with_audience("my-app"),
/// ))?;
///
/// // Flow 1: Human JWT -> Agent DID
/// let agent = bridge.derive_agent_from_jwt(&jwt_string, "my-bot").await?;
///
/// // Flow 2: Agent ACT -> JWT
/// let jwt = bridge.act_to_jwt(&act_claims, &signing_key, Algorithm::EdDSA, None).await?;
/// ```
#[derive(Debug, Clone)]
pub struct OidcBridge {
    config: OidcConfig,
    discovery: DiscoveryClient,
    jwks: JwksClient,
}

impl OidcBridge {
    /// Create a new OIDC bridge with the given configuration.
    ///
    /// # Errors
    ///
    /// Returns [`OidcBridgeError::Config`] if the configuration is invalid.
    pub fn new(config: OidcConfig) -> Result<Self> {
        config.validate()?;

        let timeout = Duration::from_millis(config.http_timeout_ms);
        let cache_ttl = Duration::from_secs(3600);

        Ok(Self {
            config,
            discovery: DiscoveryClient::new(timeout, cache_ttl),
            jwks: JwksClient::new(timeout, cache_ttl),
        })
    }

    /// Access the bridge configuration.
    pub fn config(&self) -> &OidcConfig {
        &self.config
    }

    // ── Flow 1: Human JWT -> Agent DID ──────────────────────────────────

    /// Derive an agent DID from a human's OIDC JWT.
    ///
    /// 1. Decodes the JWT header to find the algorithm and key ID.
    /// 2. Identifies the OIDC provider from the `iss` claim.
    /// 3. Fetches the provider's JWKS (cached, with rotation-aware refresh).
    /// 4. Validates the JWT (signature, issuer, audience, expiry).
    /// 5. Maps the JWT subject to an HMR DID.
    /// 6. Derives a child agent DID under that HMR.
    ///
    /// # Errors
    ///
    /// Returns errors from any step in the chain (discovery, JWKS, validation,
    /// identity derivation).
    pub async fn derive_agent_from_jwt(
        &self,
        token: &str,
        agent_name: &str,
    ) -> Result<DerivedAgent> {
        // Decode header to get alg + kid.
        let header = decode_jwt_header(token)?;

        // Peek at the unverified claims to find the issuer.
        let issuer = extract_unverified_issuer(token)?;

        // Find the matching provider.
        let provider = self.config.find_provider(&issuer).ok_or_else(|| {
            OidcBridgeError::UnknownIssuer(issuer.clone())
        })?;

        // Resolve the JWKS URI (from config override or discovery).
        let jwks_uri = self.resolve_jwks_uri(provider).await?;

        // Fetch the JWKS and select the matching key.
        let jwks = self.jwks.fetch_jwks(&jwks_uri).await?;
        let key = match JwksClient::select_key(&jwks, &header) {
            Ok(k) => k,
            Err(_) => {
                // Key not found — try refreshing (IdP may have rotated keys).
                let refreshed = self.jwks.refresh(&jwks_uri).await?;
                JwksClient::select_key(&refreshed, &header)?
            }
        };

        // Validate the JWT.
        let claims = validate_jwt(token, &key, header.alg, provider)?;

        // Derive the agent.
        derive_agent_from_claims(&self.config.namespace, &claims, agent_name)
    }

    // ── Flow 2: Agent ACT -> JWT ────────────────────────────────────────

    /// Wrap an Arsenal ACT into a standard JWT for services that speak OAuth2.
    ///
    /// The resulting JWT includes custom claims (`lineage_depth`, `parent_hmr`,
    /// `act`) alongside standard OAuth2 claims (`sub`, `iss`, `aud`, `scope`,
    /// `exp`).
    ///
    /// # Arguments
    ///
    /// * `claims` - Pre-built ACT JWT claims (use [`build_act_claims`]).
    /// * `signing_key` - The key to sign the JWT with.
    /// * `algorithm` - Signing algorithm (e.g., `EdDSA`, `RS256`).
    /// * `kid` - Optional key ID for the JWT header.
    ///
    /// # Errors
    ///
    /// Returns [`OidcBridgeError::Signing`] if JWT encoding fails.
    pub fn act_to_jwt(
        &self,
        claims: &ActJwtClaims,
        signing_key: &EncodingKey,
        algorithm: Algorithm,
        kid: Option<&str>,
    ) -> Result<String> {
        sign_act_jwt(claims, signing_key, algorithm, kid)
    }

    /// Convenience: build ACT claims and sign in one step.
    pub fn wrap_act_as_jwt(
        &self,
        agent_did: &str,
        bridge_issuer: &str,
        audience: Option<&str>,
        scopes: &[String],
        lineage_depth: u32,
        parent_hmr: &str,
        act_b64: &str,
        signing_key: &EncodingKey,
        algorithm: Algorithm,
        kid: Option<&str>,
    ) -> Result<String> {
        let claims = build_act_claims(
            agent_did,
            bridge_issuer,
            audience,
            scopes,
            lineage_depth,
            parent_hmr,
            act_b64,
            self.config.jwt_ttl_seconds,
        );
        self.act_to_jwt(&claims, signing_key, algorithm, kid)
    }

    // ── Flow 3: Token Exchange (RFC 8693) ───────────────────────────────

    /// Execute an RFC 8693 token exchange.
    ///
    /// Validates the subject token (human JWT), derives an agent, and returns
    /// an ACT-wrapped JWT as the exchanged token.
    ///
    /// # Arguments
    ///
    /// * `request` - The token exchange request.
    /// * `signing_key` - Key for signing the response JWT.
    /// * `algorithm` - Signing algorithm.
    /// * `bridge_issuer` - Issuer claim for the response JWT.
    ///
    /// # Errors
    ///
    /// Returns errors from request validation, JWT validation, or signing.
    pub async fn exchange_token(
        &self,
        request: &TokenExchangeRequest,
        signing_key: &EncodingKey,
        algorithm: Algorithm,
        bridge_issuer: &str,
    ) -> Result<TokenExchangeResponse> {
        // Validate the request structure.
        request.validate()?;

        // Derive an agent from the subject token.
        let agent_name = "exchange-agent";
        let agent = self
            .derive_agent_from_jwt(&request.subject_token, agent_name)
            .await?;

        // Map scopes.
        let requested_scopes = request.requested_scopes();

        // Determine the issuer's provider for scope mapping.
        let issuer = extract_unverified_issuer(&request.subject_token)?;
        let provider = self.config.find_provider(&issuer).ok_or_else(|| {
            OidcBridgeError::UnknownIssuer(issuer.clone())
        })?;

        let arsenal_scopes = if requested_scopes.is_empty() {
            map_scopes(&["default".into()], &provider.scope_mapping)
        } else {
            let scope_strs: Vec<String> = requested_scopes;
            map_scopes(&scope_strs, &provider.scope_mapping)
        };

        let depth = lineage_depth(&agent.agent_document);

        // Build and sign the response JWT.
        let jwt = self.wrap_act_as_jwt(
            &agent.agent_did,
            bridge_issuer,
            request.audience.as_deref(),
            &arsenal_scopes,
            depth,
            &agent.parent_hmr_did,
            "exchange-act-placeholder",
            signing_key,
            algorithm,
            None,
        )?;

        Ok(TokenExchangeResponse::success(
            jwt,
            TOKEN_TYPE_ACT,
            self.config.jwt_ttl_seconds,
            Some(arsenal_scopes.join(" ")),
        ))
    }

    /// Convenience: exchange a human JWT for agent scopes in one call.
    ///
    /// Combines Flow 1 and scope mapping without requiring the caller to
    /// construct a full [`TokenExchangeRequest`].
    pub async fn exchange_token_simple(
        &self,
        human_jwt: &str,
        requested_scopes: &[&str],
        signing_key: &EncodingKey,
        algorithm: Algorithm,
        bridge_issuer: &str,
    ) -> Result<TokenExchangeResponse> {
        let request = TokenExchangeRequest::new_jwt_to_act(human_jwt, requested_scopes);
        self.exchange_token(&request, signing_key, algorithm, bridge_issuer)
            .await
    }

    // ── Validation helpers (public for advanced use) ────────────────────

    /// Validate a JWT and return its claims without deriving an agent.
    ///
    /// Useful when you only need to verify the human's identity, not spawn
    /// an agent.
    pub async fn validate_jwt(&self, token: &str) -> Result<ValidatedClaims> {
        let header = decode_jwt_header(token)?;
        let issuer = extract_unverified_issuer(token)?;

        let provider = self.config.find_provider(&issuer).ok_or_else(|| {
            OidcBridgeError::UnknownIssuer(issuer.clone())
        })?;

        let jwks_uri = self.resolve_jwks_uri(provider).await?;
        let jwks = self.jwks.fetch_jwks(&jwks_uri).await?;
        let key = match JwksClient::select_key(&jwks, &header) {
            Ok(k) => k,
            Err(_) => {
                let refreshed = self.jwks.refresh(&jwks_uri).await?;
                JwksClient::select_key(&refreshed, &header)?
            }
        };

        validate_jwt(token, &key, header.alg, provider)
    }

    /// Force-refresh the JWKS cache for all configured providers.
    pub async fn refresh_all_jwks(&self) {
        for provider in &self.config.providers {
            if let Ok(jwks_uri) = self.resolve_jwks_uri(provider).await {
                let _ = self.jwks.refresh(&jwks_uri).await;
            }
        }
    }

    // ── Internal helpers ────────────────────────────────────────────────

    /// Resolve the JWKS URI for a provider (config override or discovery).
    async fn resolve_jwks_uri(&self, provider: &ProviderConfig) -> Result<String> {
        if let Some(ref url) = provider.jwks_url {
            return Ok(url.clone());
        }
        let doc = self.discovery.discover(&provider.issuer).await?;
        Ok(doc.jwks_uri)
    }
}

/// Extract the `iss` claim from a JWT without verifying the signature.
///
/// This is safe because we only use it to route to the correct provider;
/// actual validation happens with the provider's JWKS.
fn extract_unverified_issuer(token: &str) -> Result<String> {
    let parts: Vec<&str> = token.splitn(3, '.').collect();
    if parts.len() < 2 {
        return Err(OidcBridgeError::jwt_validation(
            "JWT must have at least header.payload",
        ));
    }

    use base64::Engine;
    let payload_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(parts[1])
        .or_else(|_| {
            // Try with standard base64 (some providers don't strip padding).
            base64::engine::general_purpose::STANDARD.decode(parts[1])
        })
        .map_err(|e| {
            OidcBridgeError::jwt_validation(format!("failed to decode JWT payload: {e}"))
        })?;

    let payload: serde_json::Value = serde_json::from_slice(&payload_bytes).map_err(|e| {
        OidcBridgeError::jwt_validation(format!("failed to parse JWT payload: {e}"))
    })?;

    payload["iss"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| OidcBridgeError::jwt_validation("JWT has no 'iss' claim"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ProviderConfig;

    fn test_config() -> OidcConfig {
        OidcConfig::single(
            ProviderConfig::new("okta", "https://dev-123.okta.com/oauth2/default")
                .with_audience("my-app"),
        )
    }

    #[test]
    fn bridge_creation_succeeds_with_valid_config() {
        let bridge = OidcBridge::new(test_config());
        assert!(bridge.is_ok());
    }

    #[test]
    fn bridge_creation_fails_with_empty_providers() {
        let cfg = OidcConfig::multi(vec![]);
        let bridge = OidcBridge::new(cfg);
        assert!(bridge.is_err());
    }

    #[test]
    fn extract_unverified_issuer_works() {
        // Create a minimal JWT with an iss claim.
        use base64::Engine;
        let header = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(r#"{"alg":"RS256","typ":"JWT"}"#);
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(r#"{"iss":"https://example.com","sub":"user1"}"#);
        let token = format!("{header}.{payload}.fakesig");

        let iss = extract_unverified_issuer(&token)
            .unwrap_or_else(|e| unreachable!("{e}"));
        assert_eq!(iss, "https://example.com");
    }

    #[test]
    fn extract_unverified_issuer_fails_on_missing_iss() {
        use base64::Engine;
        let header = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(r#"{"alg":"RS256"}"#);
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(r#"{"sub":"user1"}"#);
        let token = format!("{header}.{payload}.sig");

        let result = extract_unverified_issuer(&token);
        assert!(result.is_err());
    }

    #[test]
    fn extract_unverified_issuer_fails_on_garbage() {
        let result = extract_unverified_issuer("not-a-jwt");
        assert!(result.is_err());
    }

    #[test]
    fn act_to_jwt_roundtrip() {
        let bridge = OidcBridge::new(test_config())
            .unwrap_or_else(|e| unreachable!("{e}"));
        let key = EncodingKey::from_secret(b"test-secret-at-least-32-bytes!!");
        let claims = build_act_claims(
            "did:oas:openagent:agent:bot",
            "https://bridge.openagent.id",
            None,
            &["openai:chat:*".into()],
            1,
            "did:oas:openagent:hmr:alice",
            "act-data",
            3600,
        );
        let jwt = bridge.act_to_jwt(&claims, &key, Algorithm::HS256, None);
        assert!(jwt.is_ok());
    }

    #[test]
    fn wrap_act_as_jwt_convenience() {
        let bridge = OidcBridge::new(test_config())
            .unwrap_or_else(|e| unreachable!("{e}"));
        let key = EncodingKey::from_secret(b"test-secret-at-least-32-bytes!!");

        let jwt = bridge.wrap_act_as_jwt(
            "did:oas:openagent:agent:bot",
            "https://bridge.openagent.id",
            None,
            &["openai:chat:*".into()],
            1,
            "did:oas:openagent:hmr:alice",
            "act-encoded",
            &key,
            Algorithm::HS256,
            Some("key-1"),
        );
        assert!(jwt.is_ok());
    }

    #[test]
    fn config_accessor_returns_config() {
        let bridge = OidcBridge::new(test_config())
            .unwrap_or_else(|e| unreachable!("{e}"));
        assert_eq!(bridge.config().namespace, "openagent");
        assert_eq!(bridge.config().providers.len(), 1);
    }
}
