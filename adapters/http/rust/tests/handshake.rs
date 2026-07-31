// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! Integration tests: the Core Protocol identity flow against the in-memory
//! server handlers.

// The crate denies unwrap/expect/panic so a production path cannot abort.
// Helper functions in an integration test target are not `#[test]` items, so
// the allow-*-in-tests settings in clippy.toml do not reach them, and
// panicking is how a test failure is reported regardless. Scoped to this
// test-only crate.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use openagent_auth_protocol::error::AuthProtocolError;
use openagent_auth_protocol::handshake;
use openagent_auth_protocol::message::{IdentityProof, KeyType};
use openagent_auth_protocol::session::InMemorySessionStore;

use openagent_http::server::{self, ServerConfig};

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64URL;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};

fn proof_for(
    challenge: &openagent_auth_protocol::message::IdentityChallenge,
    key: &SigningKey,
) -> IdentityProof {
    let payload = handshake::canonical_challenge_bytes(challenge).expect("canonical bytes");
    let signature = key.sign(&payload);
    IdentityProof {
        signature: B64URL.encode(signature.to_bytes()),
        public_key: B64URL.encode(key.verifying_key().to_bytes()),
        key_type: KeyType::Ed25519,
        nonce: challenge.nonce.clone(),
    }
}

#[tokio::test]
async fn full_identity_flow_and_auth_request() {
    let store = InMemorySessionStore::new();
    let config = ServerConfig::new("https://api.example.com");

    let signing_key = SigningKey::generate(&mut rand::thread_rng());

    // Challenge step.
    let challenge = server::handle_challenge(&config, &store)
        .await
        .expect("challenge should issue");
    assert_eq!(challenge.message_type, "openagent-challenge-v1");
    assert_eq!(challenge.origin, "https://api.example.com");
    assert!(handshake::validate_challenge(&challenge).is_ok());

    // Prove step.
    let proof = proof_for(&challenge, &signing_key);
    let verified = server::handle_prove(&config, &store, &proof)
        .await
        .expect("proof should verify");

    assert!(!verified.session_token.is_empty());
    assert_eq!(verified.trust_tier.to_string(), "anonymous");

    // The session token validates an authenticated request.
    let session = server::validate_authenticated_request(&store, &verified.session_token)
        .await
        .expect("session should be valid");
    assert_eq!(
        session.state,
        openagent_auth_protocol::SessionState::Established
    );
}

#[tokio::test]
async fn discovery_returns_correct_document() {
    let config = ServerConfig::new("https://api.example.com");
    let doc = server::handle_discovery(&config);
    assert_eq!(doc.auth_endpoint, handshake::AUTH_ENDPOINT_PATH);
    assert!(doc.supported_versions.contains(&1));
}

#[tokio::test]
async fn prove_rejects_wrong_signature() {
    let store = InMemorySessionStore::new();
    let config = ServerConfig::new("https://api.example.com");

    let challenge = server::handle_challenge(&config, &store)
        .await
        .expect("challenge should issue");

    // Sign with a key that does not match the presented public key.
    let attacker = SigningKey::generate(&mut rand::thread_rng());
    let presented = SigningKey::generate(&mut rand::thread_rng());
    let payload = handshake::canonical_challenge_bytes(&challenge).expect("canonical bytes");
    let proof = IdentityProof {
        signature: B64URL.encode(attacker.sign(&payload).to_bytes()),
        public_key: B64URL.encode(presented.verifying_key().to_bytes()),
        key_type: KeyType::Ed25519,
        nonce: challenge.nonce.clone(),
    };

    let result = server::handle_prove(&config, &store, &proof).await;
    assert!(matches!(
        result,
        Err(AuthProtocolError::SignatureVerificationFailed { .. })
    ));
}

#[tokio::test]
async fn nonce_is_consumed_on_failure_so_retry_is_replay() {
    let store = InMemorySessionStore::new();
    let config = ServerConfig::new("https://api.example.com");

    let signing_key = SigningKey::generate(&mut rand::thread_rng());
    let challenge = server::handle_challenge(&config, &store)
        .await
        .expect("challenge should issue");
    let proof = proof_for(&challenge, &signing_key);

    // Corrupt the signature after construction.
    let mut bad = proof.clone();
    bad.signature = B64URL.encode([0u8; 64]);

    assert!(server::handle_prove(&config, &store, &bad).await.is_err());

    // The SAME nonce cannot be answered again, even with the correct proof.
    let retry = server::handle_prove(&config, &store, &proof).await;
    assert!(matches!(
        retry,
        Err(AuthProtocolError::ReplayDetected { .. })
    ));
}

#[tokio::test]
async fn prove_rejects_nonce_echo_mismatch() {
    let store = InMemorySessionStore::new();
    let config = ServerConfig::new("https://api.example.com");

    let signing_key = SigningKey::generate(&mut rand::thread_rng());
    let challenge = server::handle_challenge(&config, &store)
        .await
        .expect("challenge should issue");

    let mut proof = proof_for(&challenge, &signing_key);
    proof.nonce = "f".repeat(64);

    let result = server::handle_prove(&config, &store, &proof).await;
    assert!(matches!(
        result,
        Err(AuthProtocolError::ReplayDetected { .. })
            | Err(AuthProtocolError::NonceMismatch { .. })
    ));
}

#[tokio::test]
async fn validate_request_rejects_unknown_session() {
    let store = InMemorySessionStore::new();
    let result = server::validate_authenticated_request(&store, "nonexistent").await;
    assert!(matches!(
        result,
        Err(AuthProtocolError::SessionNotFound { .. })
    ));
}
