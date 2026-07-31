//! Error types for the OpenAgent Core Protocol identity flow.
//!
//! Every fallible operation in this crate returns [`AuthProtocolError`].
//! Variants are designed to be **actionable** — error messages name the
//! operation, the field, and what went wrong.
//!
//! # History
//!
//! This crate previously carried two error enums (`AuthProtocolError` and
//! `OaapError`) that disagreed with each other — which is part of how the
//! crate came to not compile. There is one now.

use thiserror::Error;

/// Errors arising from Core Protocol handshake operations.
#[derive(Debug, Error)]
pub enum AuthProtocolError {
    /// The protocol version in the received message is not supported.
    #[error(
        "unsupported protocol version {received}; this implementation supports version {supported}"
    )]
    UnsupportedVersion {
        /// The version received from the peer.
        received: u8,
        /// The version this implementation supports.
        supported: u8,
    },

    /// A challenge failed the Section 4 field constraints.
    #[error("invalid challenge: {reason}")]
    InvalidChallenge {
        /// What constraint failed.
        reason: String,
    },

    /// A proof failed the Section 15.3 shape checks.
    #[error("invalid proof: {reason}")]
    InvalidProof {
        /// What constraint failed.
        reason: String,
    },

    /// The nonce echoed in the proof does not match the challenge.
    #[error("nonce mismatch: challenge carried {expected}, proof echoed {received}")]
    NonceMismatch {
        /// The nonce in the challenge.
        expected: String,
        /// The nonce echoed in the proof.
        received: String,
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

    /// Signature verification failed against the trusted key set.
    #[error("signature verification failed: {reason}")]
    SignatureVerificationFailed {
        /// Why verification failed.
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

    /// Serialization or deserialization of a protocol message failed.
    #[error("message serialization failed for {message_type}: {reason}")]
    SerializationFailed {
        /// The message type being (de)serialized.
        message_type: String,
        /// Underlying failure reason.
        reason: String,
    },

    /// The challenge expiry duration exceeds the maximum allowed (300 seconds,
    /// per Section 7 of the Core Protocol Specification).
    #[error("challenge expiry {requested_secs}s exceeds maximum allowed {max_secs}s")]
    ExpiryTooLong {
        /// The requested expiry in seconds.
        requested_secs: u64,
        /// The maximum allowed.
        max_secs: u64,
    },

    /// An internal failure that is not the peer's fault (e.g. a poisoned
    /// lock in a session store). Surfaced rather than panicked, per the
    /// workspace no-panic policy.
    #[error("internal error: {0}")]
    Internal(String),

    /// A presented session token does not identify a live session.
    #[error("session not found: {session_id}")]
    SessionNotFound {
        /// The token or identifier presented.
        session_id: String,
    },

    /// A session exists but has expired and was removed.
    #[error("session expired: {session_id}")]
    SessionExpired {
        /// The token or identifier presented.
        session_id: String,
    },
}
