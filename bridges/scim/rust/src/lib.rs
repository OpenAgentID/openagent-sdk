//! # openagent-scim
//!
//! SCIM 2.0 provisioning bridge for OpenAgent — enterprise agent lifecycle
//! management via RFC 7644.
//!
//! This crate provides:
//! - Trait definitions for the SCIM provisioner
//! - SCIM resource types (User + Agent extension)
//! - OAS Agent <-> SCIM User mapping functions
//!
//! The TypeScript implementation (`@openagent/scim`) is the primary SDK.
//! This Rust crate provides trait definitions and reference types for
//! Rust-native integrations.

pub mod mapping;
pub mod types;

use async_trait::async_trait;
use types::{AgentRecord, AuditEvent, CreateAgentParams};

/// Errors from the SCIM provisioner.
#[derive(Debug, thiserror::Error)]
pub enum ScimError {
    #[error("Agent not found: {did}")]
    NotFound { did: String },

    #[error("Agent already exists: {did}")]
    Conflict { did: String },

    #[error("Invalid input: {detail}")]
    InvalidInput { detail: String },

    #[error("Store error: {0}")]
    Store(String),

    #[error("Deprovisioning cascade error: {step} — {detail}")]
    CascadeError { step: String, detail: String },
}

/// Result type for SCIM operations.
pub type ScimResult<T> = Result<T, ScimError>;

/// Storage interface for agent records.
///
/// Implementations must return cloned/owned data — never hand out mutable
/// references to internal state.
#[async_trait]
pub trait AgentStore: Send + Sync {
    async fn list(&self) -> ScimResult<Vec<AgentRecord>>;
    async fn find_by_did(&self, did: &str) -> ScimResult<Option<AgentRecord>>;
    async fn find_by_user_name(&self, user_name: &str) -> ScimResult<Option<AgentRecord>>;
    async fn find_by_external_id(&self, external_id: &str) -> ScimResult<Option<AgentRecord>>;
    async fn create(&self, record: AgentRecord) -> ScimResult<AgentRecord>;
    async fn update(&self, did: &str, record: AgentRecord) -> ScimResult<AgentRecord>;
    async fn delete(&self, did: &str) -> ScimResult<()>;
}

/// DID document revocation hook.
#[async_trait]
pub trait DidRevoker: Send + Sync {
    async fn revoke(&self, did: &str) -> ScimResult<()>;
}

/// Delegation tree cascade revocation hook.
#[async_trait]
pub trait DelegationCascadeRevoker: Send + Sync {
    async fn cascade_revoke(&self, did: &str) -> ScimResult<()>;
}

/// Arsenal session invalidation hook.
#[async_trait]
pub trait ArsenalSessionInvalidator: Send + Sync {
    async fn invalidate_sessions(&self, did: &str) -> ScimResult<()>;
}

/// Audit event sink.
#[async_trait]
pub trait AuditSink: Send + Sync {
    async fn emit(&self, event: AuditEvent) -> ScimResult<()>;
}

/// The SCIM provisioner trait — core lifecycle operations.
///
/// Implementations wire together storage, DID management, delegation
/// cascade, Arsenal session control, and audit emission.
#[async_trait]
pub trait ScimProvisioner: Send + Sync {
    /// Create a new agent identity via SCIM.
    async fn create_agent(&self, params: CreateAgentParams) -> ScimResult<AgentRecord>;

    /// Replace an agent record (SCIM PUT).
    async fn replace_agent(
        &self,
        did: &str,
        params: CreateAgentParams,
    ) -> ScimResult<AgentRecord>;

    /// Partial update (SCIM PATCH). Receives the already-patched record.
    async fn update_agent(&self, did: &str, record: AgentRecord) -> ScimResult<AgentRecord>;

    /// Deprovision an agent — the killer feature.
    ///
    /// Execution order:
    /// 1. Revoke the agent's DID document
    /// 2. Cascade-revoke all delegation proofs
    /// 3. Invalidate all active Arsenal sessions
    /// 4. Delete the agent record from the store
    /// 5. Emit audit event
    async fn deprovision_agent(&self, did: &str) -> ScimResult<()>;

    /// Find agent by DID.
    async fn find_by_did(&self, did: &str) -> ScimResult<Option<AgentRecord>>;

    /// List all agents.
    async fn list_agents(&self) -> ScimResult<Vec<AgentRecord>>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_display() {
        let err = ScimError::NotFound {
            did: "did:oas:l1fe:agent:test".to_string(),
        };
        assert!(err.to_string().contains("not found"));
    }

    #[test]
    fn error_variants() {
        let _ = ScimError::Conflict {
            did: "test".to_string(),
        };
        let _ = ScimError::InvalidInput {
            detail: "bad".to_string(),
        };
        let _ = ScimError::Store("oops".to_string());
        let _ = ScimError::CascadeError {
            step: "revoke-did".to_string(),
            detail: "timeout".to_string(),
        };
    }
}
