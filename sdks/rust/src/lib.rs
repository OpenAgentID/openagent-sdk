//! # OpenAgent SDK
//!
//! **Clerk for autonomous agents.** A thin, batteries-included Rust SDK that
//! gives you everything an agent needs to be a real entity in the L1fe
//! ecosystem under one import:
//!
//! - **Identity** — every agent gets an OAS [`did:oas`] with a verifiable
//!   lineage chain back to a human root.
//! - **Credentials** — fetch tokens through the Arsenal credential proxy so
//!   the agent never sees raw API keys.
//! - **Verification** — verify inbound DIDs through the AEGIS verification
//!   pipeline (resolution → signature → lineage → revocation → liveness).
//! - **Skills** — pluggable skill policy hook for the upcoming
//!   `openagent-skills-policy` crate.
//!
//! ## Three-line agent
//!
//! ```ignore
//! use openagent_sdk::{OpenAgent, CreateAgentOptions};
//!
//! let agent = OpenAgent::create_agent(CreateAgentOptions {
//!     name: "my-bot",
//!     scopes: &["openai:chat:completions"],
//!     ..Default::default()
//! }).await?;
//!
//! println!("agent did: {}", agent.did());
//! ```
//!
//! ## Production wiring
//!
//! Use [`OpenAgentBuilder`] to attach a real Arsenal broker, an AEGIS
//! verifier, or a custom skills policy:
//!
//! ```ignore
//! use openagent_sdk::{OpenAgentBuilder, CreateAgentOptions, OpenAgentConfig};
//! use arsenal_sdk::{ArsenalClient, AgentIdentityLoader};
//! use arsenal_core::identity::TenantId;
//!
//! let identity = AgentIdentityLoader::generate(TenantId::generate(), "ops")?;
//! let client = ArsenalClient::builder()
//!     .identity(identity)
//!     .broker_url("https://broker.l1fe.ai")
//!     .broker_mtls("/etc/l1fe/agent.crt", "/etc/l1fe/agent.key")
//!     .build()?;
//!
//! let agent = OpenAgentBuilder::new()
//!     .config(OpenAgentConfig::default())
//!     .with_arsenal_client(client)
//!     .build(CreateAgentOptions {
//!         name: "ops-bot",
//!         scopes: &["github:repo:read", "openai:chat"],
//!         ..Default::default()
//!     })
//!     .await?;
//! ```
//!
//! ## Layers
//!
//! | Module | Wraps | What it gives you |
//! |--------|-------|-------------------|
//! | [`identity`] | `oas-sdk` | DID minting, child derivation, lineage verification |
//! | [`credentials`] | `arsenal-sdk` | Capability tokens + credential proxy |
//! | [`verification`] | `aegis-sdk` | Verification pipeline + policy engine |
//! | [`skills`] | (stub for `openagent-skills-policy`) | Skill allow / deny |
//! | [`agent`] | all of the above | The [`OpenAgent`] facade |
//! | [`builder`] | all of the above | [`OpenAgentBuilder`] for advanced wiring |
//!
//! Drop down to the wrapped SDKs at any time — they are re-exported at the
//! crate root for convenience.

#![doc(html_root_url = "https://docs.rs/openagent-sdk/0.1.0")]

pub mod agent;
pub mod builder;
pub mod config;
pub mod credentials;
pub mod errors;
pub mod identity;
pub mod skills;
pub mod verification;

// ---------------------------------------------------------------------------
// Top-level re-exports — these are the names a typical app touches.
// ---------------------------------------------------------------------------

pub use agent::{authenticate_with_verifier, CreateAgentOptions, OpenAgent};
pub use builder::OpenAgentBuilder;
pub use config::{BrokerMtlsConfig, OpenAgentConfig};
pub use credentials::CredentialClient;
pub use errors::{OpenAgentError, Result};
pub use identity::{AgentIdentityRecord, ParsedDid};
pub use skills::{AllowListPolicy, SkillsPolicy, SkillsPolicyHandle};
pub use verification::{
    authority_context_from_oas, LineageAuthorityContext, VerifiedContext, Verifier,
};

// ---------------------------------------------------------------------------
// Wrapped-SDK re-exports — drop down here when the facade isn't enough.
// ---------------------------------------------------------------------------

/// The wrapped AEGIS SDK.
pub use openagent_aegis_sdk;
/// The wrapped Arsenal SDK.
pub use arsenal_sdk;
/// The wrapped OAS SDK.
pub use oas_sdk;

/// Synchronous helpers for CLI tooling.
///
/// The OpenAgent SDK is async-first, but CLI tools and one-shot scripts
/// usually want a blocking wrapper. The [`sync`] module provides exactly that.
pub mod sync {
    use crate::agent::{CreateAgentOptions, OpenAgent};
    use crate::errors::Result;

    /// Blocking equivalent of [`crate::OpenAgent::create_agent`].
    ///
    /// Builds a single-threaded tokio runtime, drives the async call to
    /// completion, and returns the result. Safe to call from any non-async
    /// context.
    ///
    /// # Errors
    ///
    /// Propagates any [`crate::OpenAgentError`] from the async path.
    pub fn create_agent(opts: CreateAgentOptions<'_>) -> Result<OpenAgent> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| crate::OpenAgentError::config(format!("tokio runtime: {e}")))?;
        runtime.block_on(OpenAgent::create_agent(opts))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn re_exports_compile() {
        // Smoke test — every public name is in scope.
        let _: Result<()> = Ok(());
        let _ = OpenAgentConfig::default();
        let _ = SkillsPolicyHandle::default();
        let _ = AllowListPolicy::new();
    }

    #[test]
    fn sync_create_agent_works_in_blocking_context() {
        let agent = sync::create_agent(CreateAgentOptions {
            parent: None,
            name: "sync-bot",
            scopes: &[],
            kind: None,
            derivation_path: None,
        })
        .unwrap_or_else(|e| unreachable!("{e}"));
        assert!(agent.did().contains("sync-bot"));
    }
}
