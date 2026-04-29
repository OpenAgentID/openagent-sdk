// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! HTTP client for initiating the OAAP handshake.
//!
//! The client performs the full 4-step handshake against a server's
//! `/.well-known/openagent/auth` endpoint and returns an
//! [`AuthenticatedSession`] for subsequent authenticated requests.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};

use openagent_auth_protocol::error::AuthProtocolError;
use openagent_auth_protocol::handshake;
use openagent_auth_protocol::message::PresentMessage;
use openagent_auth_protocol::transport::AuthTransport;

use crate::discovery;
use crate::session::AuthenticatedSession;
use crate::transport::HttpTransport;

/// Configuration for the HTTP auth client.
#[derive(Debug, Clone)]
pub struct ClientConfig {
    /// The agent's DID.
    pub did: String,
    /// Serialized DID document (JSON string).
    pub did_document: String,
    /// Optional serialized lineage proof.
    pub lineage_proof: Option<String>,
    /// Optional conformance level claim.
    pub conformance_level: Option<String>,
}

/// HTTP client that performs the OAAP 4-step handshake over REST.
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

    /// Performs the full OAAP handshake against the given base URL.
    ///
    /// 1. Discovers the auth endpoint via `GET /.well-known/openagent`
    /// 2. Sends PRESENT, receives CHALLENGE
    /// 3. Signs the challenge, sends PROVE, receives ESTABLISHED
    /// 4. Returns an [`AuthenticatedSession`]
    pub async fn authenticate(
        &self,
        base_url: &str,
    ) -> Result<AuthenticatedSession, AuthProtocolError> {
        // Step 0: Discover endpoints.
        let doc = discovery::fetch_discovery(self.transport.inner(), base_url).await?;
        let auth_endpoint = discovery::resolve_auth_endpoint(base_url, &doc);

        // Generate ephemeral key for this handshake.
        let ephemeral_key = x25519_dalek::EphemeralSecret::random_from_rng(rand::thread_rng());
        let ephemeral_pub = x25519_dalek::PublicKey::from(&ephemeral_key);

        // Step 1: PRESENT
        let present = PresentMessage {
            version: openagent_auth_protocol::PROTOCOL_VERSION,
            did: self.config.did.clone(),
            did_document: self.config.did_document.clone(),
            lineage_proof: self.config.lineage_proof.clone(),
            ephemeral_public_key: B64.encode(ephemeral_pub.as_bytes()),
            conformance_level: self.config.conformance_level.clone(),
        };

        // Step 2: CHALLENGE (returned as response to PRESENT)
        let challenge = self.transport.present(&auth_endpoint, &present).await?;

        // Step 3: PROVE — sign the challenge payload.
        let payload = handshake::build_challenge_payload(
            &challenge.session_id,
            &challenge.nonce,
            &self.config.did,
            &challenge.responder_did,
        );

        let signature = self.signing_key.sign(&payload);
        let prove = openagent_auth_protocol::message::ProveMessage {
            session_id: challenge.session_id.clone(),
            signature: B64.encode(signature.to_bytes()),
            did: self.config.did.clone(),
        };

        // Step 4: ESTABLISHED (returned as response to PROVE)
        let established = self.transport.prove(&auth_endpoint, &prove).await?;

        // Build the authenticated session.
        // Use session_id as the session token for header attachment.
        let session = AuthenticatedSession::new(
            self.transport.inner().clone(),
            base_url.to_owned(),
            established.session_id.clone(),
            self.config.did.clone(),
            established.session_id.clone(),
            established.expires_at,
        );

        Ok(session)
    }
}
