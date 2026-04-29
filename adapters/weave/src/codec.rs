// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! CBOR message framing codec for the Weave auth protocol.
//!
//! Messages are length-prefixed on the wire:
//!
//! ```text
//! +-------------------+---------------------------+
//! | length (4 bytes)  | CBOR payload (N bytes)    |
//! | big-endian u32    |                           |
//! +-------------------+---------------------------+
//! ```
//!
//! This codec implements libp2p's [`request_response::Codec`] trait so it can
//! plug directly into a `request_response::Behaviour`.

use std::io;

use async_trait::async_trait;
use futures::prelude::*;
use libp2p::request_response;

use crate::config::WeaveAuthConfig;
use crate::error::WeaveAuthError;
use crate::protocol::{HandshakeRequest, HandshakeResponse};

/// CBOR codec for OpenAgent auth handshake messages.
#[derive(Debug, Clone)]
pub struct CborCodec {
    max_message_size: usize,
}

impl CborCodec {
    /// Creates a new codec with the given maximum message size.
    pub fn new(config: &WeaveAuthConfig) -> Self {
        Self {
            max_message_size: config.max_message_size,
        }
    }
}

impl Default for CborCodec {
    fn default() -> Self {
        Self {
            max_message_size: WeaveAuthConfig::default().max_message_size,
        }
    }
}

/// Encode a CBOR message with a 4-byte big-endian length prefix.
pub fn encode_frame<T: serde::Serialize>(value: &T, max_size: usize) -> Result<Vec<u8>, WeaveAuthError> {
    let mut payload = Vec::new();
    ciborium::into_writer(value, &mut payload)?;

    if payload.len() > max_size {
        return Err(WeaveAuthError::MessageTooLarge {
            size: payload.len(),
            limit: max_size,
        });
    }

    let len = payload.len() as u32;
    let mut frame = Vec::with_capacity(4 + payload.len());
    frame.extend_from_slice(&len.to_be_bytes());
    frame.extend_from_slice(&payload);
    Ok(frame)
}

/// Decode a length-prefixed CBOR message from a byte buffer.
pub fn decode_frame<T: serde::de::DeserializeOwned>(
    data: &[u8],
    max_size: usize,
) -> Result<T, WeaveAuthError> {
    if data.len() < 4 {
        return Err(WeaveAuthError::Codec("frame too short for length prefix".into()));
    }

    let len = u32::from_be_bytes([data[0], data[1], data[2], data[3]]) as usize;

    if len > max_size {
        return Err(WeaveAuthError::MessageTooLarge {
            size: len,
            limit: max_size,
        });
    }

    let payload_end = 4 + len;
    if data.len() < payload_end {
        return Err(WeaveAuthError::Codec(format!(
            "incomplete frame: expected {} bytes, got {}",
            payload_end,
            data.len()
        )));
    }

    let value: T = ciborium::from_reader(&data[4..payload_end])?;
    Ok(value)
}

// ---------------------------------------------------------------------------
// libp2p Codec implementation
// ---------------------------------------------------------------------------

#[async_trait]
impl request_response::Codec for CborCodec {
    type Protocol = libp2p::StreamProtocol;
    type Request = HandshakeRequest;
    type Response = HandshakeResponse;

    async fn read_request<T>(
        &mut self,
        _protocol: &Self::Protocol,
        io: &mut T,
    ) -> io::Result<Self::Request>
    where
        T: AsyncRead + Unpin + Send,
    {
        read_length_prefixed_cbor(io, self.max_message_size).await
    }

    async fn read_response<T>(
        &mut self,
        _protocol: &Self::Protocol,
        io: &mut T,
    ) -> io::Result<Self::Response>
    where
        T: AsyncRead + Unpin + Send,
    {
        read_length_prefixed_cbor(io, self.max_message_size).await
    }

    async fn write_request<T>(
        &mut self,
        _protocol: &Self::Protocol,
        io: &mut T,
        req: Self::Request,
    ) -> io::Result<()>
    where
        T: AsyncWrite + Unpin + Send,
    {
        write_length_prefixed_cbor(io, &req, self.max_message_size).await
    }

    async fn write_response<T>(
        &mut self,
        _protocol: &Self::Protocol,
        io: &mut T,
        resp: Self::Response,
    ) -> io::Result<()>
    where
        T: AsyncWrite + Unpin + Send,
    {
        write_length_prefixed_cbor(io, &resp, self.max_message_size).await
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async fn read_length_prefixed_cbor<T, V>(io: &mut T, max_size: usize) -> io::Result<V>
where
    T: AsyncRead + Unpin + Send,
    V: serde::de::DeserializeOwned,
{
    // Read 4-byte length prefix.
    let mut len_buf = [0u8; 4];
    io.read_exact(&mut len_buf).await?;
    let len = u32::from_be_bytes(len_buf) as usize;

    if len > max_size {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "message too large: {len} bytes exceeds limit of {max_size} bytes"
            ),
        ));
    }

    // Read payload.
    let mut payload = vec![0u8; len];
    io.read_exact(&mut payload).await?;

    ciborium::from_reader(&payload[..]).map_err(|e| {
        io::Error::new(io::ErrorKind::InvalidData, format!("cbor decode: {e}"))
    })
}

async fn write_length_prefixed_cbor<T, V>(
    io: &mut T,
    value: &V,
    max_size: usize,
) -> io::Result<()>
where
    T: AsyncWrite + Unpin + Send,
    V: serde::Serialize,
{
    let mut payload = Vec::new();
    ciborium::into_writer(value, &mut payload).map_err(|e| {
        io::Error::new(io::ErrorKind::InvalidData, format!("cbor encode: {e}"))
    })?;

    if payload.len() > max_size {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "message too large: {} bytes exceeds limit of {max_size} bytes",
                payload.len()
            ),
        ));
    }

    let len = payload.len() as u32;
    io.write_all(&len.to_be_bytes()).await?;
    io.write_all(&payload).await?;
    io.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{HandshakeRequest, HandshakeResponse};
    use openagent_auth_protocol::types::{
        ChallengeMessage, ConformanceLevel, PresentMessage, DidDocument, LineageProof,
    };

    #[test]
    fn encode_decode_request_round_trips() {
        let req = HandshakeRequest::Present(PresentMessage {
            version: 1,
            did_document: DidDocument {
                id: "did:oas:test:agent:alice".into(),
                verification_key: "z6Mktest".into(),
                kind: "agent".into(),
                parent: None,
            },
            lineage_proof: LineageProof { chain: vec![] },
            ephemeral_pubkey: "AAAA".into(),
        });

        let frame = encode_frame(&req, 64 * 1024).unwrap_or_else(|e| {
            panic!("encode failed: {e}");
        });
        let decoded: HandshakeRequest = decode_frame(&frame, 64 * 1024).unwrap_or_else(|e| {
            panic!("decode failed: {e}");
        });

        match decoded {
            HandshakeRequest::Present(p) => {
                assert_eq!(p.did_document.id, "did:oas:test:agent:alice");
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn encode_decode_response_round_trips() {
        let resp = HandshakeResponse::Challenge(ChallengeMessage {
            session_id: "sess-001".into(),
            server_nonce: "bm9uY2U=".into(),
            server_did: "did:oas:test:agent:bob".into(),
            server_ephemeral_pubkey: "BBBB".into(),
            required_conformance: ConformanceLevel::L2,
            expires_in: 60,
        });

        let frame = encode_frame(&resp, 64 * 1024).unwrap_or_else(|e| {
            panic!("encode failed: {e}");
        });
        let decoded: HandshakeResponse = decode_frame(&frame, 64 * 1024).unwrap_or_else(|e| {
            panic!("decode failed: {e}");
        });

        match decoded {
            HandshakeResponse::Challenge(c) => {
                assert_eq!(c.session_id, "sess-001");
                assert_eq!(c.required_conformance, ConformanceLevel::L2);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn rejects_oversized_message() {
        let req = HandshakeRequest::Present(PresentMessage {
            version: 1,
            did_document: DidDocument {
                id: "did:oas:test:agent:alice".into(),
                verification_key: "z6Mktest".into(),
                kind: "agent".into(),
                parent: None,
            },
            lineage_proof: LineageProof { chain: vec![] },
            ephemeral_pubkey: "AAAA".into(),
        });

        // Tiny limit — should fail.
        let result = encode_frame(&req, 8);
        assert!(result.is_err());
    }

    #[test]
    fn rejects_truncated_frame() {
        let result: Result<HandshakeRequest, _> = decode_frame(&[0, 0, 0, 10, 1, 2], 64 * 1024);
        assert!(result.is_err());
    }
}
