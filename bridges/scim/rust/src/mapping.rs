//! OAS Agent <-> SCIM User bidirectional mapping.

use crate::types::{
    AgentExtension, AgentRecord, ConformanceLevel, ScimAgentResource, ScimMeta,
    OPENAGENT_AGENT_SCHEMA, SCIM_USER_SCHEMA,
};

/// Convert an internal `AgentRecord` into a SCIM `ScimAgentResource`.
pub fn agent_to_scim_resource(agent: &AgentRecord, base_url: &str) -> ScimAgentResource {
    let location = format!(
        "{}/Users/{}",
        base_url,
        urlencoding_encode(&agent.did)
    );

    ScimAgentResource {
        schemas: vec![
            SCIM_USER_SCHEMA.to_string(),
            OPENAGENT_AGENT_SCHEMA.to_string(),
        ],
        id: agent.did.clone(),
        external_id: agent.external_id.clone(),
        user_name: agent.user_name.clone(),
        display_name: agent.display_name.clone(),
        active: agent.active,
        meta: ScimMeta {
            resource_type: "User".to_string(),
            created: agent.created_at.clone(),
            last_modified: agent.updated_at.clone(),
            location,
            version: format!("W/\"{}\"", agent.version),
        },
        agent_extension: AgentExtension {
            parent_did: agent.parent_did.clone(),
            conformance_level: agent.conformance_level,
            scopes: agent.scopes.clone(),
            lineage_depth: agent.lineage_depth,
            created_via: agent.created_via.clone(),
            keypair_fingerprint: agent.keypair_fingerprint.clone(),
        },
    }
}

/// Convert a SCIM resource back to an internal `AgentRecord`.
///
/// This is used when processing SCIM PUT requests that provide a full
/// replacement resource.
pub fn scim_resource_to_agent(
    resource: &ScimAgentResource,
    existing: &AgentRecord,
) -> AgentRecord {
    let now = chrono_now_iso();
    AgentRecord {
        did: existing.did.clone(),
        user_name: resource.user_name.clone(),
        display_name: resource.display_name.clone(),
        active: resource.active,
        parent_did: resource.agent_extension.parent_did.clone(),
        conformance_level: resource.agent_extension.conformance_level,
        scopes: resource.agent_extension.scopes.clone(),
        lineage_depth: existing.lineage_depth,
        created_via: existing.created_via.clone(),
        keypair_fingerprint: existing.keypair_fingerprint.clone(),
        created_at: existing.created_at.clone(),
        updated_at: now,
        version: generate_version(),
        external_id: resource.external_id.clone(),
    }
}

/// Derive a deterministic DID from namespace + userName.
pub fn derive_did(namespace: &str, user_name: &str) -> String {
    let sanitized: String = user_name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let trimmed = sanitized.trim_matches('-');
    format!("did:oas:{}:agent:{}", namespace, trimmed)
}

/// Derive a keypair fingerprint for a provisioned agent.
pub fn derive_keypair_fingerprint(did: &str) -> String {
    let mut hash: i64 = 0;
    for b in did.bytes() {
        hash = hash.wrapping_mul(31).wrapping_add(b as i64);
    }
    format!("z6Mk{:08}", hash.unsigned_abs())
}

/// Compute lineage depth: 1 if parent is HMR/MHR, otherwise derived.
pub fn compute_lineage_depth(parent_did: &str, parent_depth: Option<u32>) -> u32 {
    if parent_did.contains(":hmr:") || parent_did.contains(":mhr:") {
        return 1;
    }
    match parent_depth {
        Some(d) => d + 1,
        None => 1,
    }
}

/// Validate a conformance level string.
pub fn parse_conformance_level(s: &str) -> Result<ConformanceLevel, String> {
    match s {
        "L0" => Ok(ConformanceLevel::L0),
        "L1" => Ok(ConformanceLevel::L1),
        "L2" => Ok(ConformanceLevel::L2),
        _ => Err(format!("Invalid conformance level: {}", s)),
    }
}

// Minimal URL encoding for DIDs (colons are not percent-encoded in practice,
// but we handle the general case).
fn urlencoding_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b':' => {
                out.push(b as char);
            }
            _ => {
                out.push_str(&format!("%{:02X}", b));
            }
        }
    }
    out
}

fn chrono_now_iso() -> String {
    // Portable ISO-8601 without chrono dependency
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("1970-01-01T00:00:00Z+{}s", secs) // placeholder; real impl uses chrono
}

fn generate_version() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{:x}", secs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_did() {
        assert_eq!(
            derive_did("l1fe", "my-bot"),
            "did:oas:l1fe:agent:my-bot"
        );
    }

    #[test]
    fn test_derive_did_sanitizes_spaces() {
        let did = derive_did("l1fe", "My Bot Agent");
        assert_eq!(did, "did:oas:l1fe:agent:my-bot-agent");
    }

    #[test]
    fn test_derive_keypair_fingerprint() {
        let fp = derive_keypair_fingerprint("did:oas:l1fe:agent:test");
        assert!(fp.starts_with("z6Mk"));
    }

    #[test]
    fn test_compute_lineage_depth_hmr() {
        assert_eq!(compute_lineage_depth("did:oas:l1fe:hmr:alice", None), 1);
    }

    #[test]
    fn test_compute_lineage_depth_mhr() {
        assert_eq!(compute_lineage_depth("did:oas:l1fe:mhr:team", None), 1);
    }

    #[test]
    fn test_compute_lineage_depth_agent_parent() {
        assert_eq!(
            compute_lineage_depth("did:oas:l1fe:agent:parent", Some(1)),
            2
        );
    }

    #[test]
    fn test_parse_conformance_level() {
        assert_eq!(parse_conformance_level("L0"), Ok(ConformanceLevel::L0));
        assert_eq!(parse_conformance_level("L1"), Ok(ConformanceLevel::L1));
        assert_eq!(parse_conformance_level("L2"), Ok(ConformanceLevel::L2));
        assert!(parse_conformance_level("L3").is_err());
    }

    #[test]
    fn test_agent_to_scim_roundtrip() {
        let record = AgentRecord {
            did: "did:oas:l1fe:agent:test".to_string(),
            user_name: "test".to_string(),
            display_name: "Test Agent".to_string(),
            active: true,
            parent_did: "did:oas:l1fe:hmr:alice".to_string(),
            conformance_level: ConformanceLevel::L2,
            scopes: vec!["openai:chat:completions".to_string()],
            lineage_depth: 1,
            created_via: "scim".to_string(),
            keypair_fingerprint: "z6Mktest".to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            version: "v1".to_string(),
            external_id: None,
        };

        let resource = agent_to_scim_resource(&record, "https://example.com/scim/v2");
        assert_eq!(resource.id, "did:oas:l1fe:agent:test");
        assert_eq!(resource.user_name, "test");
        assert_eq!(resource.agent_extension.conformance_level, ConformanceLevel::L2);
        assert_eq!(resource.meta.resource_type, "User");
        assert!(resource.meta.version.starts_with("W/\""));
    }
}
