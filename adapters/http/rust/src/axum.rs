// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! Axum integration: middleware Layer and Extractor for OAAP.
//!
//! # Usage
//!
//! ```ignore
//! use openagent_http::axum::{OpenAgentLayer, OpenAgentExtractor};
//! use axum::{Router, routing::post, Json};
//!
//! let config = ServerConfig::new("did:oas:l1fe:service:api");
//! let store = InMemorySessionStore::new();
//! let state = OpenAgentState::new(config, store);
//!
//! let app = Router::new()
//!     .route("/api/tools", post(handle_tools))
//!     .layer(OpenAgentLayer::new(state.clone()));
//! ```

use std::sync::Arc;

use ::axum::{
    extract::{FromRequestParts, Request},
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use openagent_auth_protocol::message::{ChallengeMessage, EstablishedMessage, PresentMessage, ProveMessage};
use openagent_auth_protocol::session::{InMemorySessionStore, Session, SessionStore};
use openagent_auth_protocol::types::DiscoveryDocument;

use crate::headers;
use crate::server::{self, ServerConfig};

/// Shared state for the OAAP Axum integration.
#[derive(Clone)]
pub struct OpenAgentState<S: SessionStore + Clone + 'static = InMemorySessionStore> {
    config: Arc<ServerConfig>,
    store: Arc<S>,
    /// Ed25519 verification key lookup function.
    /// In production, this resolves DIDs to their verification keys.
    /// For testing, a static key can be provided.
    verify_key_fn: Arc<dyn Fn(&str) -> Option<[u8; 32]> + Send + Sync>,
}

impl<S: SessionStore + Clone + 'static> OpenAgentState<S> {
    /// Creates a new OAAP state with a verification key resolver.
    pub fn new(
        config: ServerConfig,
        store: S,
        verify_key_fn: impl Fn(&str) -> Option<[u8; 32]> + Send + Sync + 'static,
    ) -> Self {
        Self {
            config: Arc::new(config),
            store: Arc::new(store),
            verify_key_fn: Arc::new(verify_key_fn),
        }
    }

    /// Creates state with a no-op key resolver (for testing discovery/present only).
    pub fn new_without_verification(config: ServerConfig, store: S) -> Self {
        Self {
            config: Arc::new(config),
            store: Arc::new(store),
            verify_key_fn: Arc::new(|_| None),
        }
    }
}

/// Axum extractor that provides the authenticated agent context.
///
/// Routes guarded by `OpenAgentLayer` can extract this to get the
/// authenticated agent's DID and session information.
#[derive(Debug, Clone)]
pub struct OpenAgentExtractor {
    session: Session,
}

impl OpenAgentExtractor {
    /// Returns the authenticated agent's DID.
    pub fn peer_did(&self) -> &str {
        &self.session.initiator_did
    }

    /// Returns the session ID.
    pub fn session_id(&self) -> &str {
        &self.session.id
    }

    /// Returns the underlying session.
    pub fn session(&self) -> &Session {
        &self.session
    }
}

impl<S> FromRequestParts<OpenAgentState<S>> for OpenAgentExtractor
where
    S: SessionStore + Clone + Send + Sync + 'static,
{
    type Rejection = Response;

    fn from_request_parts(
        parts: &mut Parts,
        state: &OpenAgentState<S>,
    ) -> impl std::future::Future<Output = Result<Self, Self::Rejection>> + Send {
        let session_header = parts
            .headers
            .get(headers::HEADER_OPENAGENT_SESSION)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_owned());

        let store = Arc::clone(&state.store);

        async move {
            let session_id = session_header.ok_or_else(|| {
                (StatusCode::UNAUTHORIZED, "Missing X-OpenAgent-Session header").into_response()
            })?;

            let session = server::validate_authenticated_request(store.as_ref(), &session_id)
                .await
                .map_err(|e| {
                    tracing::debug!(error = %e, "OAAP auth validation failed");
                    (StatusCode::UNAUTHORIZED, format!("Authentication failed: {e}")).into_response()
                })?;

            Ok(OpenAgentExtractor { session })
        }
    }
}

/// Build an Axum router with the OAAP well-known endpoints.
///
/// This adds three routes:
/// - `GET /.well-known/openagent` — Discovery
/// - `POST /.well-known/openagent/auth` — PRESENT -> CHALLENGE
/// - `POST /.well-known/openagent/auth/prove` — PROVE -> ESTABLISHED
pub fn oaap_routes<S>(state: OpenAgentState<S>) -> Router
where
    S: SessionStore + Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/.well-known/openagent",
            get({
                let state = state.clone();
                move || async move {
                    let doc = server::handle_discovery(&state.config);
                    Json(doc)
                }
            }),
        )
        .route(
            "/.well-known/openagent/auth",
            post({
                let state = state.clone();
                move |Json(msg): Json<PresentMessage>| {
                    let state = state.clone();
                    async move {
                        match server::handle_present(&state.config, state.store.as_ref(), msg).await {
                            Ok(challenge) => (StatusCode::OK, Json(challenge)).into_response(),
                            Err(e) => {
                                tracing::warn!(error = %e, "PRESENT handler error");
                                (StatusCode::BAD_REQUEST, e.to_string()).into_response()
                            }
                        }
                    }
                }
            }),
        )
        .route(
            "/.well-known/openagent/auth/prove",
            post({
                let state = state.clone();
                move |Json(msg): Json<ProveMessage>| {
                    let state = state.clone();
                    async move {
                        // Look up the verification key for the DID.
                        let vk = (state.verify_key_fn)(&msg.did);
                        match vk {
                            Some(key) => {
                                match server::handle_prove(
                                    &state.config,
                                    state.store.as_ref(),
                                    msg,
                                    &key,
                                )
                                .await
                                {
                                    Ok(established) => {
                                        (StatusCode::OK, Json(established)).into_response()
                                    }
                                    Err(e) => {
                                        tracing::warn!(error = %e, "PROVE handler error");
                                        (StatusCode::UNAUTHORIZED, e.to_string()).into_response()
                                    }
                                }
                            }
                            None => (
                                StatusCode::UNAUTHORIZED,
                                format!("Unknown DID: {}", msg.did),
                            )
                                .into_response(),
                        }
                    }
                }
            }),
        )
}

/// Convenience: Build a complete OAAP-protected Axum router.
///
/// Merges the well-known endpoints with your application routes.
pub fn protected_router<S>(
    state: OpenAgentState<S>,
    app_routes: Router<OpenAgentState<S>>,
) -> Router
where
    S: SessionStore + Clone + Send + Sync + 'static,
{
    let well_known = oaap_routes(state.clone());
    well_known.merge(app_routes.with_state(state))
}
