// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! HTTP header constants and utilities for the Core Protocol binding.

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64URL;
use base64::Engine;
use openagent_auth_protocol::handshake;
use openagent_auth_protocol::message::IdentityChallenge;

/// The canonical authorization scheme for OpenAgent-authenticated requests,
/// per the Core Protocol HTTP binding.
pub const OPENAGENT_AUTH_SCHEME: &str = "OpenAgent";

/// Header carrying the authenticated agent's DID.
pub const HEADER_OPENAGENT_DID: &str = "x-openagent-did";

/// Header carrying the session token (alternative to the Authorization
/// header for clients that cannot set it).
pub const HEADER_OPENAGENT_SESSION: &str = "x-openagent-session";

/// Content-Type for all Core Protocol JSON payloads.
pub const CONTENT_TYPE_JSON: &str = "application/json";

/// Extract the session token from an `Authorization: OpenAgent <token>`
/// header. Returns `None` if the header is missing, malformed, or uses a
/// different scheme.
pub fn extract_openagent_token(authorization: &str) -> Option<&str> {
    let trimmed = authorization.trim();
    let (scheme, token) = trimmed.split_once(' ')?;
    if scheme.eq_ignore_ascii_case(OPENAGENT_AUTH_SCHEME) {
        let token = token.trim();
        if token.is_empty() {
            None
        } else {
            Some(token)
        }
    } else {
        None
    }
}

/// Build an `Authorization: OpenAgent <token>` header value.
pub fn build_openagent_header(token: &str) -> String {
    format!("{OPENAGENT_AUTH_SCHEME} {token}")
}

/// Build a `WWW-Authenticate: OpenAgent challenge="<base64url>"` header value
/// for the reactive flow: the challenge object serialized and base64url
/// encoded (per the HTTP binding, Section 4.3 of the specification).
pub fn build_challenge_header(challenge: &IdentityChallenge) -> String {
    let json = serde_json::to_string(challenge).unwrap_or_else(|_| "{}".to_string());
    let encoded = B64URL.encode(json);
    format!("{OPENAGENT_AUTH_SCHEME} challenge=\"{encoded}\"")
}

/// Decode a challenge from a `WWW-Authenticate` header value (client side of
/// the reactive flow).
pub fn parse_challenge_header(header_value: &str) -> Option<IdentityChallenge> {
    let trimmed = header_value.trim();
    let (scheme, rest) = trimmed.split_once(' ')?;
    if !scheme.eq_ignore_ascii_case(OPENAGENT_AUTH_SCHEME) {
        return None;
    }
    let encoded = rest
        .trim()
        .strip_prefix("challenge=\"")?
        .strip_suffix('"')?;
    let bytes = B64URL.decode(encoded).ok()?;
    let challenge: IdentityChallenge = serde_json::from_slice(&bytes).ok()?;
    handshake::validate_challenge(&challenge).ok()?;
    Some(challenge)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_valid_openagent_token() {
        assert_eq!(extract_openagent_token("OpenAgent abc123"), Some("abc123"));
        assert_eq!(extract_openagent_token("openagent abc123"), Some("abc123"));
    }

    #[test]
    fn extract_rejects_other_schemes() {
        assert_eq!(extract_openagent_token("Bearer abc123"), None);
        assert_eq!(extract_openagent_token("OAS abc123"), None);
        assert_eq!(extract_openagent_token(""), None);
    }

    #[test]
    fn challenge_header_round_trips() {
        let challenge = IdentityChallenge::new(
            "a".repeat(64),
            "2026-03-21T12:00:00Z".to_string(),
            "https://api.example.com".to_string(),
            None,
        );
        let header = build_challenge_header(&challenge);
        assert!(header.starts_with("OpenAgent challenge=\""));
        let parsed = parse_challenge_header(&header).expect("round trip");
        assert_eq!(parsed.nonce, challenge.nonce);
    }
}
