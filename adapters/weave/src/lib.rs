// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! # openagent-weave
//!
//! Weave/libp2p transport adapter for the OpenAgent Auth Protocol (OAAP).
//!
//! This crate maps OAAP's 4-step mutual authentication handshake onto a custom
//! libp2p request-response protocol (`/openagent/auth/1.0.0`). It provides:
//!
//! - A [`WeaveTransport`] that implements [`AuthTransport`] from the OAAP core.
//! - A [`WeaveAuthBehaviour`] (`NetworkBehaviour`) that can be composed into any
//!   libp2p swarm.
//! - CBOR message framing via [`codec`] — efficient binary encoding for P2P.
//! - Per-peer authentication state tracking via [`peer_auth`].
//! - Configurable timeouts and message size limits via [`config`].
//!
//! ## Protocol ID
//!
//! `/openagent/auth/1.0.0`
//!
//! ## Wire mapping
//!
//! The 4 OAAP messages map to a libp2p request-response exchange:
//!
//! - **Request** = `HandshakeRequest` containing either PRESENT or PROVE
//! - **Response** = `HandshakeResponse` containing either CHALLENGE or ESTABLISHED
//!
//! The handshake requires two request-response round trips:
//!
//! 1. Initiator sends `Request::Present` → receives `Response::Challenge`
//! 2. Initiator sends `Request::Prove` → receives `Response::Established`

#![forbid(unsafe_code)]
#![deny(missing_docs)]
#![deny(rust_2018_idioms)]

pub mod codec;
pub mod config;
pub mod error;
pub mod handler;
pub mod peer_auth;
pub mod protocol;
pub mod transport;

pub use config::WeaveAuthConfig;
pub use error::WeaveAuthError;
pub use handler::HandshakeHandler;
pub use peer_auth::{PeerAuthState, PeerAuthStore};
pub use protocol::{
    HandshakeRequest, HandshakeResponse, WeaveAuthBehaviour, WeaveAuthEvent,
    OPENAGENT_AUTH_PROTOCOL,
};
pub use transport::WeaveTransport;
