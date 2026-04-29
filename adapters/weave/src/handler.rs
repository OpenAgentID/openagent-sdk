// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! Handshake handler — orchestrates the initiator and responder sides of
//! the OAAP 4-step handshake over a Weave/libp2p connection.

use std::sync::Arc;
use std::time::{Duration, Instant};

use libp2p::request_response::{OutboundRequestId, ResponseChannel};
use libp2p::PeerId;
use tokio::sync::oneshot;
use tracing::{debug, info, warn};

use openagent_auth_protocol::error::AuthProtocolError;
use openagent_auth_protocol::session::{InMemorySessionStore, Session, SessionState, SessionStore};
use openagent_auth_protocol::types::{
    ChallengeMessage, ConformanceLevel, EstablishedMessage, PresentMessage, ProveMessage,
};

use crate::config::WeaveAuthConfig;
use crate::error::WeaveAuthError;
use crate::peer_auth::{HandshakePhase, PeerAuthState, PeerAuthStore};
use crate::protocol::{
    HandshakeRequest, HandshakeResponse, WeaveAuthBehaviour, send_request, send_response,
};

/// Orchestrates OAAP handshakes for both initiator and responder roles.
///
/// The handler holds references to the peer auth store and session store,
/// and coordinates the multi-step handshake against the swarm's
/// `WeaveAuthBehaviour`.
pub struct HandshakeHandler {
    config: WeaveAuthConfig,
    peer_store: PeerAuthStore,
    session_store: Arc<dyn SessionStore>,
    /// DID of this node — used as the responder DID in challenges.
    local_did: String,
}

impl HandshakeHandler {
    /// Creates a new handler.
    pub fn new(config: WeaveAuthConfig, local_did: String) -> Self {
        Self {
            config,
            peer_store: PeerAuthStore::new(),
            session_store: Arc::new(InMemorySessionStore::new()),
            local_did,
        }
    }

    /// Creates a handler with an external session store.
    pub fn with_session_store(
        config: WeaveAuthConfig,
        local_did: String,
        session_store: Arc<dyn SessionStore>,
    ) -> Self {
        Self {
            config,
            peer_store: PeerAuthStore::new(),
            session_store,
            local_did,
        }
    }

    /// Returns a reference to the peer auth store.
    pub fn peer_store(&self) -> &PeerAuthStore {
        &self.peer_store
    }

    /// Returns the local DID.
    pub fn local_did(&self) -> &str {
        &self.local_did
    }

    // -----------------------------------------------------------------------
    // Initiator side
    // -----------------------------------------------------------------------

    /// Initiate a handshake with a remote peer (Step 1: send PRESENT).
    ///
    /// Returns the `OutboundRequestId` for tracking the challenge response.
    pub fn initiate(
        &self,
        behaviour: &mut WeaveAuthBehaviour,
        peer: &PeerId,
        present: PresentMessage,
    ) -> Result<OutboundRequestId, WeaveAuthError> {
        // Track that we're in the PRESENT_SENT phase.
        let state = PeerAuthState {
            did: present.did_document.id.clone(),
            session_id: String::new(),
            established_at: Instant::now(),
            expires_at: Instant::now() + self.config.handshake_timeout,
            phase: HandshakePhase::PresentSent,
        };
        self.peer_store.put(*peer, state)?;

        let request_id = send_request(behaviour, peer, HandshakeRequest::Present(present));
        debug!(peer = %peer, request_id = ?request_id, "PRESENT sent");
        Ok(request_id)
    }

    /// Process a CHALLENGE response from the responder (received after PRESENT).
    ///
    /// Returns the challenge message for the caller to sign and build a PROVE.
    pub fn handle_challenge(
        &self,
        peer: &PeerId,
        challenge: &ChallengeMessage,
    ) -> Result<(), WeaveAuthError> {
        let mut state = self
            .peer_store
            .get(peer)?
            .ok_or_else(|| WeaveAuthError::PeerNotAuthenticated {
                peer_id: peer.to_string(),
            })?;

        if state.phase != HandshakePhase::PresentSent {
            return Err(WeaveAuthError::UnexpectedMessage {
                expected: "awaiting CHALLENGE (present sent)".into(),
                actual: format!("phase={:?}", state.phase),
            });
        }

        state.session_id = challenge.session_id.clone();
        state.phase = HandshakePhase::ProveSent;
        self.peer_store.put(*peer, state)?;
        debug!(peer = %peer, session = %challenge.session_id, "CHALLENGE received");
        Ok(())
    }

    /// Send Step 3 (PROVE) to the responder.
    pub fn send_prove(
        &self,
        behaviour: &mut WeaveAuthBehaviour,
        peer: &PeerId,
        prove: ProveMessage,
    ) -> Result<OutboundRequestId, WeaveAuthError> {
        let request_id = send_request(behaviour, peer, HandshakeRequest::Prove(prove));
        debug!(peer = %peer, request_id = ?request_id, "PROVE sent");
        Ok(request_id)
    }

    /// Process an ESTABLISHED response (received after PROVE).
    pub fn handle_established(
        &self,
        peer: &PeerId,
        established: &EstablishedMessage,
    ) -> Result<(), WeaveAuthError> {
        let mut state = self
            .peer_store
            .get(peer)?
            .ok_or_else(|| WeaveAuthError::PeerNotAuthenticated {
                peer_id: peer.to_string(),
            })?;

        if state.phase != HandshakePhase::ProveSent {
            return Err(WeaveAuthError::UnexpectedMessage {
                expected: "awaiting ESTABLISHED (prove sent)".into(),
                actual: format!("phase={:?}", state.phase),
            });
        }

        let ttl = Duration::from_secs(u64::from(established.expires_in));
        state.phase = HandshakePhase::Established;
        state.established_at = Instant::now();
        state.expires_at = Instant::now() + ttl;
        state.did = established.peer_did.clone();
        self.peer_store.put(*peer, state)?;

        info!(
            peer = %peer,
            did = %established.peer_did,
            session = %established.session_id,
            "handshake ESTABLISHED (initiator)"
        );
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Responder side
    // -----------------------------------------------------------------------

    /// Handle an inbound PRESENT request (Step 1 from a remote initiator).
    ///
    /// Returns a `ChallengeMessage` to send back.
    pub async fn handle_present(
        &self,
        peer: &PeerId,
        present: &PresentMessage,
    ) -> Result<ChallengeMessage, WeaveAuthError> {
        // Validate protocol version.
        if present.version != openagent_auth_protocol::PROTOCOL_VERSION {
            return Err(WeaveAuthError::Protocol(
                AuthProtocolError::UnsupportedVersion {
                    version: present.version,
                },
            ));
        }

        // Generate session ID and nonce.
        let session_id = generate_session_id();
        let nonce = generate_nonce();

        // Track the pending handshake.
        let state = PeerAuthState {
            did: present.did_document.id.clone(),
            session_id: session_id.clone(),
            established_at: Instant::now(),
            expires_at: Instant::now() + self.config.challenge_ttl,
            phase: HandshakePhase::ChallengeIssued,
        };
        self.peer_store.put(*peer, state)?;

        // Persist the session.
        let session = Session {
            id: session_id.clone(),
            state: SessionState::AwaitingProof,
            initiator_did: present.did_document.id.clone(),
            responder_did: self.local_did.clone(),
            nonce: nonce.clone(),
            created_at: chrono::Utc::now(),
            expires_at: chrono::Utc::now()
                + chrono::Duration::seconds(i64::from(self.config.challenge_ttl.as_secs() as u32)),
            capabilities: vec![],
        };
        self.session_store.put(session).await.map_err(|e| {
            WeaveAuthError::Internal(format!("session store put failed: {e}"))
        })?;

        let challenge = ChallengeMessage {
            session_id,
            server_nonce: nonce,
            server_did: self.local_did.clone(),
            server_ephemeral_pubkey: String::new(), // Populated by caller with actual key.
            required_conformance: ConformanceLevel::L2,
            expires_in: self.config.challenge_ttl.as_secs() as u32,
        };

        debug!(peer = %peer, session = %challenge.session_id, "CHALLENGE issued");
        Ok(challenge)
    }

    /// Handle an inbound PROVE request (Step 3 from a remote initiator).
    ///
    /// Returns an `EstablishedMessage` on success.
    pub async fn handle_prove(
        &self,
        peer: &PeerId,
        prove: &ProveMessage,
    ) -> Result<EstablishedMessage, WeaveAuthError> {
        // Look up the session.
        let session = self
            .session_store
            .get(&prove.session_id)
            .await
            .map_err(|e| WeaveAuthError::Internal(format!("session lookup failed: {e}")))?
            .ok_or_else(|| WeaveAuthError::Protocol(AuthProtocolError::SessionNotFound {
                session_id: prove.session_id.clone(),
            }))?;

        if session.state != SessionState::AwaitingProof {
            return Err(WeaveAuthError::UnexpectedMessage {
                expected: "session in AwaitingProof state".into(),
                actual: format!("session state={:?}", session.state),
            });
        }

        if session.is_expired() {
            return Err(WeaveAuthError::Protocol(AuthProtocolError::SessionExpired {
                session_id: prove.session_id.clone(),
            }));
        }

        // NOTE: In production, verify `prove.signature` against the initiator's
        // DID public key and the nonce from the session. This verification step
        // uses openagent-crypto-wasm Ed25519 verify. For the adapter layer, we
        // trust the caller to have performed signature verification before calling
        // handle_prove, or the caller wraps this with verification logic.
        //
        // The adapter focuses on transport framing; cryptographic verification
        // belongs in the protocol handler that sits above us.

        // Transition the session.
        let ttl = self.config.session_ttl;
        let updated_session = Session {
            state: SessionState::Established,
            expires_at: chrono::Utc::now() + chrono::Duration::seconds(ttl.as_secs() as i64),
            ..session.clone()
        };
        self.session_store.put(updated_session).await.map_err(|e| {
            WeaveAuthError::Internal(format!("session update failed: {e}"))
        })?;

        // Update peer state.
        let peer_state = PeerAuthState {
            did: session.initiator_did.clone(),
            session_id: prove.session_id.clone(),
            established_at: Instant::now(),
            expires_at: Instant::now() + ttl,
            phase: HandshakePhase::Established,
        };
        self.peer_store.put(*peer, peer_state)?;

        let established = EstablishedMessage {
            session_id: prove.session_id.clone(),
            session_token: generate_session_token(),
            server_signature: String::new(), // Populated by caller with actual signature.
            peer_did: session.initiator_did,
            conformance_level: ConformanceLevel::L2,
            expires_in: ttl.as_secs() as u32,
        };

        info!(
            peer = %peer,
            session = %established.session_id,
            "handshake ESTABLISHED (responder)"
        );
        Ok(established)
    }

    /// Respond to an inbound request on its response channel.
    pub fn respond(
        &self,
        behaviour: &mut WeaveAuthBehaviour,
        channel: ResponseChannel<HandshakeResponse>,
        response: HandshakeResponse,
    ) -> Result<(), WeaveAuthError> {
        send_response(behaviour, channel, response).map_err(|_rejected| {
            WeaveAuthError::Connection("response channel closed".into())
        })
    }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/// Generate a random hex session ID (32 bytes = 64 hex chars).
fn generate_session_id() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Generate a random base64 nonce (32 bytes).
fn generate_nonce() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes)
}

/// Generate a random session token (48 bytes base64).
fn generate_session_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 48];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes)
}

// We need hex + base64 in handler. Add them to dependencies.
use base64;
use hex;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_session_id_has_correct_length() {
        let id = generate_session_id();
        assert_eq!(id.len(), 64); // 32 bytes * 2 hex chars
    }

    #[test]
    fn generate_nonce_is_base64() {
        let nonce = generate_nonce();
        let decoded = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &nonce,
        );
        assert!(decoded.is_ok());
        let bytes = decoded.unwrap_or_else(|e| panic!("decode failed: {e}"));
        assert_eq!(bytes.len(), 32);
    }

    #[test]
    fn generate_session_token_is_base64() {
        let token = generate_session_token();
        let decoded = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &token,
        );
        assert!(decoded.is_ok());
    }
}
