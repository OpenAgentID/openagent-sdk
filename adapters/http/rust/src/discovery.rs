// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! Well-known discovery for OAAP endpoints.
//!
//! Servers expose `GET /.well-known/openagent` returning a JSON
//! [`DiscoveryDocument`] so clients can discover auth endpoints, supported
//! protocol versions, and required conformance levels.

use openagent_auth_protocol::error::AuthProtocolError;
use openagent_auth_protocol::types::DiscoveryDocument;

/// Fetch the discovery document from a server.
///
/// Sends `GET <base_url>/.well-known/openagent` and parses the response.
pub async fn fetch_discovery(
    http_client: &reqwest::Client,
    base_url: &str,
) -> Result<DiscoveryDocument, AuthProtocolError> {
    let url = format!(
        "{}/.well-known/openagent",
        base_url.trim_end_matches('/')
    );

    let resp = http_client
        .get(&url)
        .header("accept", "application/json")
        .send()
        .await
        .map_err(|e| AuthProtocolError::Transport(format!("discovery request failed: {e}")))?;

    if !resp.status().is_success() {
        return Err(AuthProtocolError::Transport(format!(
            "discovery returned HTTP {}",
            resp.status()
        )));
    }

    let doc: DiscoveryDocument = resp
        .json()
        .await
        .map_err(|e| AuthProtocolError::Serialization(format!("invalid discovery JSON: {e}")))?;

    Ok(doc)
}

/// Resolve the full auth endpoint URL from a base URL and discovery document.
pub fn resolve_auth_endpoint(base_url: &str, doc: &DiscoveryDocument) -> String {
    let base = base_url.trim_end_matches('/');
    let path = doc.auth_endpoint.trim_start_matches('/');
    format!("{base}/{path}")
}

/// Resolve the prove endpoint URL (auth endpoint + `/prove`).
pub fn resolve_prove_endpoint(base_url: &str, doc: &DiscoveryDocument) -> String {
    let auth = resolve_auth_endpoint(base_url, doc);
    format!("{auth}/prove")
}

#[cfg(test)]
mod tests {
    use super::*;
    use openagent_auth_protocol::types::ConformanceLevel;

    fn test_doc() -> DiscoveryDocument {
        DiscoveryDocument {
            auth_endpoint: "/.well-known/openagent/auth".into(),
            supported_versions: vec![1],
            server_did: "did:oas:l1fe:service:api".into(),
            required_conformance_level: ConformanceLevel::L2,
        }
    }

    #[test]
    fn resolve_auth_endpoint_trims_slashes() {
        let doc = test_doc();
        assert_eq!(
            resolve_auth_endpoint("https://api.example.com/", &doc),
            "https://api.example.com/.well-known/openagent/auth"
        );
        assert_eq!(
            resolve_auth_endpoint("https://api.example.com", &doc),
            "https://api.example.com/.well-known/openagent/auth"
        );
    }

    #[test]
    fn resolve_prove_endpoint_appends_prove() {
        let doc = test_doc();
        assert_eq!(
            resolve_prove_endpoint("https://api.example.com", &doc),
            "https://api.example.com/.well-known/openagent/auth/prove"
        );
    }
}
