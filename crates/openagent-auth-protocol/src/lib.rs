// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! OpenAgent Auth Protocol (OAAP) — 4-step mutual authentication handshake.
//!
//! # Protocol Steps
//!
//! 1. **PRESENT** — Initiator sends DID document, lineage proof, ephemeral public key
//! 2. **CHALLENGE** — Responder issues a cryptographic nonce challenge
//! 3. **PROVE** — Initiator signs the challenge with its DID private key
//! 4. **ESTABLISHED** — Session is established, responder sends session token
//!
//! This crate defines transport-agnostic types and traits. Concrete transports
//! (gRPC, HTTP, WebSocket, Weave P2P) implement [`transport::AuthTransport`].

#![forbid(unsafe_code)]
#![deny(missing_docs)]
#![deny(rust_2018_idioms)]

pub mod error;
pub mod handshake;
pub mod message;
pub mod session;
pub mod transport;
pub mod types;

pub use error::AuthProtocolError;
pub use message::{
    AuthMessage, ChallengeMessage, EstablishedMessage, PresentMessage, ProveMessage,
};
pub use session::{InMemorySessionStore, Session, SessionId, SessionState, SessionStore};
pub use transport::AuthTransport;
pub use types::{ConformanceLevel, DidDocument, DiscoveryDocument, LineageLink, LineageProof};

/// Current protocol version.
pub const PROTOCOL_VERSION: u32 = 1;

/// Crate version.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
