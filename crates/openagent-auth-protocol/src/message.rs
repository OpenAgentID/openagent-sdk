// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! Wire message types for the OAAP 4-step handshake.

use serde::{Deserialize, Serialize};

/// Top-level auth protocol message — one of the four handshake steps.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AuthMessage {
    /// Step 1: Initiator presents identity.
    Present(PresentMessage),
    /// Step 2: Responder issues a challenge.
    Challenge(ChallengeMessage),
    /// Step 3: Initiator proves ownership by signing the challenge.
    Prove(ProveMessage),
    /// Step 4: Session established.
    Established(EstablishedMessage),
}

/// Step 1 — Initiator presents its DID, lineage proof, and an ephemeral key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresentMessage {
    /// Protocol version (must be [`crate::PROTOCOL_VERSION`]).
    pub version: u32,
    /// The initiator's DID (e.g. `did:oas:...`).
    pub did: String,
    /// Serialized DID document (JSON).
    pub did_document: String,
    /// Lineage proof chain from agent back to its HMR (JSON array of signed proofs).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lineage_proof: Option<String>,
    /// Base64-encoded Ed25519 ephemeral public key for this handshake.
    pub ephemeral_public_key: String,
    /// Optional conformance level the initiator claims.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conformance_level: Option<String>,
}

/// Step 2 — Responder sends a nonce challenge plus its own identity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChallengeMessage {
    /// Server-assigned session ID for correlating PROVE and ESTABLISHED.
    pub session_id: String,
    /// 32-byte base64-encoded random nonce.
    pub nonce: String,
    /// The responder's DID.
    pub responder_did: String,
    /// Base64-encoded Ed25519 ephemeral public key for the responder side.
    pub responder_ephemeral_public_key: String,
    /// Conformance level the responder requires.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required_conformance_level: Option<String>,
    /// Unix timestamp (seconds) when the challenge expires.
    pub expires_at: i64,
}

/// Step 3 — Initiator proves ownership of the DID private key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProveMessage {
    /// Session ID from the CHALLENGE step.
    pub session_id: String,
    /// Base64-encoded signature over the canonical challenge payload:
    /// `BLAKE3(session_id || nonce || initiator_did || responder_did)`.
    pub signature: String,
    /// The initiator's DID (for verification key lookup).
    pub did: String,
}

/// Step 4 — Handshake complete; session parameters are conveyed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EstablishedMessage {
    /// Session ID — use as `x-openagent-session` header / metadata.
    pub session_id: String,
    /// Unix timestamp (seconds) when the session expires.
    pub expires_at: i64,
    /// Optional session-scoped capabilities granted to the initiator.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,
}

impl AuthMessage {
    /// Returns a human-readable label for the message step.
    pub fn step_name(&self) -> &'static str {
        match self {
            Self::Present(_) => "present",
            Self::Challenge(_) => "challenge",
            Self::Prove(_) => "prove",
            Self::Established(_) => "established",
        }
    }
}
