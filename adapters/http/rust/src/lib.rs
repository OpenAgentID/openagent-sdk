// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! HTTP binding for the OpenAgent Core Protocol identity flow.
//!
//! This crate carries the Section 15 identity flow over HTTP per the
//! specification's Section 16 HTTP binding, providing:
//!
//! - **Server handlers** (`server`): framework-agnostic challenge/prove logic
//! - **Axum integration** (`axum` feature): well-known routes, an extractor
//!   that validates sessions, and the reactive `401` + `WWW-Authenticate`
//!   challenge flow
//! - **Client**: HTTP auth client with session management
//! - **Discovery**: `GET /.well-known/openagent` resolution
//! - **Transport**: [`HttpTransport`] implementing the core `AuthTransport`
//!   trait
//!
//! # Quick Start (Client)
//!
//! ```ignore
//! use openagent_http::client::{ClientConfig, HttpAuthClient};
//! let client = HttpAuthClient::new(config, &signing_key_bytes)?;
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

pub use headers::{HEADER_OPENAGENT_DID, HEADER_OPENAGENT_SESSION, OPENAGENT_AUTH_SCHEME};
pub use transport::HttpTransport;

/// Crate version.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
