// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//
//! `WsTransport` — sends and receives OAAP frames over a WebSocket stream.
//!
//! This is the low-level layer that both [`crate::client`] and [`crate::server`]
//! use. It handles JSON serialization of handshake frames and dispatches incoming
//! text frames by peeking at their `type` field.

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

use crate::error::{Result, WsError};
use crate::frame::{
    ChallengeFrame, EstablishedFrame, MessageFrame, PresentFrame, ProveFrame, TypePeek,
    TYPE_CHALLENGE, TYPE_ESTABLISHED, TYPE_MESSAGE, TYPE_PRESENT, TYPE_PROVE,
};

/// The raw WebSocket stream type (over TCP, possibly TLS).
pub type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// The raw WebSocket stream type for a server-side accepted connection (plain TCP).
pub type WsServerStream = WebSocketStream<TcpStream>;

/// Typed OAAP frames dispatched from the WebSocket.
#[derive(Debug)]
pub enum OaapFrame {
    /// Step 1: `oaap:present`.
    Present(PresentFrame),
    /// Step 2: `oaap:challenge`.
    Challenge(ChallengeFrame),
    /// Step 3: `oaap:prove`.
    Prove(ProveFrame),
    /// Step 4: `oaap:established`.
    Established(EstablishedFrame),
    /// Post-handshake data.
    Message(MessageFrame),
}

/// Sends a serializable frame as a JSON text message.
pub async fn send_frame<S, F>(ws: &mut S, frame: &F) -> Result<()>
where
    S: SinkExt<Message> + Unpin,
    S::Error: std::fmt::Display,
    F: serde::Serialize,
{
    let json = serde_json::to_string(frame)?;
    tracing::trace!(payload_len = json.len(), "sending OAAP frame");
    ws.send(Message::Text(json.into()))
        .await
        .map_err(|e| WsError::Transport(e.to_string()))
}

/// Reads the next text frame from the WebSocket, deserializes and dispatches it.
///
/// Binary frames are silently skipped. Ping/Pong are handled by tungstenite
/// automatically. Close frames cause [`WsError::HandshakeClosed`] with step = 0.
pub async fn recv_frame<S>(ws: &mut S) -> Result<OaapFrame>
where
    S: StreamExt<Item = std::result::Result<Message, tokio_tungstenite::tungstenite::Error>>
        + Unpin,
{
    loop {
        let msg = ws
            .next()
            .await
            .ok_or(WsError::HandshakeClosed { step: 0 })?
            .map_err(WsError::from)?;

        match msg {
            Message::Text(text) => {
                let text_str: &str = text.as_ref();
                return dispatch_text(text_str);
            }
            Message::Binary(_) => {
                tracing::debug!("skipping binary frame during OAAP exchange");
                continue;
            }
            Message::Close(_) => {
                return Err(WsError::HandshakeClosed { step: 0 });
            }
            Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => {
                continue;
            }
        }
    }
}

/// Peek at the `type` field and deserialize into the appropriate variant.
fn dispatch_text(text: &str) -> Result<OaapFrame> {
    let peek: TypePeek = serde_json::from_str(text)?;
    match peek.frame_type.as_str() {
        TYPE_PRESENT => {
            let f: PresentFrame = serde_json::from_str(text)?;
            Ok(OaapFrame::Present(f))
        }
        TYPE_CHALLENGE => {
            let f: ChallengeFrame = serde_json::from_str(text)?;
            Ok(OaapFrame::Challenge(f))
        }
        TYPE_PROVE => {
            let f: ProveFrame = serde_json::from_str(text)?;
            Ok(OaapFrame::Prove(f))
        }
        TYPE_ESTABLISHED => {
            let f: EstablishedFrame = serde_json::from_str(text)?;
            Ok(OaapFrame::Established(f))
        }
        TYPE_MESSAGE => {
            let f: MessageFrame = serde_json::from_str(text)?;
            Ok(OaapFrame::Message(f))
        }
        other => Err(WsError::UnexpectedFrameType {
            expected: "oaap:*",
            actual: other.to_owned(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dispatch_present_frame() {
        let json = serde_json::json!({
            "type": "oaap:present",
            "did": "did:oas:l1fe:agent:test",
            "ephemeral_pub": "aa".repeat(32),
            "verifying_key": "bb".repeat(32),
            "timestamp": "2026-04-11T00:00:00Z"
        })
        .to_string();
        let frame = dispatch_text(&json).unwrap_or_else(|e| unreachable!("{e}"));
        assert!(matches!(frame, OaapFrame::Present(_)));
    }

    #[test]
    fn dispatch_unknown_type_returns_error() {
        let json = r#"{"type":"oaap:unknown"}"#;
        let result = dispatch_text(json);
        assert!(matches!(result, Err(WsError::UnexpectedFrameType { .. })));
    }

    #[test]
    fn dispatch_message_frame() {
        let json = serde_json::json!({
            "type": "oaap:message",
            "session": "cc".repeat(16),
            "payload": "hello",
            "seq": 1
        })
        .to_string();
        let frame = dispatch_text(&json).unwrap_or_else(|e| unreachable!("{e}"));
        assert!(matches!(frame, OaapFrame::Message(_)));
    }
}
