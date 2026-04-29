//! Core types and traits used by the middleware and adapters.
//!
//! These are deliberately minimal — every additional surface is a
//! versioning risk for downstream crates that bring their own MCP SDK
//! and OpenAgent SDK builds.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::sync::Arc;

use crate::errors::McpAuthError;
use crate::skills::SkillsPolicy;

/// A decentralized identifier — typically `did:oas:<namespace>:...`, but
/// any format the configured [`IdentityVerifier`] understands is allowed.
pub type Did = String;

/// Identity envelope attached to an outbound MCP `tools/call` request.
///
/// The middleware extracts this from `_meta.openagent.identity` on the
/// inbound request. `proof` is opaque to the middleware — it can be a
/// signed challenge response, an Arsenal Agent Capability Token, or any
/// other format the verifier knows how to validate.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Identity {
    /// Caller's DID.
    pub did: Did,
    /// Verifiable proof — opaque to the middleware.
    pub proof: String,
    /// Optional bearer-style nonce for replay protection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nonce: Option<String>,
    /// Optional context fields the verifier may use (issuer DID,
    /// audience, claimed scopes). Always validated against the verifier
    /// policy — never trusted as input.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<serde_json::Value>,
}

/// The result of a successful identity verification. Carries the audit
/// id stamped onto the response, the held scopes, and any verifier
/// claims.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifiedIdentity {
    /// Verified DID.
    pub did: Did,
    /// Scopes the caller actually holds (post-verification).
    pub scopes: Vec<String>,
    /// Audit identifier echoed back to the caller in the response.
    pub audit_id: String,
    /// Verifier-issued claims about the caller.
    pub claims: serde_json::Value,
}

/// Audit metadata stamped onto the response `_meta.openagent` block.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditMeta {
    /// Identifier for correlating logs end-to-end.
    pub audit_id: String,
    /// DID of the caller that was successfully verified.
    pub verified_did: Did,
    /// Scopes the caller exercised on this call.
    pub scopes: Vec<String>,
}

/// The trait every identity verifier implements. Production deployments
/// will use the verifier from `openagent-sdk`; tests use the
/// [`crate::handler::InMemoryToolHandler`]-friendly fake found in the
/// `tests/` directory.
#[async_trait]
pub trait IdentityVerifier: Send + Sync {
    /// Verify the supplied identity envelope and return the resulting
    /// [`VerifiedIdentity`]. Implementations MUST be deterministic for a
    /// given `(identity, required_scopes)` pair and MUST NOT mutate
    /// either argument.
    async fn verify(
        &self,
        identity: &Identity,
        required_scopes: &[String],
    ) -> Result<VerifiedIdentity, McpAuthError>;
}

/// Minimal Agent surface used by the middleware.
#[async_trait]
pub trait Agent: Send + Sync {
    /// The agent's own DID.
    fn did(&self) -> &str;

    /// The verifier the agent's MCP server uses to authenticate
    /// inbound calls.
    fn verifier(&self) -> Arc<dyn IdentityVerifier>;

    /// Sign an outbound call so the receiving server can authenticate
    /// the agent. Returns the identity envelope to attach to the
    /// request `_meta.openagent.identity` field.
    async fn sign_request(
        &self,
        tool_name: &str,
        audience: Option<&str>,
    ) -> Result<Identity, McpAuthError>;
}

/// Function type that derives the required scopes for a tool from the
/// tool name and arguments.
pub type ScopeDeriver =
    Arc<dyn Fn(&str, &serde_json::Value) -> Vec<String> + Send + Sync>;

/// Hook fired before the tool body executes.
pub type PreCallHook = Arc<
    dyn Fn(&PreCallContext<'_>) -> futures_compat::BoxFuture<'static, ()> + Send + Sync,
>;

/// Hook fired after the tool body executes successfully.
pub type PostCallHook = Arc<
    dyn Fn(&PostCallContext<'_>) -> futures_compat::BoxFuture<'static, ()> + Send + Sync,
>;

/// Hook fired when the auth pipeline or tool body errors.
pub type ErrorHook = Arc<
    dyn Fn(&ErrorContext<'_>) -> futures_compat::BoxFuture<'static, ()> + Send + Sync,
>;

/// Context passed to a [`PreCallHook`].
#[derive(Debug)]
pub struct PreCallContext<'a> {
    /// The tool name.
    pub tool_name: &'a str,
    /// Arguments the caller supplied.
    pub args: &'a serde_json::Value,
    /// The verified identity.
    pub identity: &'a VerifiedIdentity,
}

/// Context passed to a [`PostCallHook`].
#[derive(Debug)]
pub struct PostCallContext<'a> {
    /// The tool name.
    pub tool_name: &'a str,
    /// Arguments the caller supplied.
    pub args: &'a serde_json::Value,
    /// The verified identity.
    pub identity: &'a VerifiedIdentity,
    /// Wall-clock duration of the call, in milliseconds.
    pub duration_ms: u128,
    /// The successful tool result, after audit metadata stamping.
    pub result: &'a serde_json::Value,
}

/// Context passed to an [`ErrorHook`].
#[derive(Debug)]
pub struct ErrorContext<'a> {
    /// The tool name.
    pub tool_name: &'a str,
    /// Arguments the caller supplied.
    pub args: &'a serde_json::Value,
    /// The verified identity, if the auth pipeline got far enough to
    /// produce one.
    pub identity: Option<&'a VerifiedIdentity>,
    /// The error that aborted the call.
    pub error: &'a McpAuthError,
}

/// Configuration for the [`crate::OpenAgentMiddleware`].
#[derive(Clone)]
pub struct Config {
    pub(crate) agent: Arc<dyn Agent>,
    pub(crate) require_scopes: Option<ScopeDeriver>,
    pub(crate) require_identity: bool,
    pub(crate) skills_policy: Option<SkillsPolicy>,
    pub(crate) pre_call: Option<PreCallHook>,
    pub(crate) post_call: Option<PostCallHook>,
    pub(crate) on_error: Option<ErrorHook>,
    pub(crate) extras: HashMap<String, serde_json::Value>,
}

impl fmt::Debug for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Config")
            .field("agent_did", &self.agent.did())
            .field("require_identity", &self.require_identity)
            .field("has_require_scopes", &self.require_scopes.is_some())
            .field("has_skills_policy", &self.skills_policy.is_some())
            .field("has_pre_call", &self.pre_call.is_some())
            .field("has_post_call", &self.post_call.is_some())
            .field("has_on_error", &self.on_error.is_some())
            .field("extras", &self.extras)
            .finish()
    }
}

impl Config {
    /// Create a new config from the agent. All hooks default to none
    /// and identity is required.
    pub fn new(agent: Arc<dyn Agent>) -> Self {
        Self {
            agent,
            require_scopes: None,
            require_identity: true,
            skills_policy: None,
            pre_call: None,
            post_call: None,
            on_error: None,
            extras: HashMap::new(),
        }
    }

    /// Override the per-tool scope deriver. Defaults to
    /// `["mcp:<tool>:invoke"]`.
    pub fn with_require_scopes(mut self, deriver: ScopeDeriver) -> Self {
        self.require_scopes = Some(deriver);
        self
    }

    /// Set whether the middleware should reject calls without an
    /// identity envelope. Defaults to `true`.
    pub fn with_require_identity(mut self, require: bool) -> Self {
        self.require_identity = require;
        self
    }

    /// Install a skills policy hook. See [`crate::skills`].
    pub fn with_skills_policy(mut self, policy: SkillsPolicy) -> Self {
        self.skills_policy = Some(policy);
        self
    }

    /// Install a pre-call hook.
    pub fn with_pre_call(mut self, hook: PreCallHook) -> Self {
        self.pre_call = Some(hook);
        self
    }

    /// Install a post-call hook.
    pub fn with_post_call(mut self, hook: PostCallHook) -> Self {
        self.post_call = Some(hook);
        self
    }

    /// Install an error hook.
    pub fn with_on_error(mut self, hook: ErrorHook) -> Self {
        self.on_error = Some(hook);
        self
    }

    /// Attach an arbitrary metadata field to the config (for
    /// observability or custom adapters). Returns the new config.
    pub fn with_extra(mut self, key: impl Into<String>, value: serde_json::Value) -> Self {
        self.extras.insert(key.into(), value);
        self
    }

    /// Borrow the underlying agent.
    pub fn agent(&self) -> &Arc<dyn Agent> {
        &self.agent
    }
}

/// Tiny adapter module so the public API can use boxed futures without
/// pulling in the full `futures` crate. Keeping this in-tree avoids a
/// dependency that has historically caused version conflicts inside the
/// L1fe ecosystem.
pub mod futures_compat {
    use std::future::Future;
    use std::pin::Pin;

    /// A future that has been boxed onto the heap with a `'static`
    /// lifetime. Used by hook signatures.
    pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;
}
