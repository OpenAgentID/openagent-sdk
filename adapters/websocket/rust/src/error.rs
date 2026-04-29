// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//
//! Error types for the `openagent-ws` WebSocket adapter.

use thiserror::Error;

/// Errors from the OpenAgent WebSocket adapter.
#[derive(Debug, Error)]
pub enum WsError {
    /// The WebSocket connection was closed before the handshake completed.
    #[error("WebSocket closed during OAAP handshake at step {step}")]
    HandshakeClosed {
        /// Which step (1-4) was in progress when the close occurred.
        step: u8,
    },

    /// An unexpected frame type was received during the handshake.
    #[error("unexpected OAAP frame type: expected {expected}, got {actual}")]
    UnexpectedFrameType {
        /// Expected `oaap:*` type.
        expected: &'static str,
        /// Received type string.
        actual: String,
    },

    /// A timeout expired waiting for a handshake response.
    #[error("OAAP handshake timed out at step {step} after {timeout_ms}ms")]
    HandshakeTimeout {
        /// Which step timed out.
        step: u8,
        /// Timeout duration in milliseconds.
        timeout_ms: u64,
    },

    /// JSON serialization or deserialization failed.
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    /// The underlying WebSocket transport returned an error.
    #[error("WebSocket transport error: {0}")]
    Transport(String),

    /// A cryptographic operation failed during handshake or message processing.
    #[error("crypto error: {0}")]
    Crypto(#[from] openagent_crypto_wasm::CryptoError),

    /// Ed25519 signature verification failed on a handshake frame.
    #[error("OAAP authentication failed: {reason}")]
    AuthFailed {
        /// Why authentication was rejected.
        reason: String,
    },

    /// The session has been invalidated or was never established.
    #[error("no active OAAP session")]
    NoSession,

    /// The session ID on an incoming message did not match the established session.
    #[error("session ID mismatch: expected {expected}, got {actual}")]
    SessionMismatch {
        /// Expected session ID (hex).
        expected: String,
        /// Received session ID (hex).
        actual: String,
    },

    /// AEAD decryption of a message payload failed.
    #[error("message decryption failed: {0}")]
    DecryptionFailed(String),
}

impl From<tokio_tungstenite::tungstenite::Error> for WsError {
    fn from(e: tokio_tungstenite::tungstenite::Error) -> Self {
        Self::Transport(e.to_string())
    }
}

/// Convenience alias.
pub type Result<T> = std::result::Result<T, WsError>;
