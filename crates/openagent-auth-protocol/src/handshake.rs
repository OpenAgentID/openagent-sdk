// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! Core handshake logic for both initiator and responder sides.
//!
//! This module provides the cryptographic operations common to all transports:
//! nonce generation, challenge construction, signature creation/verification,
//! and session token derivation.

use crate::error::AuthProtocolError;
use crate::message::PresentMessage;
use crate::types::{ConformanceLevel, DiscoveryDocument};

/// Default session TTL in seconds (5 minutes).
pub const DEFAULT_SESSION_TTL_SECS: u32 = 300;

/// Default challenge expiry in seconds (60 seconds).
pub const DEFAULT_CHALLENGE_EXPIRY_SECS: u32 = 60;

/// Well-known path for discovery.
pub const WELL_KNOWN_PATH: &str = "/.well-known/openagent";

/// Well-known path for the auth endpoint.
pub const AUTH_ENDPOINT_PATH: &str = "/.well-known/openagent/auth";

/// Well-known path for the prove endpoint.
pub const PROVE_ENDPOINT_PATH: &str = "/.well-known/openagent/auth/prove";

/// Generate a cryptographically random nonce (32 bytes, base64-encoded).
pub fn generate_nonce() -> Result<String, AuthProtocolError> {
    use base64::Engine;
    let mut buf = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut buf);
    Ok(base64::engine::general_purpose::STANDARD.encode(buf))
}

/// Generate a session ID (24 bytes, base64-encoded).
pub fn generate_session_id() -> Result<String, AuthProtocolError> {
    use base64::Engine;
    let mut buf = [0u8; 24];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut buf);
    Ok(base64::engine::general_purpose::STANDARD.encode(buf))
}

/// Build the challenge payload that is signed in the PROVE step.
///
/// `BLAKE3(session_id || nonce || initiator_did || responder_did)`
pub fn build_challenge_payload(
    session_id: &str,
    nonce: &str,
    initiator_did: &str,
    responder_did: &str,
) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(session_id.as_bytes());
    hasher.update(nonce.as_bytes());
    hasher.update(initiator_did.as_bytes());
    hasher.update(responder_did.as_bytes());
    *hasher.finalize().as_bytes()
}

/// Validate a PRESENT message (responder side).
///
/// Checks protocol version and basic structural validity. Does NOT verify
/// the lineage proof cryptographically.
pub fn validate_present(msg: &PresentMessage) -> Result<(), AuthProtocolError> {
    use base64::Engine;
    if msg.version != crate::PROTOCOL_VERSION {
        return Err(AuthProtocolError::UnsupportedVersion {
            version: msg.version,
        });
    }
    if msg.did.is_empty() {
        return Err(AuthProtocolError::InvalidDidDocument {
            reason: "DID is empty".into(),
        });
    }
    if !msg.did.starts_with("did:") {
        return Err(AuthProtocolError::InvalidDidDocument {
            reason: format!("DID does not start with 'did:': {}", msg.did),
        });
    }
    if msg.ephemeral_public_key.is_empty() {
        return Err(AuthProtocolError::InvalidEphemeralKey {
            reason: "ephemeral_public_key is empty".into(),
        });
    }
    // Verify ephemeral key is valid base64.
    base64::engine::general_purpose::STANDARD
        .decode(&msg.ephemeral_public_key)
        .map_err(|e| AuthProtocolError::InvalidEphemeralKey {
            reason: format!("ephemeral_public_key is not valid base64: {e}"),
        })?;
    Ok(())
}

/// Build a default discovery document for a server.
pub fn build_discovery_document(
    server_did: &str,
    required_conformance: ConformanceLevel,
) -> DiscoveryDocument {
    DiscoveryDocument {
        auth_endpoint: AUTH_ENDPOINT_PATH.to_owned(),
        supported_versions: vec![crate::PROTOCOL_VERSION],
        server_did: server_did.to_owned(),
        required_conformance_level: required_conformance,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    #[test]
    fn generate_nonce_returns_base64() {
        let nonce = generate_nonce();
        assert!(nonce.is_ok());
        let decoded = base64::engine::general_purpose::STANDARD.decode(nonce.unwrap_or_default());
        assert!(decoded.is_ok());
        assert_eq!(decoded.map(|v| v.len()), Ok(32));
    }

    #[test]
    fn generate_session_id_returns_base64() {
        let sid = generate_session_id();
        assert!(sid.is_ok());
        let decoded = base64::engine::general_purpose::STANDARD.decode(sid.unwrap_or_default());
        assert!(decoded.is_ok());
        assert_eq!(decoded.map(|v| v.len()), Ok(24));
    }

    #[test]
    fn challenge_payload_is_deterministic() {
        let a = build_challenge_payload("s1", "n1", "did:a", "did:b");
        let b = build_challenge_payload("s1", "n1", "did:a", "did:b");
        assert_eq!(a, b);
    }

    #[test]
    fn challenge_payload_differs_on_input_change() {
        let a = build_challenge_payload("s1", "n1", "did:a", "did:b");
        let b = build_challenge_payload("s1", "n2", "did:a", "did:b");
        assert_ne!(a, b);
    }

    #[test]
    fn validate_present_rejects_bad_version() {
        let msg = PresentMessage {
            version: 99,
            did: "did:oas:l1fe:agent:test".into(),
            did_document: "{}".into(),
            lineage_proof: None,
            ephemeral_public_key: base64::engine::general_purpose::STANDARD.encode([0u8; 32]),
            conformance_level: None,
        };
        let err = validate_present(&msg).unwrap_err();
        assert!(matches!(
            err,
            AuthProtocolError::UnsupportedVersion { version: 99 }
        ));
    }

    #[test]
    fn validate_present_rejects_empty_did() {
        let msg = PresentMessage {
            version: crate::PROTOCOL_VERSION,
            did: String::new(),
            did_document: "{}".into(),
            lineage_proof: None,
            ephemeral_public_key: base64::engine::general_purpose::STANDARD.encode([0u8; 32]),
            conformance_level: None,
        };
        let err = validate_present(&msg).unwrap_err();
        assert!(matches!(err, AuthProtocolError::InvalidDidDocument { .. }));
    }

    #[test]
    fn validate_present_accepts_valid() {
        let msg = PresentMessage {
            version: crate::PROTOCOL_VERSION,
            did: "did:oas:l1fe:agent:test".into(),
            did_document: "{}".into(),
            lineage_proof: None,
            ephemeral_public_key: base64::engine::general_purpose::STANDARD.encode([0u8; 32]),
            conformance_level: None,
        };
        assert!(validate_present(&msg).is_ok());
    }

    #[test]
    fn discovery_document_has_correct_defaults() {
        let doc = build_discovery_document("did:oas:l1fe:service:api", ConformanceLevel::L2);
        assert_eq!(doc.auth_endpoint, AUTH_ENDPOINT_PATH);
        assert_eq!(doc.supported_versions, vec![crate::PROTOCOL_VERSION]);
        assert_eq!(doc.required_conformance_level, ConformanceLevel::L2);
    }
}
