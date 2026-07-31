// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! HTTP implementation of the [`AuthTransport`] trait for the Core Protocol
//! identity flow.

use async_trait::async_trait;
use openagent_auth_protocol::error::AuthProtocolError;
use openagent_auth_protocol::message::{IdentityChallenge, IdentityProof, IdentityVerified};
use openagent_auth_protocol::transport::AuthTransport;

/// HTTP transport carrying the identity flow over REST.
///
/// The challenge is fetched with `POST <auth endpoint>` and the proof with
/// `POST <auth endpoint>/prove`, per the HTTP binding's proactive form. The
/// reactive form (`401` + `WWW-Authenticate`) is handled by the client, which
/// also understands challenge headers.
pub struct HttpTransport {
    client: reqwest::Client,
}

impl HttpTransport {
    /// Creates a new HTTP transport with the given `reqwest` client.
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }

    /// Creates a new HTTP transport with a default client.
    pub fn with_defaults() -> Result<Self, AuthProtocolError> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| AuthProtocolError::TransportFailed {
                reason: format!("failed to create HTTP client: {e}"),
            })?;
        Ok(Self { client })
    }

    /// Returns a reference to the inner reqwest client.
    pub fn inner(&self) -> &reqwest::Client {
        &self.client
    }
}

#[async_trait]
impl AuthTransport for HttpTransport {
    async fn fetch_challenge(
        &self,
        endpoint: &str,
    ) -> Result<IdentityChallenge, AuthProtocolError> {
        let resp = self
            .client
            .post(endpoint)
            .header("accept", "application/json")
            .send()
            .await
            .map_err(|e| AuthProtocolError::TransportFailed {
                reason: format!("challenge request failed: {e}"),
            })?;

        if !resp.status().is_success() {
            return Err(AuthProtocolError::TransportFailed {
                reason: format!("challenge endpoint returned HTTP {}", resp.status()),
            });
        }

        let challenge: IdentityChallenge =
            resp.json()
                .await
                .map_err(|e| AuthProtocolError::SerializationFailed {
                    message_type: "IdentityChallenge".to_string(),
                    reason: e.to_string(),
                })?;

        // An agent MUST reject a malformed challenge before signing it.
        openagent_auth_protocol::handshake::validate_challenge(&challenge)?;
        Ok(challenge)
    }

    async fn prove(
        &self,
        endpoint: &str,
        proof: &IdentityProof,
    ) -> Result<IdentityVerified, AuthProtocolError> {
        let body =
            serde_json::to_vec(proof).map_err(|e| AuthProtocolError::SerializationFailed {
                message_type: "IdentityProof".to_string(),
                reason: e.to_string(),
            })?;

        let resp = self
            .client
            .post(endpoint)
            .header("content-type", "application/json")
            .header("accept", "application/json")
            .body(body)
            .send()
            .await
            .map_err(|e| AuthProtocolError::TransportFailed {
                reason: format!("prove request failed: {e}"),
            })?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body_text = resp.text().await.unwrap_or_default();
            return Err(AuthProtocolError::TransportFailed {
                reason: format!("prove endpoint returned HTTP {status}: {body_text}"),
            });
        }

        resp.json()
            .await
            .map_err(|e| AuthProtocolError::SerializationFailed {
                message_type: "IdentityVerified".to_string(),
                reason: e.to_string(),
            })
    }
}
