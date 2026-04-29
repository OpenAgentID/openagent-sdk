// Copyright (c) 2026 L1fe Labs, Inc. -- Apache-2.0 OR MIT
//
//! # openagent-oidc
//!
//! OIDC/OAuth2 bridge for the OpenAgent SDK. Maps between human OIDC tokens
//! (Okta, Auth0, Keycloak, Azure AD, Google) and OAS agent DIDs + Arsenal
//! capability tokens.
//!
//! Enterprises add agent authentication ALONGSIDE their existing human auth
//! without replacing anything.
//!
//! ## Three Flows
//!
//! | Flow | Direction | Description |
//! |------|-----------|-------------|
//! | 1 | Human JWT -> Agent DID | Derive an agent under a human's lineage |
//! | 2 | Agent ACT -> Bearer JWT | Wrap ACTs for OAuth2-only services |
//! | 3 | Token Exchange (RFC 8693) | Standard token swap endpoint |
//!
//! ## Quick Start
//!
//! ```ignore
//! use openagent_oidc::{OidcBridge, OidcConfig, ProviderConfig};
//!
//! let bridge = OidcBridge::new(OidcConfig::single(
//!     ProviderConfig::new("okta", "https://dev-123.okta.com/oauth2/default")
//!         .with_audience("my-app"),
//! ))?;
//!
//! // Flow 1
//! let agent = bridge.derive_agent_from_jwt(&jwt_string, "my-bot").await?;
//! println!("Agent DID: {}", agent.agent_did);
//! println!("Parent HMR: {}", agent.parent_hmr_did);
//!
//! // Flow 2
//! let jwt = bridge.wrap_act_as_jwt(
//!     &agent.agent_did,
//!     "https://bridge.openagent.id",
//!     None, &scopes, 1, &agent.parent_hmr_did,
//!     &act_b64, &signing_key, Algorithm::EdDSA, None,
//! )?;
//!
//! // Flow 3
//! let response = bridge.exchange_token_simple(
//!     &human_jwt, &["openai:chat:completions"],
//!     &signing_key, Algorithm::EdDSA, "https://bridge.openagent.id",
//! ).await?;
//! ```
//!
//! ## Multi-Provider Support
//!
//! ```ignore
//! let bridge = OidcBridge::new(OidcConfig::multi(vec![
//!     ProviderConfig::new("okta", "https://dev-123.okta.com/oauth2/default")
//!         .with_audience("my-app"),
//!     ProviderConfig::new("azure", "https://login.microsoftonline.com/tenant-id/v2.0")
//!         .with_audience("api://my-api"),
//!     ProviderConfig::new("google", "https://accounts.google.com")
//!         .with_audience("my-client-id.apps.googleusercontent.com"),
//! ]))?;
//!
//! // Bridge auto-detects provider from JWT issuer claim.
//! let agent = bridge.derive_agent_from_jwt(&jwt_string, "my-bot").await?;
//! ```

#![forbid(unsafe_code)]
#![deny(missing_docs)]
#![deny(rust_2018_idioms)]

pub mod bridge;
pub mod config;
pub mod discovery;
pub mod error;
pub mod exchange;
pub mod jwks;
pub mod jwt;
pub mod mapping;

// Re-export the primary types for ergonomic use.
pub use bridge::OidcBridge;
pub use config::{OidcConfig, ProviderConfig};
pub use error::{OidcBridgeError, Result};
pub use exchange::{TokenExchangeRequest, TokenExchangeResponse};
pub use jwt::{ActJwtClaims, ValidatedClaims};
pub use mapping::DerivedAgent;

/// Crate version, sourced from `Cargo.toml` at compile time.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
