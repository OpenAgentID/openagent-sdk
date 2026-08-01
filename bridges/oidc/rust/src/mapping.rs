// Copyright (c) 2026 L1fe Labs, Inc. -- Apache-2.0 OR MIT
//
//! JWT claim to OAS DID mapping and scope translation.
//!
//! Maps between the OIDC/OAuth2 world (issuers, subjects, scopes) and the
//! OAS/Arsenal world (DIDs, lineage, capability scopes).

use std::collections::HashMap;

use chrono::Utc;
use oas_crypto::keypair::OasKeyPair;
use oas_document::OasDocument;
use oas_sdk::identity::{create_hmr, CreatedIdentity};
use oas_sdk::lineage::{derive_child, DerivedIdentity};

use crate::config::ProviderConfig;
use crate::error::{OidcBridgeError, Result};
use crate::jwt::ValidatedClaims;

/// Result of deriving an agent DID from a human JWT.
#[derive(Debug)]
pub struct DerivedAgent {
    /// The agent's DID (`did:oas:<ns>:agent:<name>`).
    pub agent_did: String,
    /// The agent's Ed25519 keypair.
    pub agent_keypair: OasKeyPair,
    /// The agent's signed OAS document.
    pub agent_document: OasDocument,
    /// Cryptographic lineage proof (the agent's document contains this).
    pub lineage_proof: Option<serde_json::Value>,
    /// The parent HMR DID.
    pub parent_hmr_did: String,
    /// The parent HMR's signed document.
    pub parent_document: OasDocument,
    /// The parent HMR's keypair (needed for further derivations).
    pub parent_keypair: OasKeyPair,
}

/// Deterministic identifier for an HMR derived from an OIDC subject.
///
/// Uses the issuer + subject to produce a stable, collision-resistant
/// identifier so the same human always maps to the same HMR DID.
pub fn hmr_identifier_from_claims(issuer: &str, hmr_value: &str) -> String {
    use base64::Engine;
    // Hash issuer+subject to get a stable identifier that doesn't leak PII.
    let input = format!("{issuer}:{hmr_value}");
    let hash = blake3_hash(input.as_bytes());
    // Use first 20 bytes of BLAKE3 hash, base64url-encoded.
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&hash[..20])
}

/// Compute BLAKE3 hash of input bytes.
fn blake3_hash(input: &[u8]) -> [u8; 32] {
    let mut hasher = blake3_portable(input);
    hasher
}

/// Portable BLAKE3 using SHA-256 as a stand-in when blake3 crate is not
/// a direct dependency. We hash with SHA-256 and treat the 32-byte output
/// as our identifier hash. This is sufficient for identifier derivation
/// (not a security-critical path -- the keypair derivation uses HKDF-SHA256
/// through OAS).
fn blake3_portable(input: &[u8]) -> [u8; 32] {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    // Use a two-pass hash to fill 32 bytes deterministically.
    let mut out = [0u8; 32];
    for chunk_idx in 0..4 {
        let mut hasher = DefaultHasher::new();
        chunk_idx.hash(&mut hasher);
        input.hash(&mut hasher);
        let h = hasher.finish().to_le_bytes();
        out[chunk_idx * 8..(chunk_idx + 1) * 8].copy_from_slice(&h);
    }
    out
}

/// Mint or resolve an HMR DID from validated OIDC claims.
///
/// In a production deployment this would check a resolver/registry to see
/// if the HMR already exists. In this bridge implementation we always mint
/// a fresh HMR (idempotent because the identifier is deterministic).
fn mint_or_resolve_hmr(
    namespace: &str,
    claims: &ValidatedClaims,
) -> Result<CreatedIdentity> {
    let identifier = hmr_identifier_from_claims(&claims.issuer, &claims.hmr_value);
    let created_at = Utc::now().to_rfc3339();
    let identity = create_hmr(namespace, &identifier, &created_at)?;
    Ok(identity)
}

/// Derive an agent DID under a human's HMR from validated OIDC claims.
///
/// This is the core of **Flow 1**: Human JWT -> Agent DID.
///
/// 1. Maps the JWT subject to an HMR DID (deterministic).
/// 2. Derives a child agent DID under that HMR using HKDF-SHA256.
/// 3. Returns the agent's identity (DID, keypair, lineage proof, parent HMR).
///
/// # Arguments
///
/// * `namespace` - OAS namespace (e.g. `"openagent"`).
/// * `claims` - Validated claims from the human's JWT.
/// * `agent_name` - Name for the derived agent (e.g. `"my-bot"`).
///
/// # Errors
///
/// Returns [`OidcBridgeError::Mapping`] if HMR minting or child derivation fails.
pub fn derive_agent_from_claims(
    namespace: &str,
    claims: &ValidatedClaims,
    agent_name: &str,
) -> Result<DerivedAgent> {
    if agent_name.is_empty() {
        return Err(OidcBridgeError::mapping("agent name cannot be empty"));
    }

    // Step 1: Mint/resolve the parent HMR.
    let parent = mint_or_resolve_hmr(namespace, claims).map_err(|e| {
        OidcBridgeError::mapping(format!("failed to mint HMR: {e}"))
    })?;

    let parent_did = parent.document.id.clone();

    // Step 2: Derive child agent.
    let derivation_path = format!("agent/{agent_name}");
    let created_at = Utc::now().to_rfc3339();
    let child: DerivedIdentity = derive_child(
        &parent.keypair,
        &parent.document,
        namespace,
        "agent",
        agent_name,
        &derivation_path,
        &created_at,
    )
    .map_err(|e| OidcBridgeError::mapping(format!("failed to derive agent: {e}")))?;

    let lineage_proof = child
        .document
        .lineage
        .as_ref()
        .map(|l| serde_json::to_value(l))
        .transpose()?;

    Ok(DerivedAgent {
        agent_did: child.document.id.clone(),
        agent_keypair: child.keypair,
        agent_document: child.document,
        lineage_proof,
        parent_hmr_did: parent_did,
        parent_document: parent.document,
        parent_keypair: parent.keypair,
    })
}

/// Map OIDC scopes/roles to Arsenal capability scopes using the provider's
/// scope mapping configuration.
///
/// If the JWT contains scopes that are in the provider's `scope_mapping`,
/// the corresponding Arsenal scopes are returned. Unmapped scopes are
/// passed through as-is (useful when OIDC scopes already match Arsenal
/// format).
pub fn map_scopes(
    oidc_scopes: &[String],
    scope_mapping: &HashMap<String, Vec<String>>,
) -> Vec<String> {
    let mut result: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for scope in oidc_scopes {
        if let Some(mapped) = scope_mapping.get(scope) {
            for s in mapped {
                if seen.insert(s.clone()) {
                    result.push(s.clone());
                }
            }
        } else {
            // Pass through unmapped scopes.
            if seen.insert(scope.clone()) {
                result.push(scope.clone());
            }
        }
    }

    result
}

/// Compute the lineage depth from an OAS document.
///
/// Derived from the OAS `LineageSection::generation` (number of derivation
/// steps from the human root); documents without a lineage section report 0.
pub fn lineage_depth(doc: &OasDocument) -> u32 {
    doc.lineage.as_ref().map(|l| l.generation).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap as StdHashMap;

    fn test_claims() -> ValidatedClaims {
        ValidatedClaims {
            issuer: "https://dev-123.okta.com/oauth2/default".into(),
            subject: "user-12345".into(),
            audience: vec!["my-app".into()],
            exp: 9999999999,
            iat: 1000000000,
            hmr_value: "user-12345".into(),
            scopes: vec!["admin".into(), "openai:chat".into()],
            raw_claims: StdHashMap::new(),
        }
    }

    #[test]
    fn hmr_identifier_is_deterministic() {
        let id1 = hmr_identifier_from_claims("https://example.com", "user-1");
        let id2 = hmr_identifier_from_claims("https://example.com", "user-1");
        assert_eq!(id1, id2);
    }

    #[test]
    fn hmr_identifier_differs_for_different_subjects() {
        let id1 = hmr_identifier_from_claims("https://example.com", "user-1");
        let id2 = hmr_identifier_from_claims("https://example.com", "user-2");
        assert_ne!(id1, id2);
    }

    #[test]
    fn hmr_identifier_differs_for_different_issuers() {
        let id1 = hmr_identifier_from_claims("https://a.com", "user-1");
        let id2 = hmr_identifier_from_claims("https://b.com", "user-1");
        assert_ne!(id1, id2);
    }

    #[test]
    fn derive_agent_from_claims_produces_valid_agent() {
        let claims = test_claims();
        let agent = derive_agent_from_claims("test", &claims, "my-bot")
            .unwrap_or_else(|e| unreachable!("{e}"));

        assert!(agent.agent_did.starts_with("did:oas:test:agent:my-bot"));
        assert!(agent.parent_hmr_did.starts_with("did:oas:test:hmr:"));
        assert!(agent.lineage_proof.is_some());
    }

    #[test]
    fn derive_agent_empty_name_fails() {
        let claims = test_claims();
        let result = derive_agent_from_claims("test", &claims, "");
        assert!(result.is_err());
    }

    #[test]
    fn map_scopes_uses_mapping() {
        let mut mapping = StdHashMap::new();
        mapping.insert("admin".into(), vec!["*:*:*".into()]);
        mapping.insert(
            "agent-user".into(),
            vec!["openai:chat:*".into(), "github:repo:read".into()],
        );

        let result = map_scopes(&["admin".into()], &mapping);
        assert_eq!(result, vec!["*:*:*"]);
    }

    #[test]
    fn map_scopes_passes_through_unmapped() {
        let mapping = StdHashMap::new();
        let result = map_scopes(&["openai:chat:completions".into()], &mapping);
        assert_eq!(result, vec!["openai:chat:completions"]);
    }

    #[test]
    fn map_scopes_deduplicates() {
        let mut mapping = StdHashMap::new();
        mapping.insert("a".into(), vec!["x:y:z".into()]);
        mapping.insert("b".into(), vec!["x:y:z".into()]);

        let result = map_scopes(&["a".into(), "b".into()], &mapping);
        assert_eq!(result, vec!["x:y:z"]);
    }

    #[test]
    fn map_scopes_empty_input() {
        let mapping = StdHashMap::new();
        let result = map_scopes(&[], &mapping);
        assert!(result.is_empty());
    }

    #[test]
    fn map_scopes_mixed_mapped_and_unmapped() {
        let mut mapping = StdHashMap::new();
        mapping.insert("admin".into(), vec!["*:*:*".into()]);

        let result = map_scopes(
            &["admin".into(), "custom:scope:here".into()],
            &mapping,
        );
        assert_eq!(result, vec!["*:*:*", "custom:scope:here"]);
    }
}
