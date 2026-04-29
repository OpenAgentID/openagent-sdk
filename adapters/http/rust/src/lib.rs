// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! HTTP adapter for the OpenAgent Auth Protocol (OAAP).
//!
//! This crate maps the OAAP 4-step mutual authentication handshake to HTTP,
//! providing:
//!
//! - **Server middleware** (`axum` feature): Drop-in Axum [`Layer`] + [`Extractor`]
//! - **Client**: HTTP-based auth client with session management
//! - **Discovery**: `GET /.well-known/openagent` resolution
//! - **Transport**: [`HttpTransport`] implementing the core `AuthTransport` trait
//!
//! # Quick Start (Server)
//!
//! ```ignore
//! use openagent_http::axum::{OpenAgentLayer, OpenAgentExtractor};
//! use axum::{Router, routing::post, Json};
//!
//! let app = Router::new()
//!     .route("/api/tools", post(handle_tools))
//!     .layer(OpenAgentLayer::new(config));
//!
//! async fn handle_tools(ctx: OpenAgentExtractor, body: Json<serde_json::Value>) {
//!     println!("Agent: {}", ctx.peer_did());
//! }
//! ```
//!
//! # Quick Start (Client)
//!
//! ```ignore
//! use openagent_http::client::HttpAuthClient;
//! let client = HttpAuthClient::new(config);
//! let session = client.authenticate("https://api.example.com").await?;
//! let resp = session.get("/tools").await?;
//! ```

#![forbid(unsafe_code)]
#![deny(missing_docs)]
#![deny(rust_2018_idioms)]

pub mod client;
pub mod discovery;
pub mod headers;
pub mod server;
pub mod session;
pub mod transport;

#[cfg(feature = "axum-integration")]
pub mod axum;

pub use headers::{HEADER_OPENAGENT_DID, HEADER_OPENAGENT_SESSION, OAS_AUTH_SCHEME};
pub use transport::HttpTransport;

/// Crate version.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
