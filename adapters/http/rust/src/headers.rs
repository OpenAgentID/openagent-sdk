// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! HTTP header constants and parsing utilities for OAAP.

/// Authorization scheme for OAAP-authenticated requests.
pub const OAS_AUTH_SCHEME: &str = "OAS";

/// Header carrying the authenticated agent's DID.
pub const HEADER_OPENAGENT_DID: &str = "x-openagent-did";

/// Header carrying the session identifier.
pub const HEADER_OPENAGENT_SESSION: &str = "x-openagent-session";

/// Content-Type for all OAAP JSON payloads.
pub const CONTENT_TYPE_JSON: &str = "application/json";

/// Extract the session token from an `Authorization: OAS <token>` header.
///
/// Returns `None` if the header is missing, malformed, or uses a different scheme.
pub fn extract_oas_token(authorization: &str) -> Option<&str> {
    let trimmed = authorization.trim();
    if trimmed.len() < 5 {
        return None;
    }
    let (scheme, token) = trimmed.split_at(4);
    if scheme.eq_ignore_ascii_case("OAS ") {
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

/// Build an `Authorization: OAS <token>` header value.
pub fn build_oas_header(token: &str) -> String {
    format!("{OAS_AUTH_SCHEME} {token}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_valid_oas_token() {
        assert_eq!(extract_oas_token("OAS abc123"), Some("abc123"));
        assert_eq!(extract_oas_token("oas abc123"), Some("abc123"));
        assert_eq!(extract_oas_token("OAS  abc123"), Some("abc123"));
    }

    #[test]
    fn extract_invalid_oas_token() {
        assert_eq!(extract_oas_token("Bearer abc123"), None);
        assert_eq!(extract_oas_token("OAS"), None);
        assert_eq!(extract_oas_token("OAS "), None);
        assert_eq!(extract_oas_token(""), None);
    }

    #[test]
    fn build_header_format() {
        assert_eq!(build_oas_header("tok123"), "OAS tok123");
    }
}
