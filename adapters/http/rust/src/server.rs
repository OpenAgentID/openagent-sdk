// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! Framework-agnostic server-side handlers for the OAAP handshake endpoints.
//!
//! These functions handle the core logic for each endpoint. Framework-specific
//! adapters (Axum, Actix, etc.) call these with parsed request bodies and
//! return the responses in their respective formats.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use openagent_auth_protocol::error::AuthProtocolError;
use openagent_auth_protocol::handshake;
use openagent_auth_protocol::message::{ChallengeMessage, EstablishedMessage, PresentMessage, ProveMessage};
use openagent_auth_protocol::session::{Session, SessionState, SessionStore};
use openagent_auth_protocol::types::{ConformanceLevel, DiscoveryDocument};

/// Server configuration for the OAAP HTTP adapter.
#[derive(Debug, Clone)]
pub struct ServerConfig {
    /// The server's DID.
    pub server_did: String,
    /// Required conformance level.
    pub required_conformance: ConformanceLevel,
    /// Session TTL in seconds.
    pub session_ttl_secs: u32,
    /// Challenge expiry in seconds.
    pub challenge_expiry_secs: u32,
}

impl ServerConfig {
    /// Creates a new server configuration with sensible defaults.
    pub fn new(server_did: impl Into<String>) -> Self {
        Self {
            server_did: server_did.into(),
            required_conformance: ConformanceLevel::L2,
            session_ttl_secs: handshake::DEFAULT_SESSION_TTL_SECS,
            challenge_expiry_secs: handshake::DEFAULT_CHALLENGE_EXPIRY_SECS,
        }
    }

    /// Sets the required conformance level.
    pub fn with_conformance(mut self, level: ConformanceLevel) -> Self {
        self.required_conformance = level;
        self
    }

    /// Sets the session TTL.
    pub fn with_session_ttl(mut self, secs: u32) -> Self {
        self.session_ttl_secs = secs;
        self
    }

    /// Sets the challenge expiry.
    pub fn with_challenge_expiry(mut self, secs: u32) -> Self {
        self.challenge_expiry_secs = secs;
        self
    }
}

/// Handle `GET /.well-known/openagent` — returns the discovery document.
pub fn handle_discovery(config: &ServerConfig) -> DiscoveryDocument {
    handshake::build_discovery_document(&config.server_did, config.required_conformance)
}

/// Handle `POST /.well-known/openagent/auth` — Step 1 (PRESENT) -> Step 2 (CHALLENGE).
///
/// Validates the PRESENT message, creates a pending session, and returns a
/// CHALLENGE with a cryptographic nonce.
pub async fn handle_present<S: SessionStore>(
    config: &ServerConfig,
    store: &S,
    msg: PresentMessage,
) -> Result<ChallengeMessage, AuthProtocolError> {
    // Validate the PRESENT message.
    handshake::validate_present(&msg)?;

    // Generate challenge components.
    let session_id = handshake::generate_session_id()?;
    let nonce = handshake::generate_nonce()?;
    let now = chrono::Utc::now();
    let expires_at = now + chrono::Duration::seconds(i64::from(config.challenge_expiry_secs));

    // Create a pending session.
    let session = Session {
        id: session_id.clone(),
        state: SessionState::AwaitingProof,
        initiator_did: msg.did.clone(),
        responder_did: config.server_did.clone(),
        nonce: nonce.clone(),
        created_at: now,
        expires_at,
        capabilities: vec![],
    };
    store.put(session).await?;

    // Build the challenge response.
    let challenge = ChallengeMessage {
        session_id,
        nonce,
        responder_did: config.server_did.clone(),
        responder_ephemeral_public_key: msg.ephemeral_public_key,
        required_conformance_level: Some(config.required_conformance.to_string()),
        expires_at: expires_at.timestamp(),
    };

    Ok(challenge)
}

/// Handle `POST /.well-known/openagent/auth/prove` — Step 3 (PROVE) -> Step 4 (ESTABLISHED).
///
/// Verifies the proof signature, transitions the session to Established,
/// and returns the session parameters.
pub async fn handle_prove<S: SessionStore>(
    config: &ServerConfig,
    store: &S,
    msg: ProveMessage,
    verification_key_bytes: &[u8; 32],
) -> Result<EstablishedMessage, AuthProtocolError> {
    // Look up the pending session.
    let session = store
        .get(&msg.session_id)
        .await?
        .ok_or_else(|| AuthProtocolError::SessionNotFound {
            session_id: msg.session_id.clone(),
        })?;

    // Verify session state.
    if session.state != SessionState::AwaitingProof {
        return Err(AuthProtocolError::SessionNotFound {
            session_id: msg.session_id.clone(),
        });
    }

    // Check expiry.
    if session.is_expired() {
        store.remove(&msg.session_id).await?;
        return Err(AuthProtocolError::SessionExpired {
            session_id: msg.session_id.clone(),
        });
    }

    // Verify the DID matches.
    if session.initiator_did != msg.did {
        return Err(AuthProtocolError::ProofSignatureInvalid {
            reason: format!(
                "DID mismatch: session has {}, prove has {}",
                session.initiator_did, msg.did
            ),
        });
    }

    // Build the expected challenge payload.
    let payload = handshake::build_challenge_payload(
        &session.id,
        &session.nonce,
        &session.initiator_did,
        &session.responder_did,
    );

    // Decode and verify the signature.
    let sig_bytes = B64
        .decode(&msg.signature)
        .map_err(|e| AuthProtocolError::Serialization(format!("invalid signature base64: {e}")))?;

    let vk = VerifyingKey::from_bytes(verification_key_bytes)
        .map_err(|e| AuthProtocolError::Crypto(format!("invalid verification key: {e}")))?;

    let sig_arr: [u8; 64] = sig_bytes.try_into().map_err(|_| {
        AuthProtocolError::ProofSignatureInvalid {
            reason: "signature must be 64 bytes".into(),
        }
    })?;
    let signature = Signature::from_bytes(&sig_arr);

    vk.verify(&payload, &signature).map_err(|e| {
        AuthProtocolError::ProofSignatureInvalid {
            reason: e.to_string(),
        }
    })?;

    // Transition session to Established with full TTL.
    let now = chrono::Utc::now();
    let session_expires = now + chrono::Duration::seconds(i64::from(config.session_ttl_secs));
    let established_session = Session {
        id: session.id.clone(),
        state: SessionState::Established,
        initiator_did: session.initiator_did.clone(),
        responder_did: session.responder_did.clone(),
        nonce: session.nonce.clone(),
        created_at: session.created_at,
        expires_at: session_expires,
        capabilities: session.capabilities.clone(),
    };
    store.put(established_session).await?;

    Ok(EstablishedMessage {
        session_id: session.id,
        expires_at: session_expires.timestamp(),
        capabilities: if session.capabilities.is_empty() {
            None
        } else {
            Some(session.capabilities)
        },
    })
}

/// Validate an authenticated request by checking the session store.
///
/// Looks up the session by `session_id` header, verifies it is established
/// and not expired, and returns the session.
pub async fn validate_authenticated_request<S: SessionStore>(
    store: &S,
    session_id: &str,
) -> Result<Session, AuthProtocolError> {
    let session = store
        .get(session_id)
        .await?
        .ok_or_else(|| AuthProtocolError::SessionNotFound {
            session_id: session_id.to_owned(),
        })?;

    if session.state != SessionState::Established {
        return Err(AuthProtocolError::SessionNotFound {
            session_id: session_id.to_owned(),
        });
    }

    if session.is_expired() {
        store.remove(session_id).await?;
        return Err(AuthProtocolError::SessionExpired {
            session_id: session_id.to_owned(),
        });
    }

    Ok(session)
}
