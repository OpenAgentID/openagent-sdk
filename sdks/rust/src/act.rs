//! ACT (Agent Capability Token) verification — the verify-first surface.
//!
//! Most consumers never mint an ACT; they verify one presented by a caller.
//! This module wraps the canonical [`agent_capability_token`] verifier in the
//! SDK's fluent style:
//!
//! ```rust,ignore
//! let claims = act::verify(&token_bytes)
//!     .issuer("arsenal:broker:prod-1")
//!     .for_audience("my-service")
//!     .require_scope(Scope::parse("tools:calendar:invoke")?)
//!     .trusted_keys(vec![broker_key])
//!     .run()?;
//! ```
//!
//! All rules — envelope decode, version/algorithm checks, signature before
//! claims, temporal checks, scope non-widening — live in the canonical crate,
//! so this module carries none of them and cannot drift.

use agent_capability_token::{ActClaims, PublicKeyBytes, Scope};

use crate::errors::{OpenAgentError, Result};

/// Fluent ACT verifier, built by [`verify`].
#[derive(Debug, Clone)]
pub struct ActVerifierBuilder<'a> {
    token: &'a [u8],
    issuer: Option<String>,
    audience: Option<String>,
    scopes: Vec<Scope>,
    trusted_keys: Vec<PublicKeyBytes>,
    leeway_seconds: i64,
    now_unix_seconds: Option<i64>,
}

/// Begin verifying an ACT envelope (CBOR bytes).
pub fn verify(token: &[u8]) -> ActVerifierBuilder<'_> {
    ActVerifierBuilder {
        token,
        issuer: None,
        audience: None,
        scopes: Vec::new(),
        trusted_keys: Vec::new(),
        leeway_seconds: 0,
        now_unix_seconds: None,
    }
}

impl<'a> ActVerifierBuilder<'a> {
    /// Bind the expected issuer. Required: a verifier that does not name the
    /// issuer accepts anyone's tokens.
    pub fn issuer(mut self, iss: impl Into<String>) -> Self {
        self.issuer = Some(iss.into());
        self
    }

    /// Bind the audience this verifier answers for. Required: a token meant
    /// for another service must not pass here.
    pub fn for_audience(mut self, audience: impl Into<String>) -> Self {
        self.audience = Some(audience.into());
        self
    }

    /// Require a scope the token must grant. Wildcards in the grant expand;
    /// in the request they are literal.
    pub fn require_scope(mut self, scope: Scope) -> Self {
        self.scopes.push(scope);
        self
    }

    /// The trusted Ed25519 public keys (raw 32 bytes each). Required.
    pub fn trusted_keys(mut self, keys: impl IntoIterator<Item = PublicKeyBytes>) -> Self {
        self.trusted_keys.extend(keys);
        self
    }

    /// Allow `seconds` of clock skew on temporal checks.
    pub fn with_leeway(mut self, seconds: i64) -> Self {
        self.leeway_seconds = seconds;
        self
    }

    /// Pin the verification clock (tests, decision replay).
    pub fn at_time(mut self, unix_seconds: i64) -> Self {
        self.now_unix_seconds = Some(unix_seconds);
        self
    }

    /// Run verification.
    ///
    /// # Errors
    ///
    /// Returns [`OpenAgentError::Config`] for a missing policy binding, and
    /// [`OpenAgentError::Verification`] carrying the canonical reason
    /// (signature, expiry, audience, scope, version - distinct on purpose)
    /// when the token itself fails.
    pub fn run(self) -> Result<ActClaims> {
        let issuer = self
            .issuer
            .ok_or_else(|| OpenAgentError::config("act verify: issuer() is required"))?;
        let audience = self
            .audience
            .ok_or_else(|| OpenAgentError::config("act verify: for_audience() is required"))?;
        if self.trusted_keys.is_empty() {
            return Err(OpenAgentError::config(
                "act verify: trusted_keys() is required (at least one key)",
            ));
        }

        let mut verifier = agent_capability_token::Verifier::new(self.trusted_keys, issuer, audience)
            .map_err(|e| OpenAgentError::config(format!("act verifier: {e}")))?
            .with_leeway_seconds(self.leeway_seconds);

        if let Some(now) = self.now_unix_seconds {
            verifier = verifier.with_clock(now);
        }
        if !self.scopes.is_empty() {
            verifier = verifier.requiring_scopes(self.scopes);
        }

        agent_capability_token::verify(self.token, &verifier)
            .map_err(|e| OpenAgentError::Verification(format!("ACT verification failed: {e}")))
    }
}

#[cfg(feature = "axum")]
pub mod axum_support {
    //! Axum extractor for ACT-guarded routes.
    //!
    //! Attach the verifier policy to your router's state; routes take
    //! [`ActClaims`] as an argument and only run when the presented token
    //! verifies against it.

    use super::*;
    use axum::{
        extract::{FromRef, FromRequestParts},
        http::{request::Parts, StatusCode},
        response::{IntoResponse, Response},
        Json,
    };
    use base64::Engine as _;

    /// The shared verifier policy. Cheap to clone (Arc inside).
    #[derive(Clone)]
    pub struct ActPolicy {
        issuer: String,
        audience: String,
        scopes: Vec<Scope>,
        trusted_keys: Vec<PublicKeyBytes>,
        leeway_seconds: i64,
    }

    impl ActPolicy {
        /// Build a policy. Same bindings as the builder: issuer, audience,
        /// and at least one trusted key are required.
        pub fn new(
            issuer: impl Into<String>,
            audience: impl Into<String>,
            trusted_keys: Vec<PublicKeyBytes>,
        ) -> Result<Self> {
            if trusted_keys.is_empty() {
                return Err(OpenAgentError::config(
                    "ActPolicy: at least one trusted key is required",
                ));
            }
            Ok(Self {
                issuer: issuer.into(),
                audience: audience.into(),
                scopes: Vec::new(),
                trusted_keys,
                leeway_seconds: 0,
            })
        }

        /// Require scopes on every request.
        pub fn with_scopes(mut self, scopes: Vec<Scope>) -> Self {
            self.scopes = scopes;
            self
        }

        /// Allow clock skew.
        pub fn with_leeway(mut self, seconds: i64) -> Self {
            self.leeway_seconds = seconds;
            self
        }
    }

    /// Extractor: the verified claims of the request's ACT.
    pub struct ActContext(pub ActClaims);

    #[axum::async_trait]
    impl<S> FromRequestParts<S> for ActContext
    where
        S: Send + Sync,
        ActPolicy: FromRef<S>,
    {
        type Rejection = Response;

        async fn from_request_parts(
            parts: &mut Parts,
            state: &S,
        ) -> std::result::Result<Self, Self::Rejection> {
            let policy = ActPolicy::from_ref(state);

            let header = parts
                .headers
                .get(axum::http::header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned);

            let token = header
                .and_then(|h| {
                    let (scheme, rest) = h.split_once(' ')?;
                    if scheme.eq_ignore_ascii_case("bearer") || scheme.eq_ignore_ascii_case("openagent") {
                        Some(rest.trim().to_owned())
                    } else {
                        None
                    }
                })
                .and_then(|t| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(t).ok());

            let Some(token) = token else {
                return Err(unauthorized("missing or malformed capability token"));
            };

            let mut builder = verify(&token)
                .issuer(policy.issuer)
                .for_audience(policy.audience)
                .trusted_keys(policy.trusted_keys)
                .with_leeway(policy.leeway_seconds);
            for scope in policy.scopes {
                builder = builder.require_scope(scope);
            }

            builder
                .run()
                .map(ActContext)
                .map_err(|e| unauthorized(&e.to_string()))
        }
    }

    fn unauthorized(reason: &str) -> Response {
        (
            StatusCode::UNAUTHORIZED,
            [("www-authenticate", "OpenAgent")],
            Json(serde_json::json!({ "error": reason })),
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builder_requires_issuer() {
        let result = verify(&[1, 2, 3])
            .for_audience("omerta")
            .trusted_keys(vec![[7u8; 32]])
            .run();
        assert!(result.is_err());
    }

    #[test]
    fn builder_requires_audience() {
        let result = verify(&[1, 2, 3])
            .issuer("arsenal:broker:test-1")
            .trusted_keys(vec![[7u8; 32]])
            .run();
        assert!(result.is_err());
    }

    #[test]
    fn builder_requires_keys() {
        let result = verify(&[1, 2, 3])
            .issuer("arsenal:broker:test-1")
            .for_audience("omerta")
            .run();
        assert!(result.is_err());
    }
}
