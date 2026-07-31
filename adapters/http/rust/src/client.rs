// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! HTTP client for the Core Protocol identity flow.
//!
//! The client performs the full flow against a server's well-known
//! endpoints: fetch a challenge, sign the JCS-canonical challenge bytes,
//! prove, and hold the resulting session in an [`AuthenticatedSession`] for
//! subsequent requests.

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64URL;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};

use openagent_auth_protocol::error::AuthProtocolError;
use openagent_auth_protocol::handshake;
use openagent_auth_protocol::message::{IdentityProof, KeyType};
use openagent_auth_protocol::transport::AuthTransport;

use crate::discovery;
use crate::session::AuthenticatedSession;
use crate::transport::HttpTransport;

/// Configuration for the HTTP auth client.
#[derive(Debug, Clone)]
pub struct ClientConfig {
    /// The agent's DID. Reported to the server for audit and, where the
    /// deployment resolves DIDs, for trust-tier assignment. The agent proves
    /// possession of the key - lineage evaluation is the server's job.
    pub did: String,
}

/// HTTP client that performs the Core Protocol identity flow over REST.
pub struct HttpAuthClient {
    config: ClientConfig,
    signing_key: SigningKey,
    transport: HttpTransport,
}

impl HttpAuthClient {
    /// Creates a new HTTP auth client.
    ///
    /// # Arguments
    /// - `config`: Agent identity configuration
    /// - `signing_key_bytes`: 32-byte Ed25519 signing key
    pub fn new(
        config: ClientConfig,
        signing_key_bytes: &[u8; 32],
    ) -> Result<Self, AuthProtocolError> {
        let signing_key = SigningKey::from_bytes(signing_key_bytes);
        let transport = HttpTransport::with_defaults()?;
        Ok(Self {
            config,
            signing_key,
            transport,
        })
    }

    /// Creates a client with a custom `reqwest::Client`.
    pub fn with_client(
        config: ClientConfig,
        signing_key_bytes: &[u8; 32],
        client: reqwest::Client,
    ) -> Self {
        let signing_key = SigningKey::from_bytes(signing_key_bytes);
        let transport = HttpTransport::new(client);
        Self {
            config,
            signing_key,
            transport,
        }
    }

    /// Performs the full identity flow against the given base URL.
    ///
    /// 1. Discovers the auth endpoint via `GET /.well-known/openagent`
    ///    (tolerating discovery failure and falling back to the default path)
    /// 2. Fetches an `openagent-challenge-v1` challenge
    /// 3. Signs the JCS-canonical challenge bytes and proves
    /// 4. Returns an [`AuthenticatedSession`] carrying the session token
    pub async fn authenticate(
        &self,
        base_url: &str,
    ) -> Result<AuthenticatedSession, AuthProtocolError> {
        // Step 0: discover endpoints, tolerating servers that do not publish
        // a discovery document.
        let (auth_endpoint, prove_endpoint) =
            match discovery::fetch_discovery(self.transport.inner(), base_url).await {
                Ok(doc) => (
                    discovery::resolve_auth_endpoint(base_url, &doc),
                    discovery::resolve_prove_endpoint(base_url, &doc),
                ),
                Err(_) => {
                    let base = base_url.trim_end_matches('/');
                    (
                        format!("{base}{}", handshake::AUTH_ENDPOINT_PATH),
                        format!("{base}{}", handshake::PROVE_ENDPOINT_PATH),
                    )
                }
            };

        // Step 1: fetch the challenge.
        let challenge = self.transport.fetch_challenge(&auth_endpoint).await?;

        // Step 2: sign the canonical challenge bytes and prove.
        let payload = handshake::canonical_challenge_bytes(&challenge)?;
        let signature = self.signing_key.sign(&payload);
        let proof = IdentityProof {
            signature: B64URL.encode(signature.to_bytes()),
            public_key: B64URL.encode(self.signing_key.verifying_key().to_bytes()),
            key_type: KeyType::Ed25519,
            nonce: challenge.nonce.clone(),
        };
        let verified = self.transport.prove(&prove_endpoint, &proof).await?;

        // Step 3: hold the session.
        let expires_at = chrono::DateTime::parse_from_rfc3339(&verified.session_expires)
            .map_err(|e| AuthProtocolError::SerializationFailed {
                message_type: "IdentityVerified.session_expires".to_string(),
                reason: e.to_string(),
            })?
            .timestamp();

        Ok(AuthenticatedSession::new(
            self.transport.inner().clone(),
            base_url.to_owned(),
            verified.session_token.clone(),
            self.config.did.clone(),
            verified.session_token,
            expires_at,
        ))
    }
}
