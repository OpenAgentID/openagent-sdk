//! Error types for `openagent-crypto-wasm`.
//!
//! Every fallible primitive in this crate returns [`CryptoError`]. Variants are
//! designed to be **actionable** — error messages name the operation, the input
//! that failed validation, and (where safe) the underlying reason. Error messages
//! never leak secret material.
//!
//! When compiled to WebAssembly, errors are converted into JavaScript `Error`
//! objects with the same human-readable text via [`crate::wasm_api`].

use thiserror::Error;

/// Errors arising from `openagent-crypto-wasm` primitives.
///
/// Construct via `?` from internal fallible operations. Match on the variant
/// to discriminate failure modes; format with `Display` to surface the message.
#[derive(Debug, Error)]
pub enum CryptoError {
    /// A byte slice did not have the length required by the primitive.
    #[error("invalid byte length for {what}: expected {expected}, got {actual}")]
    InvalidLength {
        /// What was being constructed (e.g. `"Ed25519 signing key"`).
        what: &'static str,
        /// Expected length in bytes.
        expected: usize,
        /// Actual length received.
        actual: usize,
    },

    /// An Ed25519 signature failed verification.
    #[error("Ed25519 signature verification failed: {reason}")]
    SignatureInvalid {
        /// Why verification failed (algorithm-supplied reason).
        reason: String,
    },

    /// An Ed25519 public key could not be constructed from the supplied bytes.
    #[error("invalid Ed25519 public key: {reason}")]
    InvalidPublicKey {
        /// Why the public key was rejected.
        reason: String,
    },

    /// HKDF expansion failed (typically: requested OKM exceeds 255*HashLen).
    #[error("HKDF-SHA256 {stage} failed: {reason}")]
    HkdfFailed {
        /// `"extract"` or `"expand"`.
        stage: &'static str,
        /// Underlying failure reason.
        reason: String,
    },

    /// AEAD encryption or decryption failed (auth tag mismatch or bad input).
    #[error("AEAD {algorithm} {operation} failed: {reason}")]
    AeadFailed {
        /// `"AES-256-GCM"` or `"XChaCha20-Poly1305"`.
        algorithm: &'static str,
        /// `"encrypt"` or `"decrypt"`.
        operation: &'static str,
        /// Underlying failure reason.
        reason: String,
    },

    /// Argon2id password hashing or verification failed.
    #[error("Argon2id {operation} failed: {reason}")]
    PasswordHashFailed {
        /// `"hash"` or `"verify"`.
        operation: &'static str,
        /// Underlying failure reason.
        reason: String,
    },

    /// JCS (RFC 8785) canonicalization failed (typically: invalid JSON input).
    #[error("JCS canonicalization failed: {reason}")]
    JcsFailed {
        /// Underlying failure reason.
        reason: String,
    },

    /// Multibase encoding or decoding failed.
    #[error("multibase {operation} failed: {reason}")]
    MultibaseFailed {
        /// `"encode"` or `"decode"`.
        operation: &'static str,
        /// Underlying failure reason.
        reason: String,
    },

    /// FROST trusted-dealer key generation failed.
    #[error("FROST keygen failed for {min_signers}-of-{max_signers}: {reason}")]
    FrostKeygenFailed {
        /// Threshold `t`.
        min_signers: u16,
        /// Total participants `n`.
        max_signers: u16,
        /// Underlying failure reason.
        reason: String,
    },

    /// FROST round-1 commitment, round-2 share, or aggregation step failed.
    #[error("FROST {stage} failed: {reason}")]
    FrostStageFailed {
        /// One of `"round1"`, `"round2"`, `"aggregate"`, `"verify"`.
        stage: &'static str,
        /// Underlying failure reason.
        reason: String,
    },

    /// FROST participant selection was rejected (wrong count, OOB index, duplicate).
    #[error("FROST participant selection invalid: {reason}")]
    FrostInvalidParticipants {
        /// Why the selection was rejected.
        reason: String,
    },

    /// A serialization/deserialization step failed.
    #[error("serialization failed for {what}: {reason}")]
    SerializationFailed {
        /// What was being (de)serialized.
        what: &'static str,
        /// Underlying failure reason.
        reason: String,
    },

    /// The OS / WASM-host CSPRNG was unavailable or returned an error.
    #[error("system random number generator failed: {reason}")]
    RngFailed {
        /// Underlying failure reason.
        reason: String,
    },
}

impl CryptoError {
    /// Convenience constructor for `InvalidLength` errors.
    #[inline]
    pub(crate) fn invalid_length(what: &'static str, expected: usize, actual: usize) -> Self {
        Self::InvalidLength {
            what,
            expected,
            actual,
        }
    }
}
