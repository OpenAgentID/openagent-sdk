// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! `AuthTransport` implementation for Weave/libp2p.
//!
//! [`WeaveTransport`] bridges the OAAP transport-agnostic trait into the
//! libp2p swarm's request-response mechanism. It holds a handle to the swarm
//! via a command channel and translates `present`/`prove` calls into requests
//! sent through the behaviour.

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use libp2p::PeerId;
use tokio::sync::{mpsc, oneshot, Mutex};
use tracing::{debug, warn};

use openagent_auth_protocol::error::AuthProtocolError;
use openagent_auth_protocol::transport::AuthTransport;
use openagent_auth_protocol::types::{
    ChallengeMessage, EstablishedMessage, PresentMessage, ProveMessage,
};

use crate::config::WeaveAuthConfig;
use crate::error::WeaveAuthError;
use crate::peer_auth::PeerAuthStore;
use crate::protocol::{HandshakeRequest, HandshakeResponse};

/// A command sent from [`WeaveTransport`] to the swarm event loop.
#[derive(Debug)]
pub enum TransportCommand {
    /// Send a request to a peer and receive the response asynchronously.
    SendRequest {
        /// Target peer.
        peer: PeerId,
        /// The handshake request to send.
        request: HandshakeRequest,
        /// Channel to receive the response.
        reply: oneshot::Sender<Result<HandshakeResponse, WeaveAuthError>>,
    },
}

/// `AuthTransport` implementation for Weave/libp2p.
///
/// The transport sends commands through a channel that the swarm event loop
/// consumes. This decouples the async transport API from the swarm poll loop.
///
/// # Usage
///
/// ```ignore
/// use openagent_weave::{WeaveTransport, WeaveAuthConfig};
///
/// let (tx, rx) = tokio::sync::mpsc::channel(64);
/// let transport = WeaveTransport::new(config, tx, peer_store);
///
/// // In the swarm loop, consume `rx` and call the behaviour.
/// ```
pub struct WeaveTransport {
    config: WeaveAuthConfig,
    command_tx: mpsc::Sender<TransportCommand>,
    peer_store: PeerAuthStore,
    /// Resolve a DID or endpoint string to a libp2p PeerId.
    /// In the Weave network, endpoint strings are PeerId base58 strings.
    peer_resolver: Arc<Mutex<HashMap<String, PeerId>>>,
}

impl WeaveTransport {
    /// Creates a new Weave transport.
    pub fn new(
        config: WeaveAuthConfig,
        command_tx: mpsc::Sender<TransportCommand>,
        peer_store: PeerAuthStore,
    ) -> Self {
        Self {
            config,
            command_tx,
            peer_store,
            peer_resolver: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Register a mapping from an endpoint/DID string to a libp2p `PeerId`.
    ///
    /// The `present` and `prove` methods accept an `endpoint` parameter. For
    /// Weave, this should be the peer's base58 PeerId or DID string. Register
    /// the mapping here so the transport knows where to route.
    pub async fn register_peer(&self, endpoint: &str, peer: PeerId) {
        let mut resolver = self.peer_resolver.lock().await;
        resolver.insert(endpoint.to_string(), peer);
    }

    /// Returns the peer auth store.
    pub fn peer_store(&self) -> &PeerAuthStore {
        &self.peer_store
    }

    /// Resolve an endpoint string to a PeerId.
    async fn resolve_peer(&self, endpoint: &str) -> Result<PeerId, AuthProtocolError> {
        // Try parsing as a PeerId directly.
        if let Ok(peer) = endpoint.parse::<PeerId>() {
            return Ok(peer);
        }

        // Try the registered resolver.
        let resolver = self.peer_resolver.lock().await;
        resolver.get(endpoint).copied().ok_or_else(|| {
            AuthProtocolError::Transport(format!(
                "cannot resolve endpoint to PeerId: {endpoint}"
            ))
        })
    }

    /// Send a handshake request and wait for the response.
    async fn send_and_wait(
        &self,
        peer: PeerId,
        request: HandshakeRequest,
    ) -> Result<HandshakeResponse, AuthProtocolError> {
        let (reply_tx, reply_rx) = oneshot::channel();

        self.command_tx
            .send(TransportCommand::SendRequest {
                peer,
                request,
                reply: reply_tx,
            })
            .await
            .map_err(|_| {
                AuthProtocolError::Transport("swarm command channel closed".into())
            })?;

        let timeout = self.config.handshake_timeout;
        match tokio::time::timeout(timeout, reply_rx).await {
            Ok(Ok(Ok(response))) => Ok(response),
            Ok(Ok(Err(e))) => Err(AuthProtocolError::Transport(format!("weave error: {e}"))),
            Ok(Err(_)) => Err(AuthProtocolError::Transport("response channel dropped".into())),
            Err(_) => Err(AuthProtocolError::Transport(format!(
                "handshake timeout after {}ms",
                timeout.as_millis()
            ))),
        }
    }
}

#[async_trait]
impl AuthTransport for WeaveTransport {
    /// Send PRESENT (Step 1) and receive CHALLENGE (Step 2).
    async fn present(
        &self,
        endpoint: &str,
        message: &PresentMessage,
    ) -> Result<ChallengeMessage, AuthProtocolError> {
        let peer = self.resolve_peer(endpoint).await?;
        debug!(peer = %peer, did = %message.did_document.id, "sending PRESENT");

        let response = self
            .send_and_wait(peer, HandshakeRequest::Present(message.clone()))
            .await?;

        match response {
            HandshakeResponse::Challenge(challenge) => Ok(challenge),
            HandshakeResponse::Error { code, reason } => {
                warn!(peer = %peer, code = %code, reason = %reason, "PRESENT rejected");
                Err(AuthProtocolError::Transport(format!(
                    "PRESENT rejected: [{code}] {reason}"
                )))
            }
            other => Err(AuthProtocolError::Transport(format!(
                "expected CHALLENGE, got {:?}",
                std::mem::discriminant(&other)
            ))),
        }
    }

    /// Send PROVE (Step 3) and receive ESTABLISHED (Step 4).
    async fn prove(
        &self,
        endpoint: &str,
        message: &ProveMessage,
    ) -> Result<EstablishedMessage, AuthProtocolError> {
        let peer = self.resolve_peer(endpoint).await?;
        debug!(peer = %peer, session = %message.session_id, "sending PROVE");

        let response = self
            .send_and_wait(peer, HandshakeRequest::Prove(message.clone()))
            .await?;

        match response {
            HandshakeResponse::Established(established) => Ok(established),
            HandshakeResponse::Error { code, reason } => {
                warn!(peer = %peer, code = %code, reason = %reason, "PROVE rejected");
                Err(AuthProtocolError::Transport(format!(
                    "PROVE rejected: [{code}] {reason}"
                )))
            }
            other => Err(AuthProtocolError::Transport(format!(
                "expected ESTABLISHED, got {:?}",
                std::mem::discriminant(&other)
            ))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn resolve_peer_from_registered_mapping() {
        let (tx, _rx) = mpsc::channel(16);
        let transport = WeaveTransport::new(
            WeaveAuthConfig::default(),
            tx,
            PeerAuthStore::new(),
        );

        let peer = PeerId::random();
        transport.register_peer("did:oas:test:agent:alice", peer).await;

        let resolved = transport.resolve_peer("did:oas:test:agent:alice").await;
        assert!(resolved.is_ok());
        assert_eq!(resolved.unwrap_or_else(|e| panic!("{e}")), peer);
    }

    #[tokio::test]
    async fn resolve_peer_from_peer_id_string() {
        let (tx, _rx) = mpsc::channel(16);
        let transport = WeaveTransport::new(
            WeaveAuthConfig::default(),
            tx,
            PeerAuthStore::new(),
        );

        let peer = PeerId::random();
        let peer_str = peer.to_string();
        let resolved = transport.resolve_peer(&peer_str).await;
        assert!(resolved.is_ok());
        assert_eq!(resolved.unwrap_or_else(|e| panic!("{e}")), peer);
    }

    #[tokio::test]
    async fn resolve_peer_unknown_returns_error() {
        let (tx, _rx) = mpsc::channel(16);
        let transport = WeaveTransport::new(
            WeaveAuthConfig::default(),
            tx,
            PeerAuthStore::new(),
        );

        let result = transport.resolve_peer("unknown-endpoint").await;
        assert!(result.is_err());
    }
}
