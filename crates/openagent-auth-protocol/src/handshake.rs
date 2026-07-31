// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! Core handshake logic for the OpenAgent Core Protocol identity flow.
//!
//! Implements the normative rules from the Core Protocol Specification:
//! nonce shape (Section 7), challenge construction (Sections 4 / 15.2), the
//! JCS signing payload (Section 5), and proof validation (Section 15.3).
//! The specification is the authority; this module is its implementation.

use crate::error::AuthProtocolError;
use crate::message::{IdentityChallenge, IdentityProof, KeyType, CHALLENGE_TYPE};

/// Default session TTL in seconds (5 minutes).
pub const DEFAULT_SESSION_TTL_SECS: u32 = 300;

/// Default challenge TTL in seconds (Section 7: default 30s, max 300s).
pub const DEFAULT_CHALLENGE_TTL_SECS: u32 = 60;

/// Maximum challenge TTL in seconds (Section 7).
pub const MAX_CHALLENGE_TTL_SECS: u32 = 300;

/// Well-known path for discovery.
pub const WELL_KNOWN_PATH: &str = "/.well-known/openagent";

/// Well-known path for the auth endpoint.
pub const AUTH_ENDPOINT_PATH: &str = "/.well-known/openagent/auth";

/// Well-known path for the prove endpoint.
pub const PROVE_ENDPOINT_PATH: &str = "/.well-known/openagent/auth/prove";

/// Generate a nonce per Section 7: 32 CSPRNG bytes as 64 lowercase hex chars.
pub fn generate_nonce() -> Result<String, AuthProtocolError> {
    let mut buf = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut buf);
    Ok(hex::encode(buf))
}

/// Construct a fresh [`IdentityChallenge`] for `origin`, stamping the current
/// UTC time in the Section 4 format (`Z` suffix, seconds precision).
pub fn new_challenge(
    origin: &str,
    realm: Option<String>,
) -> Result<IdentityChallenge, AuthProtocolError> {
    let nonce = generate_nonce()?;
    let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    Ok(IdentityChallenge::new(
        nonce,
        timestamp,
        origin.to_string(),
        realm,
    ))
}

/// The signing payload for an [`IdentityProof`]: the JCS-canonicalized
/// (RFC 8785) UTF-8 bytes of the challenge object, with no framing, prefix,
/// or envelope (Section 5 / Section 15.2).
pub fn canonical_challenge_bytes(
    challenge: &IdentityChallenge,
) -> Result<Vec<u8>, AuthProtocolError> {
    let value =
        serde_json::to_value(challenge).map_err(|e| AuthProtocolError::SerializationFailed {
            message_type: "IdentityChallenge".to_string(),
            reason: e.to_string(),
        })?;
    let canonical =
        serde_jcs::to_string(&value).map_err(|e| AuthProtocolError::SerializationFailed {
            message_type: "IdentityChallenge (JCS)".to_string(),
            reason: e.to_string(),
        })?;
    Ok(canonical.into_bytes())
}

/// Validate an [`IdentityChallenge`] against the Section 4 field constraints.
///
/// A server MUST reject a challenge whose `type` differs, and an agent MUST
/// reject a malformed challenge before signing it: signing binds the agent to
/// these exact bytes.
pub fn validate_challenge(challenge: &IdentityChallenge) -> Result<(), AuthProtocolError> {
    if challenge.message_type != CHALLENGE_TYPE {
        return Err(AuthProtocolError::InvalidChallenge {
            reason: format!(
                "type must be \"{CHALLENGE_TYPE}\", got \"{}\"",
                challenge.message_type
            ),
        });
    }
    validate_nonce(&challenge.nonce)?;
    validate_timestamp(&challenge.timestamp)?;
    validate_origin(&challenge.origin)?;
    if let Some(realm) = &challenge.realm {
        if realm.is_empty() {
            return Err(AuthProtocolError::InvalidChallenge {
                reason: "realm must be non-empty when present".to_string(),
            });
        }
    }
    Ok(())
}

/// The nonce field: exactly 64 lowercase hex characters (Section 7).
pub fn validate_nonce(nonce: &str) -> Result<(), AuthProtocolError> {
    let valid = nonce.len() == 64
        && nonce
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase());
    if !valid {
        return Err(AuthProtocolError::InvalidChallenge {
            reason: format!(
                "nonce must be exactly 64 lowercase hex characters, got {} chars",
                nonce.len()
            ),
        });
    }
    Ok(())
}

/// The timestamp field: ISO 8601 UTC with `Z` suffix and seconds precision
/// (Section 4.2). Fractional seconds and numeric offsets are rejected.
pub fn validate_timestamp(timestamp: &str) -> Result<(), AuthProtocolError> {
    let parsed = chrono::NaiveDateTime::parse_from_str(timestamp, "%Y-%m-%dT%H:%M:%SZ");
    if parsed.is_err() {
        return Err(AuthProtocolError::InvalidChallenge {
            reason: format!(
                "timestamp must be ISO 8601 UTC with Z suffix and seconds precision, got \"{timestamp}\""
            ),
        });
    }
    Ok(())
}

/// The origin field: `scheme://host[:port]` per RFC 6454 (Section 4.2).
pub fn validate_origin(origin: &str) -> Result<(), AuthProtocolError> {
    let valid = (origin.starts_with("https://") || origin.starts_with("http://"))
        && origin.len() > "https://".len()
        && !origin.ends_with('/')
        && origin[origin.find("://").map_or(0, |i| i + 3)..]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '0'..='9'));
    if !valid {
        return Err(AuthProtocolError::InvalidChallenge {
            reason: format!("origin must be of the form scheme://host[:port], got \"{origin}\""),
        });
    }
    Ok(())
}

/// Validate an [`IdentityProof`] against a challenge (Section 15.3):
/// the echoed nonce must match, and the key shape must match the declared
/// scheme. Signature verification itself belongs to the verifier, which knows
/// the trusted key set.
pub fn validate_proof_shape(
    proof: &IdentityProof,
    challenge: &IdentityChallenge,
) -> Result<(), AuthProtocolError> {
    if proof.nonce != challenge.nonce {
        return Err(AuthProtocolError::NonceMismatch {
            expected: challenge.nonce.clone(),
            received: proof.nonce.clone(),
        });
    }
    let key_bytes = decode_base64url(&proof.public_key, "public_key")?;
    let expected_len = match proof.key_type {
        KeyType::Ed25519 => 32,
        KeyType::Secp256k1 => 33,
    };
    if key_bytes.len() != expected_len {
        return Err(AuthProtocolError::InvalidProof {
            reason: format!(
                "public_key must decode to {expected_len} bytes for {}, got {}",
                proof.key_type,
                key_bytes.len()
            ),
        });
    }
    let sig_bytes = decode_base64url(&proof.signature, "signature")?;
    if sig_bytes.len() != 64 {
        return Err(AuthProtocolError::InvalidProof {
            reason: format!("signature must decode to 64 bytes, got {}", sig_bytes.len()),
        });
    }
    Ok(())
}

/// Decode base64url without padding, as Section 15.3 requires for key and
/// signature fields.
fn decode_base64url(input: &str, field: &str) -> Result<Vec<u8>, AuthProtocolError> {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(input)
        .map_err(|e| AuthProtocolError::InvalidProof {
            reason: format!("{field} is not valid base64url (no padding): {e}"),
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_challenge() -> IdentityChallenge {
        IdentityChallenge::new(
            "a3f1c9".to_string() + &"0".repeat(58),
            "2026-03-21T12:00:00Z".to_string(),
            "https://api.example.com".to_string(),
            None,
        )
    }

    #[test]
    fn nonce_is_64_lowercase_hex() {
        let nonce = generate_nonce().expect("nonce");
        assert_eq!(nonce.len(), 64);
        assert!(nonce
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn new_challenge_uses_spec_timestamp_format() {
        let challenge = new_challenge("https://api.example.com", None).expect("challenge");
        assert!(validate_challenge(&challenge).is_ok());
    }

    #[test]
    fn canonical_bytes_are_deterministic_and_member_sorted() {
        let challenge = valid_challenge();
        let a = canonical_challenge_bytes(&challenge).expect("canonical");
        let b = canonical_challenge_bytes(&challenge).expect("canonical");
        assert_eq!(a, b);
        let text = String::from_utf8(a).expect("utf8");
        // JCS sorts object members lexicographically: nonce < origin <
        // timestamp < type.
        let nonce_at = text.find("\"nonce\"").expect("nonce key");
        let origin_at = text.find("\"origin\"").expect("origin key");
        let timestamp_at = text.find("\"timestamp\"").expect("timestamp key");
        let type_at = text.find("\"type\"").expect("type key");
        assert!(nonce_at < origin_at && origin_at < timestamp_at && timestamp_at < type_at);
        // No whitespace between tokens.
        assert!(!text.contains(": "));
    }

    #[test]
    fn validate_challenge_rejects_wrong_type() {
        let mut challenge = valid_challenge();
        challenge.message_type = "openagent-challenge-v0".to_string();
        assert!(matches!(
            validate_challenge(&challenge),
            Err(AuthProtocolError::InvalidChallenge { .. })
        ));
    }

    #[test]
    fn validate_challenge_rejects_short_nonce() {
        let mut challenge = valid_challenge();
        challenge.nonce = "abcd".to_string();
        assert!(validate_challenge(&challenge).is_err());
    }

    #[test]
    fn validate_challenge_rejects_fractional_seconds() {
        let mut challenge = valid_challenge();
        challenge.timestamp = "2026-03-21T12:00:00.5Z".to_string();
        assert!(validate_challenge(&challenge).is_err());
    }

    #[test]
    fn validate_challenge_rejects_offset_timezone() {
        let mut challenge = valid_challenge();
        challenge.timestamp = "2026-03-21T12:00:00+00:00".to_string();
        assert!(validate_challenge(&challenge).is_err());
    }

    #[test]
    fn validate_challenge_rejects_realm_empty() {
        let mut challenge = valid_challenge();
        challenge.realm = Some(String::new());
        assert!(validate_challenge(&challenge).is_err());
    }

    #[test]
    fn proof_shape_requires_nonce_echo() {
        use base64::Engine;
        let challenge = valid_challenge();
        let proof = IdentityProof {
            signature: base64::engine::general_purpose::URL_SAFE_NO_PAD.encode([7u8; 64]),
            public_key: base64::engine::general_purpose::URL_SAFE_NO_PAD.encode([3u8; 32]),
            key_type: KeyType::Ed25519,
            nonce: "f".repeat(64),
        };
        assert!(matches!(
            validate_proof_shape(&proof, &challenge),
            Err(AuthProtocolError::NonceMismatch { .. })
        ));
    }

    #[test]
    fn proof_shape_checks_key_length_by_scheme() {
        use base64::Engine;
        let challenge = valid_challenge();
        let proof = IdentityProof {
            signature: base64::engine::general_purpose::URL_SAFE_NO_PAD.encode([7u8; 64]),
            // A secp256k1 key must be 33 bytes; 32 must fail.
            public_key: base64::engine::general_purpose::URL_SAFE_NO_PAD.encode([3u8; 32]),
            key_type: KeyType::Secp256k1,
            nonce: challenge.nonce.clone(),
        };
        assert!(matches!(
            validate_proof_shape(&proof, &challenge),
            Err(AuthProtocolError::InvalidProof { .. })
        ));
    }
}
