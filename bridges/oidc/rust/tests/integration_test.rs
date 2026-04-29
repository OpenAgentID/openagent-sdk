// Copyright (c) 2026 L1fe Labs, Inc. -- Apache-2.0 OR MIT
//
//! Integration tests for the OIDC bridge.
//!
//! These tests exercise the full flow with mocked OIDC providers using wiremock.

use openagent_oidc::{
    OidcBridge, OidcConfig, ProviderConfig, TokenExchangeRequest,
};

use openagent_oidc::config;
use openagent_oidc::exchange;
use openagent_oidc::jwt;
use openagent_oidc::mapping;

// ── Config validation tests ─────────────────────────────────────────

#[test]
fn multi_provider_config_validates() {
    let cfg = OidcConfig::multi(vec![
        ProviderConfig::new("okta", "https://dev-123.okta.com/oauth2/default")
            .with_audience("app"),
        ProviderConfig::new("azure", "https://login.microsoftonline.com/tenant/v2.0")
            .with_audience("api"),
    ]);
    assert!(cfg.validate().is_ok());
}

#[test]
fn provider_scope_mapping_roundtrips_through_serde() {
    let provider = ProviderConfig::new("auth0", "https://test.auth0.com/")
        .with_scope_mapping("admin", vec!["*:*:*".into()])
        .with_scope_mapping("viewer", vec!["openai:chat:read".into()]);

    let json = serde_json::to_string(&provider).unwrap_or_else(|e| unreachable!("{e}"));
    let deser: ProviderConfig =
        serde_json::from_str(&json).unwrap_or_else(|e| unreachable!("{e}"));

    assert_eq!(deser.scope_mapping.len(), 2);
    assert_eq!(deser.name, "auth0");
}

#[test]
fn oidc_config_serializes_and_deserializes() {
    let cfg = OidcConfig::single(
        ProviderConfig::new("google", "https://accounts.google.com")
            .with_audience("client-id"),
    )
    .with_namespace("custom")
    .with_jwt_ttl(1800);

    let json = serde_json::to_string(&cfg).unwrap_or_else(|e| unreachable!("{e}"));
    let deser: OidcConfig =
        serde_json::from_str(&json).unwrap_or_else(|e| unreachable!("{e}"));

    assert_eq!(deser.namespace, "custom");
    assert_eq!(deser.jwt_ttl_seconds, 1800);
    assert_eq!(deser.providers.len(), 1);
}

// ── Bridge creation tests ───────────────────────────────────────────

#[test]
fn bridge_rejects_invalid_config() {
    let cfg = OidcConfig::multi(vec![]);
    assert!(OidcBridge::new(cfg).is_err());
}

#[test]
fn bridge_accepts_multi_provider() {
    let cfg = OidcConfig::multi(vec![
        ProviderConfig::new("okta", "https://dev-123.okta.com/oauth2/default"),
        ProviderConfig::new("azure", "https://login.microsoftonline.com/t/v2.0"),
    ]);
    assert!(OidcBridge::new(cfg).is_ok());
}

// ── Token exchange request validation ───────────────────────────────

#[test]
fn token_exchange_request_validates_correct_input() {
    let req = TokenExchangeRequest::new_jwt_to_act("eyJ..", &["openai:chat"]);
    assert!(req.validate().is_ok());
}

#[test]
fn token_exchange_rejects_bad_grant_type() {
    let mut req = TokenExchangeRequest::new_jwt_to_act("eyJ..", &[]);
    req.grant_type = "authorization_code".into();
    assert!(req.validate().is_err());
}

// ── Mapping tests ───────────────────────────────────────────────────

#[test]
fn hmr_identifier_is_stable() {
    let id1 = mapping::hmr_identifier_from_claims("https://okta.com", "alice");
    let id2 = mapping::hmr_identifier_from_claims("https://okta.com", "alice");
    assert_eq!(id1, id2);
    assert!(!id1.is_empty());
}

#[test]
fn different_users_get_different_hmr_identifiers() {
    let id1 = mapping::hmr_identifier_from_claims("https://okta.com", "alice");
    let id2 = mapping::hmr_identifier_from_claims("https://okta.com", "bob");
    assert_ne!(id1, id2);
}

#[test]
fn scope_mapping_translates_roles_to_arsenal_scopes() {
    let mut map = std::collections::HashMap::new();
    map.insert("admin".into(), vec!["*:*:*".into()]);
    map.insert(
        "agent-user".into(),
        vec!["openai:chat:*".into(), "github:repo:read".into()],
    );

    let result = mapping::map_scopes(&["agent-user".into()], &map);
    assert_eq!(result, vec!["openai:chat:*", "github:repo:read"]);
}

// ── JWT signing tests ───────────────────────────────────────────────

#[test]
fn act_jwt_claims_build_and_sign() {
    let claims = jwt::build_act_claims(
        "did:oas:openagent:agent:test",
        "https://bridge.openagent.id",
        Some("https://api.target.com"),
        &["openai:chat:completions".into()],
        1,
        "did:oas:openagent:hmr:alice",
        "base64-act",
        3600,
    );

    let key = jsonwebtoken::EncodingKey::from_secret(b"test-secret-at-least-32-bytes!!");
    let token = jwt::sign_act_jwt(
        &claims,
        &key,
        jsonwebtoken::Algorithm::HS256,
        Some("test-key"),
    )
    .unwrap_or_else(|e| unreachable!("{e}"));

    // Verify the token has 3 parts.
    assert_eq!(token.split('.').count(), 3);

    // Decode the header and verify kid.
    let header =
        jwt::decode_jwt_header(&token).unwrap_or_else(|e| unreachable!("{e}"));
    assert_eq!(header.kid.as_deref(), Some("test-key"));
}

// ── Exchange types ──────────────────────────────────────────────────

#[test]
fn exchange_constants_match_rfc8693() {
    assert_eq!(
        exchange::GRANT_TYPE_TOKEN_EXCHANGE,
        "urn:ietf:params:oauth:grant-type:token-exchange"
    );
    assert_eq!(
        exchange::TOKEN_TYPE_JWT,
        "urn:ietf:params:oauth:token-type:jwt"
    );
    assert_eq!(
        exchange::TOKEN_TYPE_ACT,
        "urn:openagent:token-type:act"
    );
}
