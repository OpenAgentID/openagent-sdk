// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! Transport abstraction for the Core Protocol identity flow.
//!
//! Adapters (HTTP, WebSocket, Weave) implement [`AuthTransport`] to carry the
//! three identity-flow messages over their respective wire protocol. The
//! message semantics are defined normatively by the Core Protocol
//! Specification Section 15; transport bindings by Section 16.

use async_trait::async_trait;

use crate::error::AuthProtocolError;
use crate::message::{IdentityChallenge, IdentityProof, IdentityVerified};

/// Transport-agnostic interface for the agent side of the identity flow.
///
/// The agent either receives a challenge passively (a `401` with a
/// `WWW-Authenticate` challenge on the HTTP binding) or fetches one
/// proactively, then proves. Responders handle inbound proofs through their
/// framework-specific integration (e.g. an Axum layer).
#[async_trait]
pub trait AuthTransport: Send + Sync {
    /// Request a challenge from the server (proactive flow).
    async fn fetch_challenge(&self, endpoint: &str)
        -> Result<IdentityChallenge, AuthProtocolError>;

    /// Send an [`IdentityProof`] and receive the [`IdentityVerified`] session.
    async fn prove(
        &self,
        endpoint: &str,
        proof: &IdentityProof,
    ) -> Result<IdentityVerified, AuthProtocolError>;
}
