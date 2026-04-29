// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! Error types for the Weave auth adapter.

use thiserror::Error;

/// Errors specific to the Weave/libp2p OAAP adapter.
#[derive(Debug, Error)]
pub enum WeaveAuthError {
    /// CBOR encoding or decoding failed.
    #[error("cbor codec error: {0}")]
    Codec(String),

    /// Message exceeds the configured maximum frame size.
    #[error("message too large: {size} bytes exceeds limit of {limit} bytes")]
    MessageTooLarge {
        /// Actual message size in bytes.
        size: usize,
        /// Configured maximum.
        limit: usize,
    },

    /// No established auth session for the given peer.
    #[error("peer not authenticated: {peer_id}")]
    PeerNotAuthenticated {
        /// The libp2p peer ID.
        peer_id: String,
    },

    /// A handshake is already in progress for this peer.
    #[error("handshake already in progress for peer: {peer_id}")]
    HandshakeInProgress {
        /// The libp2p peer ID.
        peer_id: String,
    },

    /// The handshake timed out waiting for a response.
    #[error("handshake timeout after {elapsed_ms}ms")]
    Timeout {
        /// Milliseconds elapsed before timeout.
        elapsed_ms: u64,
    },

    /// Received an unexpected message type for the current handshake state.
    #[error("unexpected message: expected {expected}, got {actual}")]
    UnexpectedMessage {
        /// What was expected.
        expected: String,
        /// What was received.
        actual: String,
    },

    /// Error from the underlying OAAP protocol layer.
    #[error("auth protocol error: {0}")]
    Protocol(#[from] openagent_auth_protocol::AuthProtocolError),

    /// libp2p dial or connection error.
    #[error("connection error: {0}")]
    Connection(String),

    /// Internal error.
    #[error("internal error: {0}")]
    Internal(String),
}

impl From<ciborium::ser::Error<std::io::Error>> for WeaveAuthError {
    fn from(err: ciborium::ser::Error<std::io::Error>) -> Self {
        Self::Codec(format!("cbor serialize: {err}"))
    }
}

impl From<ciborium::de::Error<std::io::Error>> for WeaveAuthError {
    fn from(err: ciborium::de::Error<std::io::Error>) -> Self {
        Self::Codec(format!("cbor deserialize: {err}"))
    }
}
