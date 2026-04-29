// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//
//! Client-side WebSocket connector with OAAP auth-on-connect.
//!
//! ```ignore
//! let client = OpenAgentWsClient::new(my_did, my_signing_key, my_verifying_key);
//! let session = client.connect("wss://example.com/ws").await?;
//! session.send(b"hello").await?;
//! ```

use std::time::Duration;

use tokio::time::timeout;
use tokio_tungstenite::connect_async;

use openagent_crypto_wasm::{ed25519, x25519};

use crate::error::{Result, WsError};
use crate::frame::{PresentFrame, TYPE_PRESENT};
use crate::session::{derive_session_material, AuthenticatedSession};
use crate::transport::{recv_frame, send_frame, OaapFrame, WsStream};

/// Default handshake timeout per step (5 seconds).
const DEFAULT_STEP_TIMEOUT: Duration = Duration::from_secs(5);

/// Client-side OAAP WebSocket connector.
///
/// Holds the client's identity material. Call [`connect`](Self::connect) to
/// open a WebSocket, run the 4-step OAAP handshake, and receive an
/// authenticated session.
pub struct OpenAgentWsClient {
    did: String,
    signing_key: [u8; 32],
    verifying_key: [u8; 32],
    step_timeout: Duration,
}

impl OpenAgentWsClient {
    /// Creates a new client with the given identity.
    pub fn new(did: impl Into<String>, signing_key: [u8; 32], verifying_key: [u8; 32]) -> Self {
        Self {
            did: did.into(),
            signing_key,
            verifying_key,
            step_timeout: DEFAULT_STEP_TIMEOUT,
        }
    }

    /// Overrides the per-step handshake timeout (default: 5s).
    pub fn with_timeout(mut self, duration: Duration) -> Self {
        self.step_timeout = duration;
        self
    }

    /// Opens a WebSocket connection to `url` and runs the 4-step OAAP handshake.
    ///
    /// Returns an [`AuthenticatedSession`] on success.
    pub async fn connect(&self, url: &str) -> Result<AuthenticatedSession<WsStream>> {
        let (mut ws, _resp) = connect_async(url).await?;

        // ── Step 1: Send PresentFrame ─────────────────────────────────
        let client_eph = x25519::generate_keypair();

        let present = PresentFrame {
            frame_type: TYPE_PRESENT.to_owned(),
            did: self.did.clone(),
            ephemeral_pub: hex::encode(client_eph.public_key_bytes()),
            verifying_key: hex::encode(self.verifying_key),
            timestamp: now_iso8601(),
        };

        send_frame(&mut ws, &present).await?;
        tracing::info!("OAAP step 1: sent present");

        // ── Step 2: Receive ChallengeFrame ────────────────────────────
        let challenge_frame = timeout(self.step_timeout, recv_frame(&mut ws))
            .await
            .map_err(|_| WsError::HandshakeTimeout {
                step: 2,
                timeout_ms: self.step_timeout.as_millis() as u64,
            })?
            .map_err(|e| {
                tracing::warn!(error = %e, "OAAP step 2 recv failed");
                e
            })?;

        let challenge = match challenge_frame {
            OaapFrame::Challenge(c) => c,
            other => {
                return Err(WsError::UnexpectedFrameType {
                    expected: "oaap:challenge",
                    actual: format!("{other:?}"),
                });
            }
        };

        tracing::info!(server_did = %challenge.did, "OAAP step 2: received challenge");

        let server_ephemeral_pub =
            hex::decode(&challenge.ephemeral_pub).map_err(|e| WsError::AuthFailed {
                reason: format!("invalid server ephemeral pub hex: {e}"),
            })?;
        let server_verifying_key =
            hex::decode(&challenge.verifying_key).map_err(|e| WsError::AuthFailed {
                reason: format!("invalid server verifying key hex: {e}"),
            })?;
        let challenge_bytes =
            hex::decode(&challenge.challenge).map_err(|e| WsError::AuthFailed {
                reason: format!("invalid challenge hex: {e}"),
            })?;

        // ── Step 3: Sign the challenge, send ProveFrame ───────────────
        let signature = ed25519::sign(&self.signing_key, &challenge_bytes)?;

        let prove = crate::frame::ProveFrame {
            frame_type: crate::frame::TYPE_PROVE.to_owned(),
            signature: hex::encode(signature),
            challenge: challenge.challenge.clone(),
        };

        send_frame(&mut ws, &prove).await?;
        tracing::info!("OAAP step 3: sent proof");

        // ── Step 4: Receive EstablishedFrame ──────────────────────────
        let established_frame = timeout(self.step_timeout, recv_frame(&mut ws))
            .await
            .map_err(|_| WsError::HandshakeTimeout {
                step: 4,
                timeout_ms: self.step_timeout.as_millis() as u64,
            })?
            .map_err(|e| {
                tracing::warn!(error = %e, "OAAP step 4 recv failed");
                e
            })?;

        let established = match established_frame {
            OaapFrame::Established(e) => e,
            other => {
                return Err(WsError::UnexpectedFrameType {
                    expected: "oaap:established",
                    actual: format!("{other:?}"),
                });
            }
        };

        // Verify server's signature over session || client_ephemeral_pub.
        let session_id_bytes =
            hex::decode(&established.session).map_err(|e| WsError::AuthFailed {
                reason: format!("invalid session hex: {e}"),
            })?;
        let server_sig_bytes =
            hex::decode(&established.signature).map_err(|e| WsError::AuthFailed {
                reason: format!("invalid server signature hex: {e}"),
            })?;

        let mut sig_data = Vec::with_capacity(session_id_bytes.len() + 32);
        sig_data.extend_from_slice(&session_id_bytes);
        sig_data.extend_from_slice(&client_eph.public_key_bytes());

        ed25519::verify(&server_verifying_key, &sig_data, &server_sig_bytes).map_err(|e| {
            WsError::AuthFailed {
                reason: format!("server signature verification failed: {e}"),
            }
        })?;

        tracing::info!(
            session = %established.session,
            encrypted = established.encrypted,
            "OAAP step 4: session established"
        );

        // Derive session key from ECDH.
        let shared_secret =
            x25519::diffie_hellman(&client_eph.secret_key_bytes(), &server_ephemeral_pub)?;

        let (derived_session_id, session_key) =
            derive_session_material(&shared_secret, established.encrypted)?;

        // Verify the server-provided session ID matches our derivation.
        if hex::encode(derived_session_id) != established.session {
            return Err(WsError::AuthFailed {
                reason: "derived session ID does not match server-provided session ID".to_owned(),
            });
        }

        Ok(AuthenticatedSession::new(
            ws,
            derived_session_id,
            session_key,
            challenge.did,
        ))
    }
}

fn now_iso8601() -> String {
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}Z", dur.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_builder_sets_timeout() {
        let kp = ed25519::generate_keypair();
        let client = OpenAgentWsClient::new(
            "did:oas:l1fe:agent:cli",
            kp.signing_key_bytes(),
            kp.verifying_key_bytes(),
        )
        .with_timeout(Duration::from_millis(200));
        assert_eq!(client.step_timeout, Duration::from_millis(200));
    }

    #[test]
    fn client_stores_identity() {
        let kp = ed25519::generate_keypair();
        let client = OpenAgentWsClient::new(
            "did:oas:l1fe:agent:cli",
            kp.signing_key_bytes(),
            kp.verifying_key_bytes(),
        );
        assert_eq!(client.did, "did:oas:l1fe:agent:cli");
    }
}
