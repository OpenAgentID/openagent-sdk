// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//
//! OAAP WebSocket frame types.
//!
//! The 4-step OAAP handshake is mapped to JSON text frames over WebSocket.
//! After the handshake, data flows through `oaap:message` frames that carry
//! either plaintext or AES-256-GCM-encrypted payloads keyed by the ECDH
//! session key.

use serde::{Deserialize, Serialize};

// ── Handshake frames (steps 1-4) ──────────────────────────────────────

/// Step 1: Client presents its DID and ephemeral X25519 public key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresentFrame {
    /// Always `"oaap:present"`.
    #[serde(rename = "type")]
    pub frame_type: String,
    /// The client's `did:oas:*` identifier.
    pub did: String,
    /// Client's ephemeral X25519 public key (hex-encoded, 64 chars).
    pub ephemeral_pub: String,
    /// Client's Ed25519 verifying key (hex-encoded, 64 chars).
    pub verifying_key: String,
    /// ISO-8601 timestamp of when the frame was created.
    pub timestamp: String,
}

/// Step 2: Server responds with its own DID, ephemeral key, and a challenge nonce.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChallengeFrame {
    /// Always `"oaap:challenge"`.
    #[serde(rename = "type")]
    pub frame_type: String,
    /// The server's `did:oas:*` identifier.
    pub did: String,
    /// Server's ephemeral X25519 public key (hex-encoded).
    pub ephemeral_pub: String,
    /// Server's Ed25519 verifying key (hex-encoded).
    pub verifying_key: String,
    /// Random challenge nonce (hex-encoded, 64 chars = 32 bytes).
    pub challenge: String,
    /// ISO-8601 timestamp.
    pub timestamp: String,
}

/// Step 3: Client proves identity by signing the challenge with its Ed25519 key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProveFrame {
    /// Always `"oaap:prove"`.
    #[serde(rename = "type")]
    pub frame_type: String,
    /// Ed25519 signature over the challenge bytes (hex-encoded, 128 chars).
    pub signature: String,
    /// The challenge that was signed (echoed back for binding).
    pub challenge: String,
}

/// Step 4: Server confirms authentication and establishes the session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EstablishedFrame {
    /// Always `"oaap:established"`.
    #[serde(rename = "type")]
    pub frame_type: String,
    /// The unique session identifier (hex-encoded, 32 bytes).
    pub session: String,
    /// Whether the session uses encrypted payloads.
    pub encrypted: bool,
    /// Ed25519 signature from the server over `session || client_ephemeral_pub`
    /// to prove the server is authentic (hex-encoded).
    pub signature: String,
}

// ── Post-handshake data frames ────────────────────────────────────────

/// Data frame sent after authentication is established.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageFrame {
    /// Always `"oaap:message"`.
    #[serde(rename = "type")]
    pub frame_type: String,
    /// Session identifier (hex-encoded).
    pub session: String,
    /// The payload — either plaintext (UTF-8) or base64-encoded ciphertext
    /// depending on whether the session is encrypted.
    pub payload: String,
    /// AES-256-GCM nonce (hex-encoded) — present only when encrypted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nonce: Option<String>,
    /// Monotonically increasing sequence number for replay protection.
    pub seq: u64,
}

// ── Envelope for dispatch ─────────────────────────────────────────────

/// Minimal envelope used to peek at the `type` field before full deserialization.
#[derive(Debug, Deserialize)]
pub(crate) struct TypePeek {
    #[serde(rename = "type")]
    pub frame_type: String,
}

// ── OAAP frame type constants ─────────────────────────────────────────

/// Wire value of the `type` field for [`PresentFrame`] (handshake step 1).
pub const TYPE_PRESENT: &str = "oaap:present";
/// Wire value of the `type` field for [`ChallengeFrame`] (handshake step 2).
pub const TYPE_CHALLENGE: &str = "oaap:challenge";
/// Wire value of the `type` field for [`ProveFrame`] (handshake step 3).
pub const TYPE_PROVE: &str = "oaap:prove";
/// Wire value of the `type` field for [`EstablishedFrame`] (handshake step 4).
pub const TYPE_ESTABLISHED: &str = "oaap:established";
/// Wire value of the `type` field for [`MessageFrame`] (post-handshake data).
pub const TYPE_MESSAGE: &str = "oaap:message";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn present_frame_round_trips_json() {
        let frame = PresentFrame {
            frame_type: TYPE_PRESENT.to_owned(),
            did: "did:oas:l1fe:agent:test".to_owned(),
            ephemeral_pub: "aa".repeat(32),
            verifying_key: "bb".repeat(32),
            timestamp: "2026-04-11T00:00:00Z".to_owned(),
        };
        let json = serde_json::to_string(&frame).unwrap_or_else(|e| unreachable!("{e}"));
        let parsed: PresentFrame =
            serde_json::from_str(&json).unwrap_or_else(|e| unreachable!("{e}"));
        assert_eq!(parsed.frame_type, TYPE_PRESENT);
        assert_eq!(parsed.did, "did:oas:l1fe:agent:test");
    }

    #[test]
    fn message_frame_omits_nonce_when_plaintext() {
        let frame = MessageFrame {
            frame_type: TYPE_MESSAGE.to_owned(),
            session: "cc".repeat(16),
            payload: "hello".to_owned(),
            nonce: None,
            seq: 1,
        };
        let json = serde_json::to_string(&frame).unwrap_or_else(|e| unreachable!("{e}"));
        assert!(!json.contains("nonce"));
    }

    #[test]
    fn message_frame_includes_nonce_when_encrypted() {
        let frame = MessageFrame {
            frame_type: TYPE_MESSAGE.to_owned(),
            session: "cc".repeat(16),
            payload: "ciphertext-base64".to_owned(),
            nonce: Some("dd".repeat(6)),
            seq: 2,
        };
        let json = serde_json::to_string(&frame).unwrap_or_else(|e| unreachable!("{e}"));
        assert!(json.contains("nonce"));
    }

    #[test]
    fn type_peek_extracts_type_field() {
        let raw = r#"{"type":"oaap:present","did":"x","extra":true}"#;
        let peek: TypePeek = serde_json::from_str(raw).unwrap_or_else(|e| unreachable!("{e}"));
        assert_eq!(peek.frame_type, TYPE_PRESENT);
    }
}
