//! AEGIS verification + authorization wrapper.
//!
//! [`Verifier`] wraps an [`openagent_aegis_sdk::AegisClient`] and exposes the three
//! operations the OpenAgent facade actually needs:
//!
//! 1. **Verify** an inbound DID (resolve, signature, lineage, revocation,
//!    liveness) → returns a [`VerifiedContext`].
//! 2. **Authorize** an action against the AEGIS policy engine.
//! 3. **Delegate** capabilities from one DID to another.

use std::sync::Arc;

use oas_document::OasDocument;
use oas_lineage::{config::VerifyConfig, provider::DocumentProvider};
use oas_sdk::lineage::{verify_privileged_authority, AuthorityPathKind, LineageAuthoritySource};
use openagent_aegis_core::{
    AuthCredential, IdentityType, PluginRegistry, PolicyDecision, PolicyRequest, VerificationResult,
};
use openagent_aegis_sdk::AegisClient;

use crate::errors::{OpenAgentError, Result};

/// Wraps an AEGIS client.
///
/// The verifier owns its `AegisClient` (cheap-clone via `Arc` internally) and
/// is meant to be shared across an entire process. Construction is async-free
/// because AEGIS uses lazy in-memory stores by default.
#[derive(Clone)]
pub struct Verifier {
    inner: Arc<AegisClient>,
}

impl Verifier {
    /// Build a verifier with the supplied plugin registry and AEGIS defaults.
    pub fn new(registry: Arc<PluginRegistry>) -> Self {
        Self {
            inner: Arc::new(AegisClient::with_defaults(registry)),
        }
    }

    /// Wrap an existing [`AegisClient`].
    ///
    /// Use this when you've configured AEGIS with custom storage backends
    /// (e.g., PostgreSQL) or a non-default policy engine.
    pub fn from_client(client: AegisClient) -> Self {
        Self {
            inner: Arc::new(client),
        }
    }

    /// Reference to the wrapped AEGIS client for advanced use.
    pub fn inner(&self) -> &AegisClient {
        &self.inner
    }

    /// Verify a DID end-to-end and return a [`VerifiedContext`].
    ///
    /// Runs the full AEGIS verification pipeline: DID resolution, signature
    /// check, lineage walk back to a human root, revocation check, and
    /// liveness probe (subject to the configured TTL cache).
    ///
    /// # Errors
    ///
    /// Returns [`OpenAgentError::Verification`] if any pipeline stage fails.
    pub async fn verify(&self, did: &str) -> Result<VerifiedContext> {
        let result = self.inner.verify_identity(did).await?;
        Ok(VerifiedContext {
            did: did.to_string(),
            result,
            lineage_authority: None,
        })
    }

    /// Authenticate a credential and return the resulting AEGIS session ID.
    ///
    /// `identity_type` is `Human` for OAuth/Passkey/etc. and `Agent` for
    /// machine-to-machine flows. The two get different session lifetimes.
    ///
    /// # Errors
    ///
    /// Returns [`OpenAgentError::Authentication`] if no provider accepts the
    /// credential.
    pub async fn authenticate(
        &self,
        credential: &AuthCredential,
        identity_type: IdentityType,
    ) -> Result<String> {
        let session = self.inner.authenticate(credential, identity_type).await?;
        Ok(session.session_id)
    }

    /// Evaluate an authorization request against the registered policy engine.
    ///
    /// # Errors
    ///
    /// Returns [`OpenAgentError::Authorization`] if the policy engine errors
    /// (a *deny* decision is **not** an error — inspect [`PolicyDecision`]).
    pub async fn authorize(&self, request: &PolicyRequest) -> Result<PolicyDecision> {
        Ok(self.inner.authorize(request).await?)
    }
}

/// Sigil-backed lineage authority attached by an OAS verifier.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LineageAuthorityContext {
    /// DID whose privileged authority was verified.
    pub subject: String,
    /// Backend/source identifier, normally `sigil_gal`.
    pub source: String,
    /// Finalized root DID for the verified path.
    pub root: String,
    /// Reconstructed finalized path, ordered root to caller.
    pub path: Vec<String>,
    /// Sigil block height at which this authority was finalized.
    pub finalized_block: u64,
    /// Authority path kind, e.g. `human_to_agent`.
    pub path_kind: String,
    /// Scopes proven by this lineage path.
    pub scopes: Vec<String>,
    /// Generation/depth from root to subject.
    pub generation: u32,
    /// Accepted root kind for this authority path.
    pub root_kind: Option<String>,
    /// Optional org lineage root commitment for org-scoped authority.
    pub org_root_commitment: Option<String>,
    /// Optional expiry timestamp for the authority edge/path.
    pub expires_at: Option<String>,
}

/// Convert an OAS privileged-authority verification into OpenAgent runtime
/// auth context.
///
/// This is the OpenAgent-side bridge for sensitive operations: callers provide
/// an OAS document resolver and an authority source adapter, and OpenAgent
/// receives a normalized context it can attach to ACT/request verification.
pub fn authority_context_from_oas(
    document: &OasDocument,
    provider: &dyn DocumentProvider,
    config: &VerifyConfig,
    authority_source: &dyn LineageAuthoritySource,
    path_kind: AuthorityPathKind,
    required_scopes: &[String],
    min_finalized_block: Option<u64>,
) -> Result<LineageAuthorityContext> {
    let path_kind_label = path_kind.as_str().to_string();
    let verification = verify_privileged_authority(
        document,
        provider,
        config,
        authority_source,
        path_kind,
        required_scopes,
        min_finalized_block,
    )?;
    let authority = verification.authority;
    let generation = authority.finalized_path.len().saturating_sub(1) as u32;
    let root_kind = did_kind(&authority.root_did);

    Ok(LineageAuthorityContext {
        subject: authority.subject_did,
        source: authority.source,
        root: authority.root_did,
        path: authority.finalized_path,
        finalized_block: authority.finalized_block,
        path_kind: path_kind_label,
        scopes: authority.scopes,
        generation,
        root_kind,
        org_root_commitment: None,
        expires_at: authority.expires_at,
    })
}

fn did_kind(did: &str) -> Option<String> {
    did.split(':').nth(3).map(str::to_string)
}

/// `VerifiedContext` is what callers get back from
/// [`crate::OpenAgent::authenticate`]. It bundles the DID that was verified,
/// the raw AEGIS [`VerificationResult`] for advanced use, and optional
/// Sigil-backed lineage authority for privileged actions.
#[derive(Debug, Clone)]
pub struct VerifiedContext {
    /// The DID that was verified.
    pub did: String,
    /// The raw AEGIS verification result (lineage chain, expiry, etc.).
    pub result: VerificationResult,
    /// OAS + Sigil authority proof required for privileged access.
    pub lineage_authority: Option<LineageAuthorityContext>,
}

impl VerifiedContext {
    /// True if the verification considered the DID valid.
    ///
    /// Combines signature, lineage, revocation, and liveness into a single
    /// boolean. Use [`Self::result`] for the breakdown.
    pub fn is_valid(&self) -> bool {
        use openagent_aegis_core::{LivenessStatus, RevocationStatus};
        self.result.signature_valid
            && self.result.lineage_valid
            && matches!(self.result.revocation_status, RevocationStatus::Active)
            && matches!(
                self.result.liveness_status,
                LivenessStatus::Active | LivenessStatus::Warning | LivenessStatus::Unknown
            )
    }

    /// Return the attached Sigil-backed authority or fail closed.
    pub fn require_privileged_authority(&self) -> Result<&LineageAuthorityContext> {
        self.lineage_authority.as_ref().ok_or_else(|| {
            OpenAgentError::Verification(
                "privileged authority requires OAS + Sigil lineage".to_string(),
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oas_lineage::provider::InMemoryProvider;
    use oas_sdk::error::OasError;
    use oas_sdk::identity::create_hmr;
    use oas_sdk::lineage::{derive_child, LineageAuthorityRecord, LineageAuthorityRequest};

    struct AcceptingAuthoritySource;

    impl LineageAuthoritySource for AcceptingAuthoritySource {
        fn verify_authority(
            &self,
            request: &LineageAuthorityRequest,
        ) -> std::result::Result<LineageAuthorityRecord, OasError> {
            Ok(LineageAuthorityRecord {
                subject_did: request.subject_did.clone(),
                root_did: request.local_root_did.clone(),
                finalized_path: request.local_chain.clone(),
                finalized_block: 42,
                source: "sigil_gal_test".to_string(),
                scopes: request.required_scopes.clone(),
                expires_at: None,
            })
        }
    }

    struct RejectingAuthoritySource;

    impl LineageAuthoritySource for RejectingAuthoritySource {
        fn verify_authority(
            &self,
            _request: &LineageAuthorityRequest,
        ) -> std::result::Result<LineageAuthorityRecord, OasError> {
            Err(OasError::LineageAuthority {
                reason: "authority missing".to_string(),
            })
        }
    }

    #[test]
    fn verifier_constructs_with_empty_registry() {
        let registry = Arc::new(PluginRegistry::new());
        let _verifier = Verifier::new(registry);
    }

    #[test]
    fn authority_context_from_oas_attaches_runtime_fields() {
        let root = create_hmr("test", "alice", "2026-01-15T00:00:00Z").unwrap_or_else(|e| {
            panic!("create_hmr failed: {e}");
        });
        let child = derive_child(
            &root.keypair,
            &root.document,
            "test",
            "agent",
            "bot",
            "agent/bot",
            "2026-01-15T00:00:00Z",
        )
        .unwrap_or_else(|e| panic!("derive_child failed: {e}"));
        let mut provider = InMemoryProvider::new();
        provider.register(root.document.clone());
        let scopes = vec!["openai:chat:completions".to_string()];

        let ctx = authority_context_from_oas(
            &child.document,
            &provider,
            &VerifyConfig::default(),
            &AcceptingAuthoritySource,
            AuthorityPathKind::HumanToAgent,
            &scopes,
            Some(1),
        )
        .unwrap_or_else(|e| panic!("authority context failed: {e}"));

        assert_eq!(ctx.subject, child.document.id);
        assert_eq!(ctx.root, root.document.id);
        assert_eq!(ctx.path_kind, "human_to_agent");
        assert_eq!(ctx.source, "sigil_gal_test");
        assert_eq!(ctx.scopes, scopes);
        assert_eq!(ctx.generation, 1);
        assert_eq!(ctx.root_kind, Some("hmr".to_string()));
    }

    #[test]
    fn authority_context_from_oas_fails_closed_without_authority() {
        let root = create_hmr("test", "alice", "2026-01-15T00:00:00Z").unwrap_or_else(|e| {
            panic!("create_hmr failed: {e}");
        });
        let child = derive_child(
            &root.keypair,
            &root.document,
            "test",
            "agent",
            "bot",
            "agent/bot",
            "2026-01-15T00:00:00Z",
        )
        .unwrap_or_else(|e| panic!("derive_child failed: {e}"));
        let mut provider = InMemoryProvider::new();
        provider.register(root.document.clone());

        let result = authority_context_from_oas(
            &child.document,
            &provider,
            &VerifyConfig::default(),
            &RejectingAuthoritySource,
            AuthorityPathKind::HumanToAgent,
            &[],
            None,
        );

        assert!(result.is_err());
    }
}
