// Copyright (c) 2026 L1fe Labs, Inc. — Apache-2.0 OR MIT
//! Axum integration for the Core Protocol identity flow.
//!
//! # Usage
//!
//! ```ignore
//! use openagent_http::axum::{core_routes, OpenAgentExtractor, OpenAgentState};
//! use openagent_http::server::ServerConfig;
//! use openagent_auth_protocol::session::InMemorySessionStore;
//!
//! let state = OpenAgentState::new(
//!     ServerConfig::new("https://api.example.com"),
//!     InMemorySessionStore::new(),
//! );
//! let app = core_routes(state.clone());
//! ```

use std::sync::Arc;

use ::axum::{
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use openagent_auth_protocol::message::IdentityProof;
use openagent_auth_protocol::session::{InMemorySessionStore, Session, SessionStore};

use crate::headers;
use crate::server::{self, ServerConfig};

/// Shared state for the Axum integration.
#[derive(Clone)]
pub struct OpenAgentState<S: SessionStore + Clone + 'static = InMemorySessionStore> {
    /// The server configuration (origin, realm, TTLs, trust tier).
    pub config: Arc<ServerConfig>,
    store: Arc<S>,
}

impl<S: SessionStore + Clone + 'static> OpenAgentState<S> {
    /// Creates a new integration state.
    pub fn new(config: ServerConfig, store: S) -> Self {
        Self {
            config: Arc::new(config),
            store: Arc::new(store),
        }
    }

    /// The session store.
    pub fn store(&self) -> &S {
        &self.store
    }
}

/// Axum extractor providing the authenticated agent context.
///
/// Routes can take this as an argument to get the verified session.
#[derive(Debug, Clone)]
pub struct OpenAgentExtractor {
    session: Session,
}

impl OpenAgentExtractor {
    /// Returns the authenticated agent's DID (or presented-key placeholder
    /// until a resolver names it).
    pub fn peer_did(&self) -> &str {
        &self.session.initiator_did
    }

    /// Returns the session token.
    pub fn session_token(&self) -> &str {
        &self.session.id
    }

    /// Returns the underlying session.
    pub fn session(&self) -> &Session {
        &self.session
    }
}

#[axum::async_trait]
impl<S> FromRequestParts<OpenAgentState<S>> for OpenAgentExtractor
where
    S: SessionStore + Clone + Send + Sync + 'static,
{
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &OpenAgentState<S>,
    ) -> Result<Self, Self::Rejection> {
        let token = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(headers::extract_openagent_token)
            .map(|s| s.to_owned());

        let token = match token {
            Some(t) => t,
            None => {
                // The reactive flow, per the HTTP binding: a request with no
                // usable credential gets a 401 carrying a fresh challenge in
                // WWW-Authenticate.
                return Err(challenge_response(state).await);
            }
        };

        let session =
            match server::validate_authenticated_request(state.store.as_ref(), &token).await {
                Ok(s) => s,
                Err(e) => {
                    tracing::debug!(error = %e, "session validation failed");
                    return Err(challenge_response(state).await);
                }
            };

        Ok(OpenAgentExtractor { session })
    }
}

/// Build a `401 Unauthorized` response carrying a fresh challenge in
/// `WWW-Authenticate`, per the HTTP binding's reactive flow.
async fn challenge_response<S: SessionStore + Clone + Send + Sync + 'static>(
    state: &OpenAgentState<S>,
) -> Response {
    match server::handle_challenge(&state.config, state.store.as_ref()).await {
        Ok(challenge) => {
            let header = headers::build_challenge_header(&challenge);
            (
                StatusCode::UNAUTHORIZED,
                [(axum::http::header::WWW_AUTHENTICATE, header)],
                Json(challenge),
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "failed to issue challenge");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to issue challenge",
            )
                .into_response()
        }
    }
}

/// Build an Axum router with the well-known endpoints:
///
/// - `GET /.well-known/openagent` — discovery
/// - `POST /.well-known/openagent/auth` — issue an [`openagent_auth_protocol::message::IdentityChallenge`]
/// - `POST /.well-known/openagent/auth/prove` — verify an [`IdentityProof`], return [`IdentityVerified`]
pub fn core_routes<S>(state: OpenAgentState<S>) -> Router
where
    S: SessionStore + Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/.well-known/openagent",
            get({
                let state = state.clone();
                move || async move { Json(server::handle_discovery(&state.config)) }
            }),
        )
        .route(
            "/.well-known/openagent/auth",
            post({
                let state = state.clone();
                move || {
                    let state = state.clone();
                    async move {
                        match server::handle_challenge(&state.config, state.store.as_ref()).await {
                            Ok(challenge) => (StatusCode::OK, Json(challenge)).into_response(),
                            Err(e) => {
                                tracing::warn!(error = %e, "challenge handler error");
                                (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
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
                move |Json(proof): Json<IdentityProof>| {
                    let state = state.clone();
                    async move {
                        match server::handle_prove(&state.config, state.store.as_ref(), &proof)
                            .await
                        {
                            Ok(verified) => (StatusCode::OK, Json(verified)).into_response(),
                            Err(e) => {
                                tracing::warn!(error = %e, "prove handler error");
                                (StatusCode::UNAUTHORIZED, e.to_string()).into_response()
                            }
                        }
                    }
                }
            }),
        )
}

/// Convenience: merge the well-known endpoints with application routes.
pub fn protected_router<S>(
    state: OpenAgentState<S>,
    app_routes: Router<OpenAgentState<S>>,
) -> Router
where
    S: SessionStore + Clone + Send + Sync + 'static,
{
    core_routes(state.clone()).merge(app_routes.with_state(state))
}
