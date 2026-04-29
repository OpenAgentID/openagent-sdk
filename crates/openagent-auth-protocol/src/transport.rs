// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! Transport abstraction for OAAP.
//!
//! Adapters (HTTP, gRPC, WebSocket, Weave) implement [`AuthTransport`] to
//! carry the 4-step handshake over their respective wire protocol.

use async_trait::async_trait;

use crate::error::AuthProtocolError;
use crate::message::{ChallengeMessage, EstablishedMessage, PresentMessage, ProveMessage};

/// Transport-agnostic interface for carrying the OAAP handshake.
///
/// Initiators call [`present`] then [`prove`]. Responders handle inbound
/// messages through their framework-specific handler (e.g. Axum route).
#[async_trait]
pub trait AuthTransport: Send + Sync {
    /// Send a PRESENT message and receive the CHALLENGE response.
    async fn present(
        &self,
        endpoint: &str,
        message: &PresentMessage,
    ) -> Result<ChallengeMessage, AuthProtocolError>;

    /// Send a PROVE message and receive the ESTABLISHED response.
    async fn prove(
        &self,
        endpoint: &str,
        message: &ProveMessage,
    ) -> Result<EstablishedMessage, AuthProtocolError>;
}
