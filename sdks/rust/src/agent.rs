//! High-level [`OpenAgent`] facade.
//!
//! `OpenAgent` is the type-level entry point of the SDK. Almost every developer
//! will only ever touch:
//!
//! ```ignore
//! use openagent_sdk::{OpenAgent, CreateAgentOptions};
//!
//! let agent = OpenAgent::create_agent(CreateAgentOptions {
//!     parent: Some("did:oas:l1fe:hmr:alice".parse()?),
//!     name: "my-bot",
//!     scopes: &["openai:chat:completions"],
//!     ..Default::default()
//! }).await?;
//!
//! let creds = agent.credentials_for("openai").await?;
//! let response = creds.post("https://api.openai.com/v1/chat/completions",
//!                           Default::default(), body).await?;
//! ```
//!
//! Everything else in this crate is either the underlying machinery or
//! escape hatches for advanced users.

use std::sync::Arc;

use oas_crypto::keypair::OasKeyPair;
use oas_document::OasDocument;

use crate::config::OpenAgentConfig;
use crate::credentials::CredentialClient;
use crate::errors::{OpenAgentError, Result};
use crate::identity::{derive_agent, mint_human_root, AgentIdentityRecord, ParsedDid};
use crate::skills::{SkillsPolicy, SkillsPolicyHandle};
use crate::verification::Verifier;

/// Options for creating a new agent in one call.
///
/// Mirrors the JS / TS pattern of "one big options bag" so the call site stays
/// flat. Most fields are optional and have sensible defaults.
#[derive(Debug, Default)]
pub struct CreateAgentOptions<'a> {
    /// Parent DID to derive this agent from. When `None`, a fresh Human Root
    /// (HMR) identity is minted under the configured namespace.
    pub parent: Option<ParsedDid>,

    /// Required: a short, human-readable name (becomes the DID identifier).
    pub name: &'a str,

    /// Default scopes the agent will request from the Arsenal broker. May be
    /// overridden per-credential-call.
    pub scopes: &'a [&'a str],

    /// Optional kind override (defaults to `"agent"` when deriving from a
    /// parent, or `"hmr"` when no parent is supplied).
    pub kind: Option<&'a str>,

    /// Optional derivation path. Defaults to `"<kind>/<name>"`.
    pub derivation_path: Option<&'a str>,
}

/// A fully-constructed agent.
///
/// `OpenAgent` is `Clone`-cheap (everything inside is `Arc`-shared) so the
/// same agent handle can flow through every layer of an application.
#[derive(Clone)]
pub struct OpenAgent {
    inner: Arc<OpenAgentInner>,
}

struct OpenAgentInner {
    record: AgentIdentityRecord,
    config: OpenAgentConfig,
    credentials: Option<CredentialClient>,
    verifier: Option<Verifier>,
    skills: SkillsPolicyHandle,
    default_scopes: Vec<String>,
}

impl OpenAgent {
    /// Construct an [`OpenAgent`] from already-built parts.
    ///
    /// Most callers should use [`crate::builder::OpenAgentBuilder`] or
    /// [`OpenAgent::create_agent`] instead. This constructor exists so test
    /// harnesses (and the builder itself) can wire pre-built components.
    pub fn from_parts(
        record: AgentIdentityRecord,
        config: OpenAgentConfig,
        credentials: Option<CredentialClient>,
        verifier: Option<Verifier>,
        skills: SkillsPolicyHandle,
        default_scopes: Vec<String>,
    ) -> Self {
        Self {
            inner: Arc::new(OpenAgentInner {
                record,
                config,
                credentials,
                verifier,
                skills,
                default_scopes,
            }),
        }
    }

    /// Create a new agent with default SDK configuration.
    ///
    /// This is the boring, batteries-included path:
    ///
    /// 1. If `parent` is supplied, derive a child identity under that parent.
    ///    Otherwise mint a fresh HMR under the SDK's default namespace.
    /// 2. Skip the credentials layer (no broker is configured by default —
    ///    use [`crate::builder::OpenAgentBuilder::with_arsenal_client`] for
    ///    that).
    /// 3. Skip the AEGIS verifier (same reason).
    /// 4. Use a deny-all default skills policy.
    ///
    /// # Errors
    ///
    /// Returns [`OpenAgentError::Identity`] if document construction fails.
    pub async fn create_agent(opts: CreateAgentOptions<'_>) -> Result<Self> {
        Self::create_agent_with_config(opts, OpenAgentConfig::default()).await
    }

    /// Like [`Self::create_agent`] but with a custom [`OpenAgentConfig`].
    ///
    /// # Errors
    ///
    /// Returns [`OpenAgentError::Identity`] if document construction fails.
    pub async fn create_agent_with_config(
        opts: CreateAgentOptions<'_>,
        config: OpenAgentConfig,
    ) -> Result<Self> {
        if opts.name.is_empty() {
            return Err(OpenAgentError::config("agent name must not be empty"));
        }

        let kind = opts.kind.unwrap_or("agent");
        let scopes: Vec<String> = opts.scopes.iter().map(|s| (*s).to_string()).collect();

        let record = match opts.parent {
            None => mint_human_root(&config.namespace, opts.name)?,
            Some(parent) => {
                // For derivation we need the parent's keypair and document,
                // which require an in-process root. The convenience path
                // mints a transient root in the parent's namespace; agents
                // requiring a real-world parent should use the
                // [`OpenAgentBuilder::with_parent`] entry point.
                let parent_root = mint_human_root(&parent.namespace, &parent.identifier)?;
                let path = opts
                    .derivation_path
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("{kind}/{}", opts.name));
                derive_agent(
                    &parent_root.keypair,
                    &parent_root.document,
                    &parent.namespace,
                    kind,
                    opts.name,
                    &path,
                )?
            }
        };

        Ok(Self::from_parts(
            record,
            config,
            None,
            None,
            SkillsPolicyHandle::default(),
            scopes,
        ))
    }

    /// The agent's signed OAS Identity Document.
    pub fn document(&self) -> &OasDocument {
        &self.inner.record.document
    }

    /// The agent's keypair (for advanced workflows — most users should not
    /// touch this).
    pub fn keypair(&self) -> &OasKeyPair {
        &self.inner.record.keypair
    }

    /// The agent's `did:oas` string.
    pub fn did(&self) -> &str {
        &self.inner.record.document.id
    }

    /// The default scopes the agent was created with.
    pub fn default_scopes(&self) -> &[String] {
        &self.inner.default_scopes
    }

    /// The SDK config snapshot in effect for this agent.
    pub fn config(&self) -> &OpenAgentConfig {
        &self.inner.config
    }

    /// Skill policy handle for this agent.
    ///
    /// Returns a clone, so callers can move it into other layers without
    /// borrow-checking pain.
    pub fn skills_policy(&self) -> SkillsPolicyHandle {
        self.inner.skills.clone()
    }

    /// Set (or replace) the skill policy on this agent.
    ///
    /// This rebuilds the inner `Arc` so the change is local to the returned
    /// clone — callers should reassign the returned value.
    pub fn with_skills_policy<P: SkillsPolicy + 'static>(self, policy: P) -> Self {
        let handle = SkillsPolicyHandle::new(policy);
        Self::from_parts(
            AgentIdentityRecord {
                document: self.inner.record.document.clone(),
                keypair: self.inner.record.keypair.clone(),
            },
            self.inner.config.clone(),
            self.inner.credentials.clone(),
            self.inner.verifier.clone(),
            handle,
            self.inner.default_scopes.clone(),
        )
    }

    /// Quick check whether the named skill may be invoked by this agent.
    ///
    /// # Errors
    ///
    /// Returns [`OpenAgentError::SkillDenied`] if the skill is not allowed.
    pub fn check_skill(&self, skill: &str) -> Result<()> {
        self.inner.skills.can_invoke(skill)
    }

    /// Get a credentials handle scoped to a specific provider.
    ///
    /// `provider` is a logical name (e.g., `"openai"`, `"github"`) used by the
    /// SDK only for diagnostic logs — the actual scopes routed to the broker
    /// come from the agent's [`Self::default_scopes`].
    ///
    /// # Errors
    ///
    /// Returns [`OpenAgentError::Config`] if no credential client is wired in.
    pub async fn credentials_for(&self, provider: &str) -> Result<CredentialClient> {
        let creds = self.inner.credentials.as_ref().ok_or_else(|| {
            OpenAgentError::config(format!(
                "no credential client configured for provider '{provider}'; \
                 wire an Arsenal broker via OpenAgentBuilder::with_arsenal_client",
            ))
        })?;
        creds.ensure_session().await?;
        tracing::debug!(provider = provider, "credentials_for: session ready");
        Ok(creds.clone())
    }

    /// Reference to the AEGIS verifier (if configured).
    pub fn verifier(&self) -> Option<&Verifier> {
        self.inner.verifier.as_ref()
    }
}

impl std::fmt::Debug for OpenAgent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OpenAgent")
            .field("did", &self.did())
            .field("default_scopes", &self.inner.default_scopes)
            .field("has_credentials", &self.inner.credentials.is_some())
            .field("has_verifier", &self.inner.verifier.is_some())
            .finish()
    }
}

/// One-shot authentication helper at the crate level.
///
/// `OpenAgent::authenticate` is the canonical entry point referenced in
/// the README pitch. We expose it as an inherent method on the [`OpenAgent`]
/// type itself by re-exporting from [`crate::lib`].
///
/// Verifies the supplied DID through an injected [`Verifier`]. The DID
/// is opaque — typically it comes from an `Authorization: Bearer` header
/// or an `X-Openagent-DID` header on an inbound HTTP request.
///
/// # Errors
///
/// Returns [`OpenAgentError::Verification`] on pipeline failure or
/// [`OpenAgentError::Config`] if no verifier was supplied.
pub async fn authenticate_with_verifier(
    verifier: &Verifier,
    did: &str,
) -> Result<crate::verification::VerifiedContext> {
    verifier.verify(did).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn create_agent_without_parent_mints_root() {
        let agent = OpenAgent::create_agent(CreateAgentOptions {
            parent: None,
            name: "test-bot",
            scopes: &["openai:chat"],
            kind: None,
            derivation_path: None,
        })
        .await
        .unwrap_or_else(|e| unreachable!("create_agent failed: {e}"));

        assert!(agent.did().starts_with("did:oas:openagent:hmr:test-bot"));
        assert_eq!(agent.default_scopes().len(), 1);
    }

    #[tokio::test]
    async fn create_agent_with_parent_derives_child() {
        let parent: ParsedDid =
            "did:oas:l1fe:hmr:alice"
                .parse()
                .unwrap_or_else(|e: OpenAgentError| {
                    unreachable!("parse failed: {e}");
                });
        let agent = OpenAgent::create_agent(CreateAgentOptions {
            parent: Some(parent),
            name: "child-bot",
            scopes: &["github:repo:read"],
            kind: Some("agent"),
            derivation_path: None,
        })
        .await
        .unwrap_or_else(|e| unreachable!("create_agent failed: {e}"));

        assert_eq!(agent.did(), "did:oas:l1fe:agent:child-bot");
        assert!(agent.document().lineage.is_some());
    }

    #[tokio::test]
    async fn create_agent_rejects_empty_name() {
        let err = OpenAgent::create_agent(CreateAgentOptions {
            parent: None,
            name: "",
            scopes: &[],
            kind: None,
            derivation_path: None,
        })
        .await;
        assert!(matches!(err, Err(OpenAgentError::Config(_))));
    }

    #[tokio::test]
    async fn check_skill_uses_skills_policy() {
        use crate::skills::AllowListPolicy;

        let agent = OpenAgent::create_agent(CreateAgentOptions {
            parent: None,
            name: "skill-bot",
            scopes: &[],
            kind: None,
            derivation_path: None,
        })
        .await
        .unwrap_or_else(|e| unreachable!("{e}"));

        let agent = agent.with_skills_policy(AllowListPolicy::with_skills(["frontend-design"]));
        assert!(agent.check_skill("frontend-design").is_ok());
        assert!(agent.check_skill("rocket-science").is_err());
    }

    #[tokio::test]
    async fn credentials_for_returns_config_error_when_unwired() {
        let agent = OpenAgent::create_agent(CreateAgentOptions {
            parent: None,
            name: "x",
            scopes: &[],
            kind: None,
            derivation_path: None,
        })
        .await
        .unwrap_or_else(|e| unreachable!("{e}"));
        let err = agent.credentials_for("openai").await;
        assert!(matches!(err, Err(OpenAgentError::Config(_))));
    }
    #[tokio::test]
    async fn debug_includes_did() {
        let agent = OpenAgent::create_agent(CreateAgentOptions {
            parent: None,
            name: "dbg-bot",
            scopes: &[],
            kind: None,
            derivation_path: None,
        })
        .await
        .unwrap_or_else(|e| unreachable!("{e}"));
        let s = format!("{agent:?}");
        assert!(s.contains("dbg-bot"));
    }
}
