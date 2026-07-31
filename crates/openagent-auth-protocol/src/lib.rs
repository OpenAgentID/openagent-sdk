// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! `openagent-auth-protocol` — the transport-agnostic type layer for the
//! **OpenAgent Core Protocol** identity flow.
//!
//! # This crate implements a specification; it does not define one
//!
//! The normative protocol document is the OpenAgent Core Protocol
//! Specification (`openagents/openagent.id/OPENAGENT-CORE-SPEC.md`):
//! abstract messages in Section 15, transport bindings in Section 16. If this
//! crate disagrees with the specification, the specification is correct.
//!
//! # Identity flow (Section 15.1)
//!
//! 1. **IdentityChallenge** — the server issues a cryptographic challenge
//!    (`openagent-challenge-v1`: nonce, timestamp, origin, optional realm)
//! 2. **IdentityProof** — the agent signs the JCS-canonicalized (RFC 8785)
//!    challenge bytes with its DID key
//! 3. **IdentityVerified** — the server confirms identity and issues a
//!    session token
//!
//! Concrete transports (HTTP, WebSocket, Weave) implement
//! [`transport::AuthTransport`].
//!
//! # History
//!
//! This crate was previously "OAAP", a separate 4-step mutual-authentication
//! protocol (PRESENT / CHALLENGE / PROVE / ESTABLISHED with an embedded
//! lineage push and BLAKE3 tuple hashing) that diverged from the Core
//! Protocol while claiming adjacency to it — and for a stretch did not
//! compile at all (its two error enums disagreed). The Core Protocol is the
//! one normative authentication protocol for the stack; the old vocabulary
//! is retired.
//!
//! Lineage presentation is deliberately not part of this flow: the agent
//! presents a proof of key possession, and the *server* resolves the DID
//! document and evaluates lineage with its own trust policy (and, for
//! privileged authority, the OAS lineage contracts). A protocol that lets
//! the caller push its own proofs trades server-side verification for
//! caller-side assertion.

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
    IdentityChallenge, IdentityProof, IdentityVerified, KeyType, TrustTier, CHALLENGE_TYPE,
};
pub use session::{InMemorySessionStore, Session, SessionId, SessionState, SessionStore};
pub use transport::AuthTransport;
pub use types::{ConformanceLevel, DidDocument, DiscoveryDocument, LineageLink, LineageProof};

/// Crate version.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
