//! SCIM 2.0 resource types — RFC 7643 core + OpenAgent agent extension.

use serde::{Deserialize, Serialize};

/// SCIM core User schema URN.
pub const SCIM_USER_SCHEMA: &str = "urn:ietf:params:scim:schemas:core:2.0:User";

/// OpenAgent agent extension schema URN.
pub const OPENAGENT_AGENT_SCHEMA: &str = "urn:openagent:scim:1.0:Agent";

/// SCIM List Response schema URN.
pub const SCIM_LIST_RESPONSE_SCHEMA: &str =
    "urn:ietf:params:scim:api:messages:2.0:ListResponse";

/// SCIM Error schema URN.
pub const SCIM_ERROR_SCHEMA: &str = "urn:ietf:params:scim:api:messages:2.0:Error";

/// SCIM PatchOp schema URN.
pub const SCIM_PATCH_OP_SCHEMA: &str = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

/// Conformance levels for OpenAgent agents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConformanceLevel {
    L0,
    L1,
    L2,
}

impl Default for ConformanceLevel {
    fn default() -> Self {
        Self::L1
    }
}

/// The OpenAgent agent extension attribute group.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentExtension {
    pub parent_did: String,
    pub conformance_level: ConformanceLevel,
    pub scopes: Vec<String>,
    pub lineage_depth: u32,
    pub created_via: String,
    pub keypair_fingerprint: String,
}

/// SCIM resource metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScimMeta {
    pub resource_type: String,
    pub created: String,
    pub last_modified: String,
    pub location: String,
    pub version: String,
}

/// Full SCIM User resource with agent extension.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScimAgentResource {
    pub schemas: Vec<String>,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_id: Option<String>,
    pub user_name: String,
    pub display_name: String,
    pub active: bool,
    pub meta: ScimMeta,
    #[serde(rename = "urn:openagent:scim:1.0:Agent")]
    pub agent_extension: AgentExtension,
}

/// SCIM List Response envelope.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScimListResponse<T: Serialize> {
    pub schemas: Vec<String>,
    pub total_results: usize,
    pub start_index: usize,
    pub items_per_page: usize,
    #[serde(rename = "Resources")]
    pub resources: Vec<T>,
}

/// SCIM Error response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScimErrorResponse {
    pub schemas: Vec<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scim_type: Option<String>,
    pub detail: String,
}

impl ScimErrorResponse {
    /// Create a new SCIM error response.
    pub fn new(status: u16, scim_type: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            schemas: vec![SCIM_ERROR_SCHEMA.to_string()],
            status: status.to_string(),
            scim_type: Some(scim_type.into()),
            detail: detail.into(),
        }
    }
}

/// Internal agent record — the canonical representation of a provisioned agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRecord {
    pub did: String,
    pub user_name: String,
    pub display_name: String,
    pub active: bool,
    pub parent_did: String,
    pub conformance_level: ConformanceLevel,
    pub scopes: Vec<String>,
    pub lineage_depth: u32,
    pub created_via: String,
    pub keypair_fingerprint: String,
    pub created_at: String,
    pub updated_at: String,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_id: Option<String>,
}

/// Parameters for creating a new agent via SCIM.
#[derive(Debug, Clone)]
pub struct CreateAgentParams {
    pub user_name: String,
    pub display_name: Option<String>,
    pub parent_did: String,
    pub conformance_level: ConformanceLevel,
    pub scopes: Vec<String>,
    pub external_id: Option<String>,
}

/// Audit event emitted during agent lifecycle operations.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEvent {
    #[serde(rename = "type")]
    pub event_type: AuditEventType,
    pub did: String,
    pub timestamp: String,
    pub details: serde_json::Value,
}

/// Audit event types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum AuditEventType {
    #[serde(rename = "agent.created")]
    AgentCreated,
    #[serde(rename = "agent.updated")]
    AgentUpdated,
    #[serde(rename = "agent.deprovisioned")]
    AgentDeprovisioned,
}

/// SCIM PATCH operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatchOperation {
    pub op: PatchOp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<serde_json::Value>,
}

/// SCIM PATCH operation type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PatchOp {
    Add,
    Replace,
    Remove,
}
