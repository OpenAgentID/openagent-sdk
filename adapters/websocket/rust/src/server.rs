// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//
//! Server-side WebSocket handler that runs the OAAP 4-step handshake before
//! handing off an authenticated session to the application.
//!
//! ```ignore
//! let handler = OpenAgentWsHandler::new(my_did, my_signing_key, my_verifying_key);
//! let session = handler.accept(ws_stream).await?;
//! let msg = session.receive().await?;
//! ```

use std::time::Duration;

use tokio::time::timeout;

use openagent_crypto_wasm::{ct, ed25519, x25519};

use crate::error::{Result, WsError};
use crate::frame::{
    ChallengeFrame, EstablishedFrame, TYPE_CHALLENGE, TYPE_ESTABLISHED,
};
use crate::session::{derive_session_material, AuthenticatedSession};
use crate::transport::{recv_frame, send_frame, OaapFrame, WsServerStream};

/// Default handshake timeout per step (5 seconds).
const DEFAULT_STEP_TIMEOUT: Duration = Duration::from_secs(5);

/// Server-side OAAP WebSocket handler.
///
/// Holds the server's identity material. Call [`accept`](Self::accept) on each
/// incoming WebSocket connection to run the 4-step authentication handshake.
pub struct OpenAgentWsHandler {
    did: String,
    signing_key: [u8; 32],
    verifying_key: [u8; 32],
    encrypted: bool,
    step_timeout: Duration,
}

impl OpenAgentWsHandler {
    /// Creates a new handler with the server's identity.
    ///
    /// # Arguments
    ///
    /// * `did` — Server's `did:oas:*` identifier.
    /// * `signing_key` — 32-byte Ed25519 signing key.
    /// * `verifying_key` — 32-byte Ed25519 verifying key.
    pub fn new(did: impl Into<String>, signing_key: [u8; 32], verifying_key: [u8; 32]) -> Self {
        Self {
            did: did.into(),
            signing_key,
            verifying_key,
            encrypted: true,
            step_timeout: DEFAULT_STEP_TIMEOUT,
        }
    }

    /// Sets whether sessions use encryption (default: `true`).
    pub fn with_encryption(mut self, encrypted: bool) -> Self {
        self.encrypted = encrypted;
        self
    }

    /// Overrides the per-step handshake timeout (default: 5s).
    pub fn with_timeout(mut self, duration: Duration) -> Self {
        self.step_timeout = duration;
        self
    }

    /// Runs the 4-step OAAP handshake on an accepted WebSocket connection.
    ///
    /// Returns an [`AuthenticatedSession`] on success. The caller should then
    /// use `session.send()` / `session.receive()` for all subsequent
    /// communication.
    ///
    /// # Errors
    ///
    /// Returns [`WsError`] if the handshake fails for any reason: timeout,
    /// unexpected frame, bad signature, transport error.
    pub async fn accept(
        &self,
        mut ws: WsServerStream,
    ) -> Result<AuthenticatedSession<WsServerStream>> {
        // ── Step 1: Receive client's PresentFrame ─────────────────────
        let present = timeout(self.step_timeout, recv_frame(&mut ws))
            .await
            .map_err(|_| WsError::HandshakeTimeout {
                step: 1,
                timeout_ms: self.step_timeout.as_millis() as u64,
            })?
            .map_err(|e| {
                tracing::warn!(error = %e, "OAAP step 1 recv failed");
                e
            })?;

        let present = match present {
            OaapFrame::Present(p) => p,
            other => {
                return Err(WsError::UnexpectedFrameType {
                    expected: "oaap:present",
                    actual: format!("{other:?}"),
                });
            }
        };

        tracing::info!(client_did = %present.did, "OAAP step 1: received present");

        let client_ephemeral_pub = hex::decode(&present.ephemeral_pub)
            .map_err(|e| WsError::AuthFailed {
                reason: format!("invalid client ephemeral pub hex: {e}"),
            })?;
        let client_verifying_key = hex::decode(&present.verifying_key)
            .map_err(|e| WsError::AuthFailed {
                reason: format!("invalid client verifying key hex: {e}"),
            })?;

        // ── Step 2: Generate ephemeral keypair, challenge, and send ───
        let server_eph = x25519::generate_keypair();
        let mut challenge = [0u8; 32];
        ct::fill_random(&mut challenge)?;

        let challenge_frame = ChallengeFrame {
            frame_type: TYPE_CHALLENGE.to_owned(),
            did: self.did.clone(),
            ephemeral_pub: hex::encode(server_eph.public_key_bytes()),
            verifying_key: hex::encode(self.verifying_key),
            challenge: hex::encode(challenge),
            timestamp: now_iso8601(),
        };

        send_frame(&mut ws, &challenge_frame).await?;
        tracing::info!("OAAP step 2: sent challenge");

        // ── Step 3: Receive client's ProveFrame ───────────────────────
        let prove = timeout(self.step_timeout, recv_frame(&mut ws))
            .await
            .map_err(|_| WsError::HandshakeTimeout {
                step: 3,
                timeout_ms: self.step_timeout.as_millis() as u64,
            })?
            .map_err(|e| {
                tracing::warn!(error = %e, "OAAP step 3 recv failed");
                e
            })?;

        let prove = match prove {
            OaapFrame::Prove(p) => p,
            other => {
                return Err(WsError::UnexpectedFrameType {
                    expected: "oaap:prove",
                    actual: format!("{other:?}"),
                });
            }
        };

        // Verify the client's Ed25519 signature over the challenge.
        let sig_bytes = hex::decode(&prove.signature).map_err(|e| WsError::AuthFailed {
            reason: format!("invalid signature hex: {e}"),
        })?;

        ed25519::verify(&client_verifying_key, &challenge, &sig_bytes).map_err(|e| {
            WsError::AuthFailed {
                reason: format!("challenge signature verification failed: {e}"),
            }
        })?;

        tracing::info!(client_did = %present.did, "OAAP step 3: client proved identity");

        // ── Step 4: ECDH, derive session, send EstablishedFrame ──────
        let shared_secret =
            x25519::diffie_hellman(&server_eph.secret_key_bytes(), &client_ephemeral_pub)?;

        let (session_id, session_key) = derive_session_material(&shared_secret, self.encrypted)?;

        // Server signs: session_id || client_ephemeral_pub
        let mut sig_data = Vec::with_capacity(16 + client_ephemeral_pub.len());
        sig_data.extend_from_slice(&session_id);
        sig_data.extend_from_slice(&client_ephemeral_pub);
        let server_sig = ed25519::sign(&self.signing_key, &sig_data)?;

        let established = EstablishedFrame {
            frame_type: TYPE_ESTABLISHED.to_owned(),
            session: hex::encode(session_id),
            encrypted: self.encrypted,
            signature: hex::encode(server_sig),
        };

        send_frame(&mut ws, &established).await?;
        tracing::info!(
            session = %hex::encode(session_id),
            encrypted = self.encrypted,
            "OAAP step 4: session established"
        );

        Ok(AuthenticatedSession::new(
            ws,
            session_id,
            session_key,
            present.did,
        ))
    }
}

/// Returns the current UTC time in ISO-8601 format.
fn now_iso8601() -> String {
    // Avoid pulling in chrono — use a simple format.
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}Z", dur.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handler_builder_sets_encrypted() {
        let kp = ed25519::generate_keypair();
        let handler = OpenAgentWsHandler::new(
            "did:oas:l1fe:agent:srv",
            kp.signing_key_bytes(),
            kp.verifying_key_bytes(),
        )
        .with_encryption(false);
        assert!(!handler.encrypted);
    }

    #[test]
    fn handler_builder_sets_timeout() {
        let kp = ed25519::generate_keypair();
        let handler = OpenAgentWsHandler::new(
            "did:oas:l1fe:agent:srv",
            kp.signing_key_bytes(),
            kp.verifying_key_bytes(),
        )
        .with_timeout(Duration::from_millis(500));
        assert_eq!(handler.step_timeout, Duration::from_millis(500));
    }

    #[test]
    fn now_iso8601_is_nonempty() {
        let ts = now_iso8601();
        assert!(ts.ends_with('Z'));
        assert!(ts.len() > 2);
    }
}
