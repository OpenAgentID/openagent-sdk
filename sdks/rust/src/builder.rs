//! Fluent builder for [`crate::OpenAgent`].
//!
//! [`OpenAgentBuilder`] is the escape hatch for advanced users who need to
//! wire in their own Arsenal client, AEGIS verifier, or skill policy. The
//! 80% case should still use [`crate::OpenAgent::create_agent`].

use std::sync::Arc;

use aegis_core::PluginRegistry;
use aegis_sdk::AegisClient;
use arsenal_sdk::ArsenalClient;

use crate::agent::{CreateAgentOptions, OpenAgent};
use crate::config::OpenAgentConfig;
use crate::credentials::CredentialClient;
use crate::errors::{OpenAgentError, Result};
use crate::identity::{derive_agent, mint_human_root, AgentIdentityRecord};
use crate::skills::{SkillsPolicy, SkillsPolicyHandle};
use crate::verification::Verifier;

/// Fluent builder for an [`OpenAgent`].
///
/// All setters consume `self` and return a new builder; the builder itself is
/// `Default`-friendly so you can chain straight from a function call.
#[derive(Default)]
pub struct OpenAgentBuilder {
    config: OpenAgentConfig,
    skills: Option<SkillsPolicyHandle>,
    arsenal: Option<ArsenalClient>,
    aegis: Option<AegisClient>,
    aegis_registry: Option<Arc<PluginRegistry>>,
    parent: Option<AgentIdentityRecord>,
}

impl OpenAgentBuilder {
    /// Start a new builder with default config.
    pub fn new() -> Self {
        Self::default()
    }

    /// Replace the SDK config.
    pub fn config(mut self, config: OpenAgentConfig) -> Self {
        self.config = config;
        self
    }

    /// Wire in an existing [`ArsenalClient`].
    ///
    /// Without this call, agents built by this builder cannot fetch
    /// credentials and [`OpenAgent::credentials_for`] will return a
    /// [`crate::errors::OpenAgentError::Config`].
    pub fn with_arsenal_client(mut self, client: ArsenalClient) -> Self {
        self.arsenal = Some(client);
        self
    }

    /// Wire in an existing [`AegisClient`].
    pub fn with_aegis_client(mut self, client: AegisClient) -> Self {
        self.aegis = Some(client);
        self
    }

    /// Wire in an AEGIS plugin registry. The builder will materialise an
    /// [`AegisClient`] from this when needed.
    pub fn with_aegis_registry(mut self, registry: Arc<PluginRegistry>) -> Self {
        self.aegis_registry = Some(registry);
        self
    }

    /// Wire in a custom skills policy.
    pub fn with_skills_policy<P: SkillsPolicy + 'static>(mut self, policy: P) -> Self {
        self.skills = Some(SkillsPolicyHandle::new(policy));
        self
    }

    /// Provide a real parent identity (with its own keypair) so the new agent
    /// can be derived from it cryptographically.
    ///
    /// This is the production path. The convenience
    /// [`crate::OpenAgent::create_agent`] mints a fresh transient root from
    /// the parent DID instead, which is useful for tests but not for
    /// long-lived deployments.
    pub fn with_parent(mut self, parent: AgentIdentityRecord) -> Self {
        self.parent = Some(parent);
        self
    }

    /// Finish the build and produce an [`OpenAgent`].
    ///
    /// # Errors
    ///
    /// Returns [`OpenAgentError::Identity`] if document construction fails or
    /// [`OpenAgentError::Config`] if the supplied options are invalid.
    pub async fn build(self, opts: CreateAgentOptions<'_>) -> Result<OpenAgent> {
        if opts.name.is_empty() {
            return Err(OpenAgentError::config("agent name must not be empty"));
        }

        let kind = opts.kind.unwrap_or("agent");
        let scopes: Vec<String> = opts.scopes.iter().map(|s| (*s).to_string()).collect();

        let record = match (self.parent, opts.parent) {
            // Production path — caller supplied a real parent record.
            (Some(parent), _) => {
                let path = opts
                    .derivation_path
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("{kind}/{}", opts.name));
                derive_agent(
                    &parent.keypair,
                    &parent.document,
                    &self.config.namespace,
                    kind,
                    opts.name,
                    &path,
                )?
            }
            // Test path — caller passed a parent DID, mint a transient root.
            (None, Some(parent_did)) => {
                let parent_root = mint_human_root(&parent_did.namespace, &parent_did.identifier)?;
                let path = opts
                    .derivation_path
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("{kind}/{}", opts.name));
                derive_agent(
                    &parent_root.keypair,
                    &parent_root.document,
                    &parent_did.namespace,
                    kind,
                    opts.name,
                    &path,
                )?
            }
            // No parent at all — mint a fresh root.
            (None, None) => mint_human_root(&self.config.namespace, opts.name)?,
        };

        let credentials = self.arsenal.map(|client| {
            CredentialClient::new(client, scopes.clone(), self.config.default_ttl_seconds)
        });

        let verifier = match (self.aegis, self.aegis_registry) {
            (Some(client), _) => Some(Verifier::from_client(client)),
            (None, Some(registry)) => Some(Verifier::new(registry)),
            (None, None) => None,
        };

        let skills = self.skills.unwrap_or_default();

        Ok(OpenAgent::from_parts(
            record,
            self.config,
            credentials,
            verifier,
            skills,
            scopes,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn builder_with_no_arsenal_produces_unwired_agent() {
        let agent = OpenAgentBuilder::new()
            .build(CreateAgentOptions {
                parent: None,
                name: "builder-bot",
                scopes: &["openai:chat"],
                kind: None,
                derivation_path: None,
            })
            .await
            .unwrap_or_else(|e| unreachable!("build failed: {e}"));
        assert!(agent.did().contains("builder-bot"));
        let err = agent.credentials_for("openai").await;
        assert!(err.is_err());
    }

    #[tokio::test]
    async fn builder_with_aegis_registry_attaches_verifier() {
        let registry = Arc::new(PluginRegistry::new());
        let agent = OpenAgentBuilder::new()
            .with_aegis_registry(registry)
            .build(CreateAgentOptions {
                parent: None,
                name: "verifier-bot",
                scopes: &[],
                kind: None,
                derivation_path: None,
            })
            .await
            .unwrap_or_else(|e| unreachable!("{e}"));
        assert!(agent.verifier().is_some());
    }
}
