// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! Wire message types for the OpenAgent Core Protocol identity flow.
//!
//! These types implement the abstract message model defined **normatively**
//! by the OpenAgent Core Protocol Specification, Section 15
//! (`openagents/openagent.id/OPENAGENT-CORE-SPEC.md`). This crate does not
//! define a protocol; it implements one. If a field here disagrees with the
//! specification, the specification is correct and this file is wrong.
//!
//! The identity flow is three messages:
//!
//! 1. [`IdentityChallenge`] — server issues a cryptographic challenge
//! 2. [`IdentityProof`] — agent proves identity by signing the challenge
//! 3. [`IdentityVerified`] — server confirms identity and issues a session

use serde::{Deserialize, Serialize};

/// The literal `type` value of an [`IdentityChallenge`], per Section 15.2.
pub const CHALLENGE_TYPE: &str = "openagent-challenge-v1";

/// Server → Agent: a cryptographic challenge (Section 15.2).
///
/// The signing payload for the proof is the JCS-canonicalized (RFC 8785)
/// UTF-8 byte representation of this object — no framing, prefix, or
/// envelope. Use [`crate::handshake::canonical_challenge_bytes`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IdentityChallenge {
    /// MUST be the literal string `openagent-challenge-v1`.
    #[serde(rename = "type")]
    pub message_type: String,
    /// 64-character lowercase hexadecimal string (32 CSPRNG bytes).
    pub nonce: String,
    /// ISO 8601 UTC timestamp, `Z` suffix, seconds precision.
    pub timestamp: String,
    /// Server origin per RFC 6454: `scheme://host[:port]`.
    pub origin: String,
    /// Optional protection-space identifier. Omitted entirely when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub realm: Option<String>,
}

impl IdentityChallenge {
    /// Construct a challenge of the current format version.
    pub fn new(nonce: String, timestamp: String, origin: String, realm: Option<String>) -> Self {
        Self {
            message_type: CHALLENGE_TYPE.to_string(),
            nonce,
            timestamp,
            origin,
            realm,
        }
    }
}

/// Signature scheme used for an [`IdentityProof`] (Section 15.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KeyType {
    /// Ed25519 (32-byte public key).
    Ed25519,
    /// secp256k1 (33-byte compressed SEC1 public key).
    Secp256k1,
}

impl std::fmt::Display for KeyType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Ed25519 => write!(f, "ed25519"),
            Self::Secp256k1 => write!(f, "secp256k1"),
        }
    }
}

/// Agent → Server: the cryptographic proof of identity (Section 15.3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IdentityProof {
    /// Base64url (no padding) signature over the JCS-canonicalized challenge
    /// bytes. 64 bytes for both schemes.
    pub signature: String,
    /// Base64url (no padding) raw public key: 32 bytes (Ed25519) or 33 bytes
    /// (secp256k1 compressed).
    pub public_key: String,
    /// The signature scheme.
    pub key_type: KeyType,
    /// The nonce from the challenge, echoed to assist server-side lookup.
    pub nonce: String,
}

/// The resolution tier the server assigns after verification (Section 15.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrustTier {
    /// Identity verified against the presented key only.
    Anonymous,
    /// Identity resolved with additional registry context.
    Identified,
    /// Identity resolved with full lineage authority.
    Sovereign,
}

impl std::fmt::Display for TrustTier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Anonymous => write!(f, "anonymous"),
            Self::Identified => write!(f, "identified"),
            Self::Sovereign => write!(f, "sovereign"),
        }
    }
}

/// Server → Agent: identity confirmed; session issued (Section 15.4).
///
/// The `session_token` replaces further challenge-response cycles until
/// expiry; the agent presents it as a bearer credential (Section 12).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IdentityVerified {
    /// Most specific resolved DID for the agent.
    pub did: String,
    /// The resolution tier assigned by the server.
    pub trust_tier: TrustTier,
    /// JWT session token for subsequent requests.
    pub session_token: String,
    /// ISO 8601 UTC timestamp of session expiry.
    pub session_expires: String,
    /// Granted capability identifiers, populated by Arsenal when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn challenge_serializes_with_type_literal() {
        let challenge = IdentityChallenge::new(
            "a".repeat(64),
            "2026-03-21T12:00:00Z".to_string(),
            "https://api.example.com".to_string(),
            None,
        );
        let json = serde_json::to_string(&challenge).expect("serialize");
        assert!(json.contains(r#""type":"openagent-challenge-v1""#));
        // realm omitted entirely when absent, never null.
        assert!(!json.contains("realm"));
    }

    #[test]
    fn challenge_includes_realm_only_when_present() {
        let challenge = IdentityChallenge::new(
            "a".repeat(64),
            "2026-03-21T12:00:00Z".to_string(),
            "https://api.example.com".to_string(),
            Some("admin".to_string()),
        );
        let json = serde_json::to_string(&challenge).expect("serialize");
        assert!(json.contains(r#""realm":"admin""#));
    }

    #[test]
    fn key_type_uses_spec_spelling() {
        let json = serde_json::to_string(&KeyType::Ed25519).expect("serialize");
        assert_eq!(json, r#""ed25519""#);
        let json = serde_json::to_string(&KeyType::Secp256k1).expect("serialize");
        assert_eq!(json, r#""secp256k1""#);
    }

    #[test]
    fn trust_tier_uses_spec_spelling() {
        let json = serde_json::to_string(&TrustTier::Sovereign).expect("serialize");
        assert_eq!(json, r#""sovereign""#);
    }
}
