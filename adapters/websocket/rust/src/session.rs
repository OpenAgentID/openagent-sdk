// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//
//! Authenticated WebSocket session.
//!
//! After the 4-step OAAP handshake completes, both sides hold an
//! [`AuthenticatedSession`] that wraps the raw WebSocket stream and provides
//! `send` / `receive` with optional AES-256-GCM encryption keyed by the ECDH
//! session key.

use std::sync::atomic::{AtomicU64, Ordering};

use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::Message;
use zeroize::Zeroize;

use openagent_crypto_wasm::{aead, ct, hkdf_sha256};

use crate::error::{Result, WsError};
use crate::frame::{MessageFrame, TYPE_MESSAGE};
use crate::transport::{recv_frame, send_frame, OaapFrame};

/// HKDF info string for deriving the session encryption key from the raw ECDH
/// shared secret.
const SESSION_KEY_INFO: &[u8] = b"oaap-ws-session-key-v1";

/// HKDF info string for deriving the session ID from the raw ECDH shared secret.
const SESSION_ID_INFO: &[u8] = b"oaap-ws-session-id-v1";

/// An authenticated WebSocket session with an optional encryption layer.
///
/// Created by [`crate::server::OpenAgentWsHandler::accept`] or
/// [`crate::client::OpenAgentWsClient::connect`] after a successful OAAP
/// handshake.
pub struct AuthenticatedSession<S> {
    ws: S,
    session_id: [u8; 16],
    /// AES-256-GCM key derived via HKDF from the ECDH shared secret.
    /// `None` means plaintext mode.
    session_key: Option<SessionKey>,
    /// Outbound sequence counter for replay protection.
    tx_seq: AtomicU64,
    /// Last received inbound sequence number.
    rx_seq: AtomicU64,
    /// The remote peer's DID.
    peer_did: String,
}

/// Wrapper for the 32-byte session key with zeroize-on-drop.
struct SessionKey {
    bytes: [u8; 32],
}

impl Drop for SessionKey {
    fn drop(&mut self) {
        self.bytes.zeroize();
    }
}

impl std::fmt::Debug for SessionKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("[REDACTED]")
    }
}

/// Derives a 16-byte session ID and an optional 32-byte AES-256-GCM key from
/// the raw X25519 shared secret.
pub(crate) fn derive_session_material(
    shared_secret: &[u8; 32],
    encrypted: bool,
) -> Result<([u8; 16], Option<[u8; 32]>)> {
    let id_bytes = hkdf_sha256::derive(b"", shared_secret, SESSION_ID_INFO, 16)?;
    let mut session_id = [0u8; 16];
    session_id.copy_from_slice(&id_bytes);

    let session_key = if encrypted {
        let key_bytes = hkdf_sha256::derive(b"", shared_secret, SESSION_KEY_INFO, 32)?;
        let mut key = [0u8; 32];
        key.copy_from_slice(&key_bytes);
        Some(key)
    } else {
        None
    };

    Ok((session_id, session_key))
}

impl<S> AuthenticatedSession<S> {
    /// Creates a new authenticated session.
    ///
    /// Called internally by server/client after handshake completion.
    pub(crate) fn new(
        ws: S,
        session_id: [u8; 16],
        session_key: Option<[u8; 32]>,
        peer_did: String,
    ) -> Self {
        Self {
            ws,
            session_id,
            session_key: session_key.map(|bytes| SessionKey { bytes }),
            tx_seq: AtomicU64::new(0),
            rx_seq: AtomicU64::new(0),
            peer_did,
        }
    }

    /// Returns the hex-encoded session ID.
    pub fn session_id_hex(&self) -> String {
        hex::encode(self.session_id)
    }

    /// Returns the peer's DID.
    pub fn peer_did(&self) -> &str {
        &self.peer_did
    }

    /// Returns whether this session uses encryption.
    pub fn is_encrypted(&self) -> bool {
        self.session_key.is_some()
    }
}

impl<S> AuthenticatedSession<S>
where
    S: SinkExt<Message> + Unpin,
    S::Error: std::fmt::Display,
{
    /// Sends a payload over the authenticated session.
    ///
    /// If the session was established with encryption, the payload is
    /// AES-256-GCM encrypted with a fresh random nonce. Otherwise, it is
    /// sent as plaintext.
    pub async fn send(&mut self, payload: &[u8]) -> Result<()> {
        let seq = self.tx_seq.fetch_add(1, Ordering::Relaxed);
        let session_hex = self.session_id_hex();

        let (encoded_payload, nonce_hex) = match &self.session_key {
            Some(key) => {
                let mut nonce = [0u8; 12];
                ct::fill_random(&mut nonce)?;
                let aad = format!("{session_hex}:{seq}");
                let ciphertext = aead::aes256gcm_encrypt(&key.bytes, &nonce, payload, aad.as_bytes())?;
                let payload_hex = hex::encode(&ciphertext);
                (payload_hex, Some(hex::encode(nonce)))
            }
            None => {
                let plain = String::from_utf8_lossy(payload).into_owned();
                (plain, None)
            }
        };

        let frame = MessageFrame {
            frame_type: TYPE_MESSAGE.to_owned(),
            session: session_hex,
            payload: encoded_payload,
            nonce: nonce_hex,
            seq,
        };

        send_frame(&mut self.ws, &frame).await
    }
}

impl<S> AuthenticatedSession<S>
where
    S: StreamExt<Item = std::result::Result<Message, tokio_tungstenite::tungstenite::Error>>
        + Unpin,
{
    /// Receives the next message payload from the authenticated session.
    ///
    /// Validates session ID, verifies sequence ordering, and decrypts if
    /// the session is encrypted.
    pub async fn receive(&mut self) -> Result<Vec<u8>> {
        loop {
            let frame = recv_frame(&mut self.ws).await?;
            match frame {
                OaapFrame::Message(msg) => {
                    return self.process_message(msg);
                }
                _ => {
                    tracing::warn!("ignoring non-message OAAP frame on established session");
                    continue;
                }
            }
        }
    }

    /// Decodes and validates an inbound message frame.
    fn process_message(&self, msg: MessageFrame) -> Result<Vec<u8>> {
        let expected_session = self.session_id_hex();
        if msg.session != expected_session {
            return Err(WsError::SessionMismatch {
                expected: expected_session,
                actual: msg.session,
            });
        }

        // Replay protection: sequence must be strictly greater than last seen.
        let last_rx = self.rx_seq.load(Ordering::Relaxed);
        if msg.seq <= last_rx && last_rx > 0 {
            return Err(WsError::AuthFailed {
                reason: format!(
                    "replay detected: received seq {} but last was {}",
                    msg.seq, last_rx
                ),
            });
        }
        self.rx_seq.store(msg.seq, Ordering::Relaxed);

        match &self.session_key {
            Some(key) => {
                let nonce_hex = msg.nonce.ok_or_else(|| WsError::DecryptionFailed(
                    "encrypted session but no nonce in frame".to_owned(),
                ))?;
                let nonce_bytes = hex::decode(&nonce_hex).map_err(|e| {
                    WsError::DecryptionFailed(format!("invalid nonce hex: {e}"))
                })?;
                let ciphertext = hex::decode(&msg.payload).map_err(|e| {
                    WsError::DecryptionFailed(format!("invalid ciphertext hex: {e}"))
                })?;
                let aad = format!("{}:{}", msg.session, msg.seq);
                let plaintext =
                    aead::aes256gcm_decrypt(&key.bytes, &nonce_bytes, &ciphertext, aad.as_bytes())
                        .map_err(|e| WsError::DecryptionFailed(e.to_string()))?;
                Ok(plaintext)
            }
            None => Ok(msg.payload.into_bytes()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_session_material_plaintext() {
        let secret = [0x42u8; 32];
        let (id, key) = derive_session_material(&secret, false)
            .unwrap_or_else(|e| unreachable!("{e}"));
        assert_eq!(id.len(), 16);
        assert!(key.is_none());
    }

    #[test]
    fn derive_session_material_encrypted() {
        let secret = [0x42u8; 32];
        let (id, key) = derive_session_material(&secret, true)
            .unwrap_or_else(|e| unreachable!("{e}"));
        assert_eq!(id.len(), 16);
        let key = key.unwrap_or_else(|| unreachable!("expected key"));
        assert_eq!(key.len(), 32);
    }

    #[test]
    fn derive_is_deterministic() {
        let secret = [0xAB; 32];
        let (id_a, key_a) = derive_session_material(&secret, true)
            .unwrap_or_else(|e| unreachable!("{e}"));
        let (id_b, key_b) = derive_session_material(&secret, true)
            .unwrap_or_else(|e| unreachable!("{e}"));
        assert_eq!(id_a, id_b);
        assert_eq!(
            key_a.unwrap_or_else(|| unreachable!("expected key")),
            key_b.unwrap_or_else(|| unreachable!("expected key"))
        );
    }

    #[test]
    fn different_secrets_yield_different_material() {
        let (id_a, _) = derive_session_material(&[0x01; 32], true)
            .unwrap_or_else(|e| unreachable!("{e}"));
        let (id_b, _) = derive_session_material(&[0x02; 32], true)
            .unwrap_or_else(|e| unreachable!("{e}"));
        assert_ne!(id_a, id_b);
    }
}
