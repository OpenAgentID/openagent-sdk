// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! HTTP implementation of the OAAP [`AuthTransport`] trait.

use async_trait::async_trait;
use openagent_auth_protocol::error::AuthProtocolError;
use openagent_auth_protocol::message::{ChallengeMessage, EstablishedMessage, PresentMessage, ProveMessage};
use openagent_auth_protocol::transport::AuthTransport;

/// HTTP transport for carrying the OAAP 4-step handshake over REST.
///
/// Step 1 (PRESENT) is sent via `POST` to the auth endpoint.
/// Step 3 (PROVE) is sent via `POST` to the prove endpoint (`auth/prove`).
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
            .map_err(|e| AuthProtocolError::Transport(format!("failed to create HTTP client: {e}")))?;
        Ok(Self { client })
    }

    /// Returns a reference to the inner reqwest client.
    pub fn inner(&self) -> &reqwest::Client {
        &self.client
    }
}

#[async_trait]
impl AuthTransport for HttpTransport {
    async fn present(
        &self,
        endpoint: &str,
        message: &PresentMessage,
    ) -> Result<ChallengeMessage, AuthProtocolError> {
        let body = serde_json::to_vec(message)?;

        let resp = self
            .client
            .post(endpoint)
            .header("content-type", "application/json")
            .header("accept", "application/json")
            .body(body)
            .send()
            .await
            .map_err(|e| AuthProtocolError::Transport(format!("present request failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body_text = resp
                .text()
                .await
                .unwrap_or_else(|_| String::from("<unreadable>"));
            return Err(AuthProtocolError::Transport(format!(
                "present returned HTTP {status}: {body_text}"
            )));
        }

        let challenge: ChallengeMessage = resp
            .json()
            .await
            .map_err(|e| AuthProtocolError::Serialization(format!("invalid challenge JSON: {e}")))?;

        Ok(challenge)
    }

    async fn prove(
        &self,
        endpoint: &str,
        message: &ProveMessage,
    ) -> Result<EstablishedMessage, AuthProtocolError> {
        let prove_url = format!("{}/prove", endpoint.trim_end_matches('/'));
        let body = serde_json::to_vec(message)?;

        let resp = self
            .client
            .post(&prove_url)
            .header("content-type", "application/json")
            .header("accept", "application/json")
            .body(body)
            .send()
            .await
            .map_err(|e| AuthProtocolError::Transport(format!("prove request failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body_text = resp
                .text()
                .await
                .unwrap_or_else(|_| String::from("<unreadable>"));
            return Err(AuthProtocolError::Transport(format!(
                "prove returned HTTP {status}: {body_text}"
            )));
        }

        let established: EstablishedMessage = resp
            .json()
            .await
            .map_err(|e| {
                AuthProtocolError::Serialization(format!("invalid established JSON: {e}"))
            })?;

        Ok(established)
    }
}
