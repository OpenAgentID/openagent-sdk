// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//
//! # openagent-ws
//!
//! WebSocket adapter for the OpenAgent Auth Protocol (OAAP).
//!
//! Maps the 4-step OAAP handshake onto WebSocket connections for real-time
//! agent-to-agent communication, streaming, and event-driven architectures.
//!
//! ## Wire Protocol
//!
//! ```text
//! WebSocket connection opened
//!   -> Client sends: { type: "oaap:present", ... }       (JSON text frame)
//!   <- Server sends: { type: "oaap:challenge", ... }
//!   -> Client sends: { type: "oaap:prove", ... }
//!   <- Server sends: { type: "oaap:established", ... }
//!
//! After handshake:
//!   All subsequent frames carry:
//!   { type: "oaap:message", session: "<id>", payload: "<encrypted_or_plain>" }
//! ```
//!
//! ## Server usage
//!
//! ```ignore
//! use openagent_ws::{OpenAgentWsHandler, AuthenticatedSession};
//!
//! let handler = OpenAgentWsHandler::new(my_did, my_signing_key, my_verifying_key);
//! let session = handler.accept(ws_stream).await?;
//! session.send(b"hello agent").await?;
//! ```
//!
//! ## Client usage
//!
//! ```ignore
//! use openagent_ws::OpenAgentWsClient;
//!
//! let client = OpenAgentWsClient::new(my_did, my_signing_key, my_verifying_key);
//! let session = client.connect("wss://example.com/ws").await?;
//! let msg = session.receive().await?;
//! ```
//!
//! ## Encryption
//!
//! After the handshake, both sides derive a shared secret via X25519 ECDH. When
//! encryption is enabled (the default), all message payloads are AES-256-GCM
//! encrypted with the HKDF-derived session key. Each frame carries a fresh
//! random nonce and a monotonically increasing sequence number for replay
//! protection.

#![forbid(unsafe_code)]
#![deny(missing_docs)]
#![deny(rust_2018_idioms)]

pub mod client;
pub mod error;
pub mod frame;
pub mod server;
pub mod session;
pub mod transport;

// ── Top-level re-exports ──────────────────────────────────────────────

pub use client::OpenAgentWsClient;
pub use error::{Result, WsError};
pub use server::OpenAgentWsHandler;
pub use session::AuthenticatedSession;

/// Crate version sourced from `Cargo.toml`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
