//! Arsenal credentials wrapper.
//!
//! This module hides Arsenal's session/capability/proxy three-step under a
//! single object, [`CredentialClient`], that knows how to:
//!
//! 1. Hold an [`arsenal_sdk::ArsenalClient`] and an active session.
//! 2. Mint a capability token for a given set of scopes on demand.
//! 3. Issue HTTP requests through the broker's credential proxy so that
//!    `{{VARIABLE}}` placeholders are resolved server-side and the agent
//!    never sees raw credentials.

use std::collections::BTreeMap;
use std::sync::Arc;

use arsenal_core::proxy::{ProxyRequest, ProxyResponse};
use arsenal_core::token::AgentCapabilityToken;
use arsenal_sdk::{ArsenalClient, CapabilityRequest};
use tokio::sync::RwLock;

use crate::errors::{OpenAgentError, Result};

/// Encode an [`AgentCapabilityToken`] as base64url for transport on the wire.
fn encode_token(token: &AgentCapabilityToken) -> Result<String> {
    use base64::Engine;
    let bytes = token.to_cbor().map_err(OpenAgentError::from)?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

/// Builder-friendly handle to Arsenal-backed credentials for one agent.
///
/// `CredentialClient` is `Clone` (via `Arc`) so multiple call sites in an
/// agent can share one underlying broker connection. Internally it holds:
///
/// - the [`ArsenalClient`] (broker connection + identity),
/// - the agent's default scopes,
/// - the most-recently issued capability token (cached in the client itself),
/// - a default audience hint for the broker.
#[derive(Clone)]
pub struct CredentialClient {
    inner: Arc<CredentialInner>,
}

struct CredentialInner {
    client: ArsenalClient,
    default_scopes: Vec<String>,
    default_ttl_seconds: i64,
    /// Tracks whether `start_session` has already been called.
    session_started: RwLock<bool>,
}

impl CredentialClient {
    /// Wrap an existing [`ArsenalClient`] into a [`CredentialClient`].
    ///
    /// `default_scopes` are advertised on every capability request unless the
    /// caller passes more specific scopes via [`Self::request_token`].
    pub fn new(
        client: ArsenalClient,
        default_scopes: Vec<String>,
        default_ttl_seconds: i64,
    ) -> Self {
        Self {
            inner: Arc::new(CredentialInner {
                client,
                default_scopes,
                default_ttl_seconds,
                session_started: RwLock::new(false),
            }),
        }
    }

    /// Default scopes this credential client was constructed with.
    pub fn default_scopes(&self) -> &[String] {
        &self.inner.default_scopes
    }

    /// Ensure the underlying Arsenal session is open.
    ///
    /// Idempotent — safe to call from every entry point. The first call opens
    /// the session; subsequent calls are no-ops.
    ///
    /// # Errors
    ///
    /// Returns [`OpenAgentError::Credential`] if the broker rejects the
    /// session.
    pub async fn ensure_session(&self) -> Result<()> {
        {
            let started = self.inner.session_started.read().await;
            if *started && self.inner.client.has_active_session().await {
                return Ok(());
            }
        }
        let mut started = self.inner.session_started.write().await;
        if !*started || !self.inner.client.has_active_session().await {
            self.inner.client.start_session().await?;
            *started = true;
        }
        Ok(())
    }

    /// Request a capability token for the given scopes.
    ///
    /// If `scopes` is empty the client falls back to the default scopes
    /// supplied at construction.
    ///
    /// # Errors
    ///
    /// Returns [`OpenAgentError::Credential`] if the broker rejects the
    /// request or no scopes were configured.
    pub async fn request_token(&self, scopes: &[&str]) -> Result<String> {
        self.ensure_session().await?;

        let owned_scopes: Vec<String> = if scopes.is_empty() {
            self.inner.default_scopes.clone()
        } else {
            scopes.iter().map(|s| (*s).to_string()).collect()
        };

        if owned_scopes.is_empty() {
            return Err(OpenAgentError::config(
                "no scopes provided and no default scopes configured",
            ));
        }

        let scope_refs: Vec<&str> = owned_scopes.iter().map(String::as_str).collect();

        let mut request = CapabilityRequest::new()
            .scopes(&scope_refs)
            .map_err(OpenAgentError::from)?;
        request = request.ttl_seconds(self.inner.default_ttl_seconds);

        let handle = self.inner.client.request_capability(request).await?;
        encode_token(handle.token())
    }

    /// Send an HTTP `GET` through the credential proxy.
    ///
    /// `url` and `headers` may contain `{{VARIABLE}}` placeholders; the broker
    /// resolves them server-side and the agent never sees the raw credential.
    ///
    /// # Errors
    ///
    /// Returns [`OpenAgentError::Credential`] or [`OpenAgentError::Transport`]
    /// on broker / network failures.
    pub async fn get(
        &self,
        url: impl Into<String>,
        headers: BTreeMap<String, String>,
    ) -> Result<ProxyResponse> {
        self.proxy("GET", url.into(), headers, None).await
    }

    /// Send an HTTP `POST` through the credential proxy.
    ///
    /// # Errors
    ///
    /// Returns [`OpenAgentError::Credential`] or [`OpenAgentError::Transport`]
    /// on broker / network failures.
    pub async fn post(
        &self,
        url: impl Into<String>,
        headers: BTreeMap<String, String>,
        body: Vec<u8>,
    ) -> Result<ProxyResponse> {
        self.proxy("POST", url.into(), headers, Some(body)).await
    }

    /// Generic proxy helper used by [`Self::get`] and [`Self::post`].
    async fn proxy(
        &self,
        method: &str,
        url: String,
        headers: BTreeMap<String, String>,
        body: Option<Vec<u8>>,
    ) -> Result<ProxyResponse> {
        let token = self.request_token(&[]).await?;

        let request = ProxyRequest {
            method: method.to_string(),
            url,
            headers: if headers.is_empty() {
                None
            } else {
                Some(headers)
            },
            body,
            capability_token: token,
            timeout_ms: None,
        };

        request.validate().map_err(OpenAgentError::from)?;

        let response = self.inner.client.proxy_http(request).await?;
        Ok(response)
    }

    /// Reference to the wrapped Arsenal client for advanced use cases.
    ///
    /// Drop down to this when the SDK doesn't expose what you need — but if
    /// you find yourself doing it often, file a feature request.
    pub fn inner(&self) -> &ArsenalClient {
        &self.inner.client
    }
}

impl std::fmt::Debug for CredentialClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CredentialClient")
            .field("default_scopes", &self.inner.default_scopes)
            .field("default_ttl_seconds", &self.inner.default_ttl_seconds)
            .finish_non_exhaustive()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use arsenal_core::identity::TenantId;
    use arsenal_sdk::AgentIdentityLoader;

    fn build_offline_client() -> ArsenalClient {
        let tenant = TenantId::generate();
        let identity = AgentIdentityLoader::generate(tenant, "openagent-test")
            .unwrap_or_else(|e| unreachable!("identity gen failed: {e}"));
        ArsenalClient::builder()
            .identity(identity)
            .build()
            .unwrap_or_else(|e| unreachable!("client build failed: {e:?}"))
    }

    #[tokio::test]
    async fn ensure_session_succeeds_on_offline_client() {
        let client = build_offline_client();
        let creds = CredentialClient::new(client, vec!["openai:chat".into()], 300);
        creds
            .ensure_session()
            .await
            .unwrap_or_else(|e| unreachable!("ensure_session failed: {e}"));
    }

    #[tokio::test]
    async fn request_token_without_broker_returns_credential_error() {
        let client = build_offline_client();
        let creds = CredentialClient::new(client, vec!["openai:chat".into()], 300);
        let err = creds.request_token(&[]).await;
        assert!(err.is_err());
    }

    #[tokio::test]
    async fn empty_scopes_with_no_defaults_returns_config_error() {
        let client = build_offline_client();
        let creds = CredentialClient::new(client, vec![], 300);
        let err = creds.request_token(&[]).await;
        assert!(matches!(err, Err(OpenAgentError::Config(_))));
    }
}
