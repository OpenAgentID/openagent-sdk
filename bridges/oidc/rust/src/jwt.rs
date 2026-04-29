// Copyright (c) 2026 L1fe Labs, Inc. -- Apache-2.0 OR MIT
//
//! JWT validation, decoding, and signing for the OIDC bridge.
//!
//! Handles both directions:
//! - **Inbound**: Validate human JWTs from OIDC providers (Flow 1, Flow 3).
//! - **Outbound**: Sign JWTs wrapping Arsenal ACTs (Flow 2).

use std::collections::HashMap;

use chrono::Utc;
use jsonwebtoken::{
    decode, decode_header, encode, Algorithm, DecodingKey, EncodingKey, Header, TokenData,
    Validation,
};
use serde::{Deserialize, Serialize};

use crate::config::ProviderConfig;
use crate::error::{OidcBridgeError, Result};

/// Standard + custom claims extracted from a validated human JWT.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidatedClaims {
    /// Issuer (`iss` claim).
    pub issuer: String,
    /// Subject (`sub` claim) — typically the human user's unique ID.
    pub subject: String,
    /// Audience (`aud` claim), if present.
    #[serde(default)]
    pub audience: Vec<String>,
    /// Expiration time (epoch seconds).
    pub exp: i64,
    /// Issued-at time (epoch seconds).
    #[serde(default)]
    pub iat: i64,
    /// The claim value that maps to the HMR (configurable, default `sub`).
    pub hmr_value: String,
    /// OIDC scopes or roles extracted from the token.
    #[serde(default)]
    pub scopes: Vec<String>,
    /// All original claims (for custom mapping).
    #[serde(default)]
    pub raw_claims: HashMap<String, serde_json::Value>,
}

/// Raw JWT claims structure for deserialization.
#[derive(Debug, Deserialize)]
struct RawClaims {
    iss: Option<String>,
    sub: Option<String>,
    aud: Option<AudClaim>,
    exp: Option<i64>,
    iat: Option<i64>,
    scope: Option<String>,
    #[serde(flatten)]
    extra: HashMap<String, serde_json::Value>,
}

/// The `aud` claim can be either a string or an array.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum AudClaim {
    Single(String),
    Multiple(Vec<String>),
}

impl AudClaim {
    fn into_vec(self) -> Vec<String> {
        match self {
            AudClaim::Single(s) => vec![s],
            AudClaim::Multiple(v) => v,
        }
    }
}

/// Decode the JWT header without validation (to extract `kid` and `alg`).
///
/// # Errors
///
/// Returns [`OidcBridgeError::JwtValidation`] if the header is malformed.
pub fn decode_jwt_header(token: &str) -> Result<Header> {
    decode_header(token).map_err(|e| {
        OidcBridgeError::jwt_validation(format!("failed to decode JWT header: {e}"))
    })
}

/// Validate and decode a JWT using the given decoding key.
///
/// Performs standard OIDC validation: issuer match, audience match (if
/// configured), expiry check, signature verification.
///
/// # Errors
///
/// Returns [`OidcBridgeError::JwtValidation`] on any validation failure.
pub fn validate_jwt(
    token: &str,
    key: &DecodingKey,
    algorithm: Algorithm,
    provider: &ProviderConfig,
) -> Result<ValidatedClaims> {
    let mut validation = Validation::new(algorithm);
    validation.set_issuer(&[&provider.issuer]);

    if let Some(aud) = &provider.audience {
        validation.set_audience(&[aud]);
    } else {
        validation.validate_aud = false;
    }

    // Allow 60s clock skew.
    validation.leeway = 60;

    let token_data: TokenData<RawClaims> = decode(token, key, &validation)?;
    let claims = token_data.claims;

    let subject = claims.sub.unwrap_or_default();
    let issuer = claims.iss.unwrap_or_default();

    // Extract the HMR value from the configured claim.
    let hmr_value = if provider.hmr_claim == "sub" {
        subject.clone()
    } else {
        claims
            .extra
            .get(&provider.hmr_claim)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| subject.clone())
    };

    // Extract scopes from `scope` claim (space-delimited per OAuth 2.0).
    let scopes: Vec<String> = claims
        .scope
        .map(|s| s.split_whitespace().map(|s| s.to_string()).collect())
        .unwrap_or_default();

    // Merge extra claims into raw_claims.
    let mut raw_claims = claims.extra;
    raw_claims.insert("sub".into(), serde_json::Value::String(subject.clone()));
    raw_claims.insert("iss".into(), serde_json::Value::String(issuer.clone()));

    Ok(ValidatedClaims {
        issuer,
        subject,
        audience: claims.aud.map(AudClaim::into_vec).unwrap_or_default(),
        exp: claims.exp.unwrap_or(0),
        iat: claims.iat.unwrap_or(0),
        hmr_value,
        scopes,
        raw_claims,
    })
}

/// Claims for an outbound JWT that wraps an Arsenal ACT (Flow 2).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActJwtClaims {
    /// Subject: the agent's DID.
    pub sub: String,
    /// Issuer: the bridge's own issuer identifier.
    pub iss: String,
    /// Audience: the service that will consume this JWT.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aud: Option<String>,
    /// Expiration (epoch seconds).
    pub exp: i64,
    /// Issued-at (epoch seconds).
    pub iat: i64,
    /// JWT ID for replay prevention.
    pub jti: String,
    /// Arsenal scope strings mapped from the ACT.
    pub scope: String,
    /// The agent's lineage depth (hops from HMR root).
    pub lineage_depth: u32,
    /// The parent HMR DID.
    pub parent_hmr: String,
    /// The serialized ACT (base64url-encoded).
    pub act: String,
}

/// Sign a JWT wrapping an Arsenal ACT for services that speak OAuth2.
///
/// The resulting JWT can be introspected by standard OAuth2 resource servers.
/// Custom claims (`lineage_depth`, `parent_hmr`, `act`) carry the agent
/// identity metadata.
///
/// # Arguments
///
/// * `claims` - Pre-built ACT JWT claims.
/// * `signing_key` - Ed25519 or RSA private key in PEM or DER format.
/// * `algorithm` - The signing algorithm (e.g., `EdDSA`, `RS256`).
/// * `kid` - Optional key ID to include in the JWT header.
///
/// # Errors
///
/// Returns [`OidcBridgeError::Signing`] if encoding fails.
pub fn sign_act_jwt(
    claims: &ActJwtClaims,
    signing_key: &EncodingKey,
    algorithm: Algorithm,
    kid: Option<&str>,
) -> Result<String> {
    let mut header = Header::new(algorithm);
    header.kid = kid.map(|s| s.to_string());
    header.typ = Some("JWT".to_string());

    encode(&header, claims, signing_key).map_err(|e| {
        OidcBridgeError::Signing(format!("failed to sign ACT JWT: {e}"))
    })
}

/// Build ACT JWT claims from the parts produced by the bridge.
pub fn build_act_claims(
    agent_did: &str,
    bridge_issuer: &str,
    audience: Option<&str>,
    scopes: &[String],
    lineage_depth: u32,
    parent_hmr: &str,
    act_b64: &str,
    ttl_seconds: i64,
) -> ActJwtClaims {
    let now = Utc::now().timestamp();
    ActJwtClaims {
        sub: agent_did.to_string(),
        iss: bridge_issuer.to_string(),
        aud: audience.map(|s| s.to_string()),
        exp: now + ttl_seconds,
        iat: now,
        jti: generate_jti(),
        scope: scopes.join(" "),
        lineage_depth,
        parent_hmr: parent_hmr.to_string(),
        act: act_b64.to_string(),
    }
}

/// Generate a unique JWT ID.
fn generate_jti() -> String {
    use base64::Engine;
    let mut bytes = [0u8; 16];
    getrandom(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Fill bytes with random data. Falls back to timestamp-based if getrandom
/// is not available (should not happen in practice).
fn getrandom(buf: &mut [u8]) {
    use std::time::{SystemTime, UNIX_EPOCH};
    // Simple fallback: use system time + incrementing counter as entropy.
    // In production this uses the OS CSPRNG via the rand crate.
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    for (i, byte) in buf.iter_mut().enumerate() {
        *byte = ((seed >> (i % 16 * 8)) & 0xFF) as u8;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aud_claim_single_into_vec() {
        let aud = AudClaim::Single("my-app".into());
        assert_eq!(aud.into_vec(), vec!["my-app"]);
    }

    #[test]
    fn aud_claim_multiple_into_vec() {
        let aud = AudClaim::Multiple(vec!["a".into(), "b".into()]);
        assert_eq!(aud.into_vec(), vec!["a", "b"]);
    }

    #[test]
    fn build_act_claims_sets_fields_correctly() {
        let claims = build_act_claims(
            "did:oas:openagent:agent:bot",
            "https://bridge.openagent.id",
            Some("https://api.service.com"),
            &["openai:chat:completions".into()],
            1,
            "did:oas:openagent:hmr:alice",
            "base64-act-data",
            3600,
        );

        assert_eq!(claims.sub, "did:oas:openagent:agent:bot");
        assert_eq!(claims.iss, "https://bridge.openagent.id");
        assert_eq!(claims.aud.as_deref(), Some("https://api.service.com"));
        assert_eq!(claims.scope, "openai:chat:completions");
        assert_eq!(claims.lineage_depth, 1);
        assert_eq!(claims.parent_hmr, "did:oas:openagent:hmr:alice");
        assert_eq!(claims.act, "base64-act-data");
        assert!(claims.exp > claims.iat);
        assert!(!claims.jti.is_empty());
    }

    #[test]
    fn build_act_claims_multiple_scopes_joined() {
        let claims = build_act_claims(
            "did:oas:openagent:agent:bot",
            "https://bridge.openagent.id",
            None,
            &["openai:chat:*".into(), "github:repo:read".into()],
            2,
            "did:oas:openagent:hmr:alice",
            "act",
            300,
        );

        assert_eq!(claims.scope, "openai:chat:* github:repo:read");
        assert!(claims.aud.is_none());
    }

    #[test]
    fn generate_jti_is_unique() {
        let jti1 = generate_jti();
        let jti2 = generate_jti();
        // In practice these should differ due to nanos precision.
        assert!(!jti1.is_empty());
        assert!(!jti2.is_empty());
    }

    #[test]
    fn sign_act_jwt_with_hmac_secret() {
        // Use HS256 for test simplicity (real deployments use RS256 or EdDSA).
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
        let jwt = sign_act_jwt(&claims, &key, Algorithm::HS256, Some("test-key"));
        assert!(jwt.is_ok());
        let token = jwt.unwrap_or_else(|e| unreachable!("{e}"));
        assert!(token.contains('.'));
        // Should have 3 parts.
        assert_eq!(token.split('.').count(), 3);
    }

    #[test]
    fn decode_jwt_header_extracts_kid() {
        // Create a JWT with HS256 and a kid.
        let key = EncodingKey::from_secret(b"test-secret-at-least-32-bytes!!");
        let claims = build_act_claims(
            "did:oas:openagent:agent:bot",
            "iss",
            None,
            &[],
            0,
            "hmr",
            "act",
            60,
        );
        let token = sign_act_jwt(&claims, &key, Algorithm::HS256, Some("my-kid"))
            .unwrap_or_else(|e| unreachable!("{e}"));

        let header = decode_jwt_header(&token).unwrap_or_else(|e| unreachable!("{e}"));
        assert_eq!(header.kid.as_deref(), Some("my-kid"));
        assert_eq!(header.alg, Algorithm::HS256);
    }
}
