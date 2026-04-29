//! OAS identity wrapper.
//!
//! This module is the OpenAgent SDK's translation layer over [`oas_sdk`]. It
//! collapses the three idiomatic OAS calls (HMR creation, child derivation,
//! lineage verification) into the small set of operations the OpenAgent
//! facade actually needs.

use chrono::Utc;
use oas_crypto::keypair::OasKeyPair;
use oas_document::OasDocument;
use oas_lineage::config::VerifyConfig;
use oas_lineage::provider::DocumentProvider;
use oas_sdk::identity::{create_hmr, CreatedIdentity};
use oas_sdk::lineage::{derive_child, verify_chain, DerivedIdentity};

use crate::errors::{OpenAgentError, Result};

/// A parsed `did:oas:<namespace>:<kind>:<identifier>` triple.
///
/// The OpenAgent SDK accepts DIDs as strings everywhere — this struct only
/// exists internally so the wrapper code doesn't have to re-split the string.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedDid {
    /// The namespace component (e.g., `"l1fe"`, `"openagent"`).
    pub namespace: String,
    /// The entity kind (e.g., `"hmr"`, `"agent"`, `"tool"`).
    pub kind: String,
    /// The entity identifier.
    pub identifier: String,
}

impl ParsedDid {
    /// Parse a `did:oas:...` string.
    ///
    /// # Errors
    ///
    /// Returns [`OpenAgentError::Config`] if the DID is malformed.
    pub fn parse(did: &str) -> Result<Self> {
        // did:oas:<ns>:<kind>:<id>  — at minimum 5 segments separated by ':'.
        let parts: Vec<&str> = did.splitn(5, ':').collect();
        if parts.len() != 5 || parts[0] != "did" || parts[1] != "oas" {
            return Err(OpenAgentError::config(format!(
                "invalid did:oas DID: {did}"
            )));
        }
        if parts[2].is_empty() || parts[3].is_empty() || parts[4].is_empty() {
            return Err(OpenAgentError::config(format!(
                "did:oas has empty component: {did}"
            )));
        }
        Ok(Self {
            namespace: parts[2].to_string(),
            kind: parts[3].to_string(),
            identifier: parts[4].to_string(),
        })
    }

    /// Render this triple back into the canonical DID string.
    pub fn to_did(&self) -> String {
        format!(
            "did:oas:{}:{}:{}",
            self.namespace, self.kind, self.identifier
        )
    }
}

impl std::str::FromStr for ParsedDid {
    type Err = OpenAgentError;

    fn from_str(s: &str) -> Result<Self> {
        Self::parse(s)
    }
}

impl std::fmt::Display for ParsedDid {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.to_did())
    }
}

/// A signed identity document plus its keypair.
///
/// This is the OpenAgent SDK's analogue of [`oas_sdk::identity::CreatedIdentity`]
/// and [`oas_sdk::lineage::DerivedIdentity`]. We collapse them into one type
/// because consumers don't need to care which workflow produced the identity.
#[derive(Debug)]
pub struct AgentIdentityRecord {
    /// The signed OAS Identity Document.
    pub document: OasDocument,
    /// The Ed25519 keypair the document is signed with.
    pub keypair: OasKeyPair,
}

impl From<CreatedIdentity> for AgentIdentityRecord {
    fn from(c: CreatedIdentity) -> Self {
        Self {
            document: c.document,
            keypair: c.keypair,
        }
    }
}

impl From<DerivedIdentity> for AgentIdentityRecord {
    fn from(d: DerivedIdentity) -> Self {
        Self {
            document: d.document,
            keypair: d.keypair,
        }
    }
}

/// Mint a fresh Human Root (HMR) identity.
///
/// Most apps don't call this directly — agents derive from a parent. This is
/// exposed for tests and for the rare case of bootstrapping a new root.
///
/// # Errors
///
/// Returns [`OpenAgentError::Identity`] if document construction or signing
/// fails inside OAS.
pub fn mint_human_root(namespace: &str, identifier: &str) -> Result<AgentIdentityRecord> {
    let created_at = Utc::now().to_rfc3339();
    let identity = create_hmr(namespace, identifier, &created_at)?;
    Ok(identity.into())
}

/// Derive a child agent (or tool, skill, workflow) from a parent identity.
///
/// Performs HKDF-SHA256 key derivation, builds the child document with a
/// lineage section, and signs the document. The returned record can be used
/// directly or registered with an [`oas_lineage::provider::InMemoryProvider`]
/// for chain verification.
///
/// # Errors
///
/// Returns [`OpenAgentError::Identity`] if any step inside [`oas_sdk::lineage`]
/// fails.
pub fn derive_agent(
    parent_keypair: &OasKeyPair,
    parent_doc: &OasDocument,
    namespace: &str,
    kind: &str,
    identifier: &str,
    derivation_path: &str,
) -> Result<AgentIdentityRecord> {
    let created_at = Utc::now().to_rfc3339();
    let child = derive_child(
        parent_keypair,
        parent_doc,
        namespace,
        kind,
        identifier,
        derivation_path,
        &created_at,
    )?;
    Ok(child.into())
}

/// Verify a document's lineage chain back to a human root.
///
/// Provider must already contain every parent document on the chain (the
/// OpenAgent SDK does not perform DID resolution; that lives in AEGIS).
///
/// # Errors
///
/// Returns [`OpenAgentError::Identity`] if any hop fails verification.
pub fn verify_lineage_chain(document: &OasDocument, provider: &dyn DocumentProvider) -> Result<()> {
    verify_chain(document, provider, &VerifyConfig::default())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use oas_lineage::provider::InMemoryProvider;

    #[test]
    fn parse_did_succeeds_on_valid_input() {
        let parsed = ParsedDid::parse("did:oas:l1fe:hmr:alice").unwrap_or_else(|e| {
            unreachable!("parse failed: {e}");
        });
        assert_eq!(parsed.namespace, "l1fe");
        assert_eq!(parsed.kind, "hmr");
        assert_eq!(parsed.identifier, "alice");
    }

    #[test]
    fn parse_did_round_trips() {
        let did = "did:oas:openagent:agent:my-bot";
        let parsed = ParsedDid::parse(did).unwrap_or_else(|e| unreachable!("{e}"));
        assert_eq!(parsed.to_did(), did);
    }

    #[test]
    fn parse_did_rejects_garbage() {
        assert!(ParsedDid::parse("nope").is_err());
        assert!(ParsedDid::parse("did:web:example").is_err());
        assert!(ParsedDid::parse("did:oas::agent:x").is_err());
    }

    #[test]
    fn mint_human_root_returns_signed_document() {
        let id = mint_human_root("test", "alice").unwrap_or_else(|e| unreachable!("{e}"));
        assert_eq!(id.document.id, "did:oas:test:hmr:alice");
        assert!(id.document.proof.is_some());
    }

    #[test]
    fn derive_agent_produces_lineage_section() {
        let parent = mint_human_root("test", "alice").unwrap_or_else(|e| unreachable!("{e}"));
        let agent = derive_agent(
            &parent.keypair,
            &parent.document,
            "test",
            "agent",
            "bot",
            "agent/bot",
        )
        .unwrap_or_else(|e| unreachable!("{e}"));
        assert_eq!(agent.document.id, "did:oas:test:agent:bot");
        assert!(agent.document.lineage.is_some());
    }

    #[test]
    fn verify_lineage_chain_succeeds_with_registered_parent() {
        let parent = mint_human_root("test", "alice").unwrap_or_else(|e| unreachable!("{e}"));
        let agent = derive_agent(
            &parent.keypair,
            &parent.document,
            "test",
            "agent",
            "bot",
            "agent/bot",
        )
        .unwrap_or_else(|e| unreachable!("{e}"));

        let mut provider = InMemoryProvider::new();
        provider.register(parent.document.clone());
        assert!(verify_lineage_chain(&agent.document, &provider).is_ok());
    }
}
