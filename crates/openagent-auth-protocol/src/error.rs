//! Error types for the OpenAgent Auth Protocol (OAAP).
//!
//! Every fallible operation in this crate returns [`OaapError`]. Variants are
//! designed to be **actionable** — error messages name the operation, the
//! protocol step, and what went wrong.

use thiserror::Error;

/// Errors arising from OAAP handshake operations.
#[derive(Debug, Error)]
pub enum OaapError {
    /// The protocol version in the received message is not supported.
    #[error("unsupported protocol version {received}; this implementation supports version {supported}")]
    UnsupportedVersion {
        /// The version received from the peer.
        received: u8,
        /// The version this implementation supports.
        supported: u8,
    },

    /// A state machine transition was attempted from an invalid state.
    #[error("invalid state transition: cannot move from {from} to {to}")]
    InvalidStateTransition {
        /// The current state.
        from: String,
        /// The attempted target state.
        to: String,
    },

    /// The challenge nonce has expired (anti-replay protection).
    #[error("challenge expired: issued at {issued}, expiry was {expiry}, current time is {now}")]
    ChallengeExpired {
        /// When the challenge was issued.
        issued: String,
        /// When it expired.
        expiry: String,
        /// Current timestamp.
        now: String,
    },

    /// A nonce was reused (replay attack detected).
    #[error("replay detected: nonce {nonce_hex} has already been used in a prior handshake")]
    ReplayDetected {
        /// Hex-encoded nonce that was replayed.
        nonce_hex: String,
    },

    /// Ed25519 signature verification failed during the handshake.
    #[error("signature verification failed at step {step}: {reason}")]
    SignatureVerificationFailed {
        /// Which protocol step (e.g. "PROVE", "ESTABLISHED").
        step: String,
        /// Why verification failed.
        reason: String,
    },

    /// Lineage verification failed for the peer's DID document.
    #[error("lineage verification failed for {did}: {reason}")]
    LineageVerificationFailed {
        /// The DID whose lineage was invalid.
        did: String,
        /// Why lineage was rejected.
        reason: String,
    },

    /// The peer's DID document is structurally invalid or missing required fields.
    #[error("invalid DID document for {did}: {reason}")]
    InvalidDidDocument {
        /// The DID whose document was invalid.
        did: String,
        /// What was wrong.
        reason: String,
    },

    /// A cryptographic operation (ECDH, HKDF, AEAD) failed internally.
    #[error("cryptographic operation failed: {operation} — {reason}")]
    CryptoFailed {
        /// The operation that failed (e.g. "X25519 ECDH", "HKDF-SHA256 expand").
        operation: String,
        /// Underlying reason.
        reason: String,
    },

    /// The transport layer failed to send or receive a message.
    #[error("transport error: {reason}")]
    TransportFailed {
        /// Underlying transport error.
        reason: String,
    },

    /// A timeout occurred waiting for a response from the peer.
    #[error("timeout waiting for {step} response after {timeout_secs}s")]
    Timeout {
        /// Which protocol step timed out.
        step: String,
        /// How long we waited.
        timeout_secs: u64,
    },

    /// Session ID mismatch between sides of the handshake.
    #[error("session ID mismatch: local {local_hex} vs peer {peer_hex}")]
    SessionIdMismatch {
        /// Hex-encoded local session ID.
        local_hex: String,
        /// Hex-encoded peer session ID.
        peer_hex: String,
    },

    /// Serialization or deserialization of a protocol message failed.
    #[error("message serialization failed for {message_type}: {reason}")]
    SerializationFailed {
        /// The message type being (de)serialized.
        message_type: String,
        /// Underlying failure reason.
        reason: String,
    },

    /// The challenge expiry duration exceeds the maximum allowed (5 minutes).
    #[error("challenge expiry {requested_secs}s exceeds maximum allowed {max_secs}s")]
    ExpiryTooLong {
        /// The requested expiry in seconds.
        requested_secs: u64,
        /// The maximum allowed.
        max_secs: u64,
    },
}
