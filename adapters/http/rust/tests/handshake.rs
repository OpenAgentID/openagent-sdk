// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! Integration test: full 4-step handshake via in-memory server and client.

use openagent_auth_protocol::handshake;
use openagent_auth_protocol::message::PresentMessage;
use openagent_auth_protocol::session::InMemorySessionStore;
use openagent_auth_protocol::types::ConformanceLevel;

use openagent_http::server::{self, ServerConfig};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};

/// Full handshake: PRESENT -> CHALLENGE -> PROVE -> ESTABLISHED,
/// then validate an authenticated request.
#[tokio::test]
async fn full_handshake_and_auth_request() {
    let store = InMemorySessionStore::new();
    let config = ServerConfig::new("did:oas:l1fe:service:test");

    // Generate agent identity.
    let signing_key = SigningKey::generate(&mut rand::thread_rng());
    let verifying_key = signing_key.verifying_key();
    let agent_did = "did:oas:l1fe:agent:test-bot";

    // Step 1: PRESENT.
    let present = PresentMessage {
        version: openagent_auth_protocol::PROTOCOL_VERSION,
        did: agent_did.to_owned(),
        did_document: "{}".to_owned(),
        lineage_proof: None,
        ephemeral_public_key: B64.encode([0u8; 32]),
        conformance_level: None,
    };

    // Step 2: CHALLENGE (server handler).
    let challenge = server::handle_present(&config, &store, present)
        .await
        .expect("handle_present should succeed");

    assert!(!challenge.session_id.is_empty());
    assert!(!challenge.nonce.is_empty());
    assert_eq!(challenge.responder_did, "did:oas:l1fe:service:test");

    // Step 3: PROVE — build payload, sign it.
    let payload = handshake::build_challenge_payload(
        &challenge.session_id,
        &challenge.nonce,
        agent_did,
        &challenge.responder_did,
    );

    let signature = signing_key.sign(&payload);
    let prove = openagent_auth_protocol::message::ProveMessage {
        session_id: challenge.session_id.clone(),
        signature: B64.encode(signature.to_bytes()),
        did: agent_did.to_owned(),
    };

    // Step 4: ESTABLISHED (server handler).
    let vk_bytes = verifying_key.to_bytes();
    let established = server::handle_prove(&config, &store, prove, &vk_bytes)
        .await
        .expect("handle_prove should succeed");

    assert_eq!(established.session_id, challenge.session_id);
    assert!(established.expires_at > chrono::Utc::now().timestamp());

    // Now validate an authenticated request.
    let session = server::validate_authenticated_request(&store, &established.session_id)
        .await
        .expect("session should be valid");

    assert_eq!(session.initiator_did, agent_did);
    assert_eq!(session.state, openagent_auth_protocol::SessionState::Established);
}

#[tokio::test]
async fn discovery_returns_correct_document() {
    let config = ServerConfig::new("did:oas:l1fe:service:api")
        .with_conformance(ConformanceLevel::L1);

    let doc = server::handle_discovery(&config);
    assert_eq!(doc.server_did, "did:oas:l1fe:service:api");
    assert_eq!(doc.required_conformance_level, ConformanceLevel::L1);
    assert!(doc.supported_versions.contains(&1));
}

#[tokio::test]
async fn prove_rejects_wrong_signature() {
    let store = InMemorySessionStore::new();
    let config = ServerConfig::new("did:oas:l1fe:service:test");

    let agent_did = "did:oas:l1fe:agent:test-bot";
    let present = PresentMessage {
        version: openagent_auth_protocol::PROTOCOL_VERSION,
        did: agent_did.to_owned(),
        did_document: "{}".to_owned(),
        lineage_proof: None,
        ephemeral_public_key: B64.encode([0u8; 32]),
        conformance_level: None,
    };

    let challenge = server::handle_present(&config, &store, present)
        .await
        .expect("present should succeed");

    // Send a garbage signature.
    let prove = openagent_auth_protocol::message::ProveMessage {
        session_id: challenge.session_id,
        signature: B64.encode([0u8; 64]),
        did: agent_did.to_owned(),
    };

    // Use a real verifying key that won't match the garbage signature.
    let other_key = SigningKey::generate(&mut rand::thread_rng());
    let vk_bytes = other_key.verifying_key().to_bytes();

    let result = server::handle_prove(&config, &store, prove, &vk_bytes).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn validate_request_rejects_unknown_session() {
    let store = InMemorySessionStore::new();
    let result = server::validate_authenticated_request(&store, "nonexistent").await;
    assert!(result.is_err());
}
