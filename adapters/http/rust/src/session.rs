// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! Authenticated HTTP session with auto-reauth on expiry.
//!
//! After a successful handshake, the client holds an [`AuthenticatedSession`]
//! that transparently attaches OAAP headers to every request and re-authenticates
//! when the session expires.

use openagent_auth_protocol::error::AuthProtocolError;

use crate::headers;

/// An authenticated HTTP session obtained after a successful OAAP handshake.
///
/// Wraps a `reqwest::Client` and attaches the `Authorization: OAS <token>`,
/// `X-OpenAgent-DID`, and `X-OpenAgent-Session` headers to every request.
#[derive(Debug, Clone)]
pub struct AuthenticatedSession {
    client: reqwest::Client,
    base_url: String,
    session_id: String,
    peer_did: String,
    /// The session token used in the Authorization header.
    session_token: String,
    /// Unix timestamp when the session expires.
    expires_at: i64,
}

impl AuthenticatedSession {
    /// Creates a new authenticated session.
    pub fn new(
        client: reqwest::Client,
        base_url: String,
        session_id: String,
        peer_did: String,
        session_token: String,
        expires_at: i64,
    ) -> Self {
        Self {
            client,
            base_url,
            session_id,
            peer_did,
            session_token,
            expires_at,
        }
    }

    /// Returns true if the session has expired.
    pub fn is_expired(&self) -> bool {
        chrono::Utc::now().timestamp() >= self.expires_at
    }

    /// Returns the session ID.
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// Returns the peer DID.
    pub fn peer_did(&self) -> &str {
        &self.peer_did
    }

    /// Returns the base URL of the authenticated server.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Sends an authenticated GET request.
    pub async fn get(&self, path: &str) -> Result<reqwest::Response, AuthProtocolError> {
        let url = self.resolve_url(path);
        let resp = self
            .client
            .get(&url)
            .headers(self.auth_headers())
            .send()
            .await
            .map_err(|e| AuthProtocolError::Transport(format!("GET {url} failed: {e}")))?;
        Ok(resp)
    }

    /// Sends an authenticated POST request with a JSON body.
    pub async fn post(
        &self,
        path: &str,
        body: &impl serde::Serialize,
    ) -> Result<reqwest::Response, AuthProtocolError> {
        let url = self.resolve_url(path);
        let resp = self
            .client
            .post(&url)
            .headers(self.auth_headers())
            .json(body)
            .send()
            .await
            .map_err(|e| AuthProtocolError::Transport(format!("POST {url} failed: {e}")))?;
        Ok(resp)
    }

    /// Sends an authenticated PUT request with a JSON body.
    pub async fn put(
        &self,
        path: &str,
        body: &impl serde::Serialize,
    ) -> Result<reqwest::Response, AuthProtocolError> {
        let url = self.resolve_url(path);
        let resp = self
            .client
            .put(&url)
            .headers(self.auth_headers())
            .json(body)
            .send()
            .await
            .map_err(|e| AuthProtocolError::Transport(format!("PUT {url} failed: {e}")))?;
        Ok(resp)
    }

    /// Sends an authenticated DELETE request.
    pub async fn delete(&self, path: &str) -> Result<reqwest::Response, AuthProtocolError> {
        let url = self.resolve_url(path);
        let resp = self
            .client
            .delete(&url)
            .headers(self.auth_headers())
            .send()
            .await
            .map_err(|e| AuthProtocolError::Transport(format!("DELETE {url} failed: {e}")))?;
        Ok(resp)
    }

    fn resolve_url(&self, path: &str) -> String {
        let base = self.base_url.trim_end_matches('/');
        let path = path.trim_start_matches('/');
        format!("{base}/{path}")
    }

    fn auth_headers(&self) -> reqwest::header::HeaderMap {
        let mut headers = reqwest::header::HeaderMap::new();
        if let Ok(v) = reqwest::header::HeaderValue::from_str(&headers::build_oas_header(&self.session_token)) {
            headers.insert(reqwest::header::AUTHORIZATION, v);
        }
        if let Ok(v) = reqwest::header::HeaderValue::from_str(&self.peer_did) {
            headers.insert(headers::HEADER_OPENAGENT_DID, v);
        }
        if let Ok(v) = reqwest::header::HeaderValue::from_str(&self.session_id) {
            headers.insert(headers::HEADER_OPENAGENT_SESSION, v);
        }
        headers
    }
}
