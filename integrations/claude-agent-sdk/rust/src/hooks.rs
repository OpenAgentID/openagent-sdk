//! Lifecycle hook trait that any Rust agent harness can implement.
//!
//! The Rust analog of the TypeScript plugin hook surface. A harness
//! implements [`OpenAgentHooks`] (typically by delegating to
//! [`crate::plugin::OpenAgentPlugin`]) and calls each hook at the
//! corresponding lifecycle point.
//!
//! ## Adapter seam
//!
//! Anthropic does not currently ship a Rust Claude Agent SDK. When that
//! changes (or when wiring up a custom harness like Forge / Aut0), the
//! adapter is a thin shim that forwards SDK lifecycle events to the
//! methods on this trait — no other crate file needs to change.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;

use crate::audit::AuditChain;
use crate::error::Result;
use crate::identity::OpenAgentIdentity;
use crate::policy::{CapabilityChecker, SkillsPolicy};

/// Per-session hook context. Constructed on session start, threaded
/// through subsequent hook invocations, dropped on session end.
pub struct HookContext {
    /// The verified agent identity.
    pub identity: Arc<dyn OpenAgentIdentity>,
    /// Capability checker (Arsenal-backed in production).
    pub capabilities: Arc<dyn CapabilityChecker>,
    /// Skills policy (defaults to `DenyUnlessScopedSkillsPolicy`).
    pub skills_policy: Arc<dyn SkillsPolicy>,
    /// Audit chain for this session.
    pub chain: Arc<AuditChain>,
    /// Whether outbound messages are signed with the agent's key.
    pub sign_messages: bool,
}

/// Lifecycle hook trait. Implement this in any Rust agent harness to
/// receive OpenAgent enforcement and audit events.
#[async_trait]
pub trait OpenAgentHooks: Send + Sync {
    /// Called once when a new session begins.
    async fn on_session_start(&self, session_id: &str) -> Result<()>;

    /// Called once when the session ends.
    async fn on_session_end(&self) -> Result<()>;

    /// Called before a tool runs. Returns Err(ToolDenied) on deny in
    /// `Throw` mode; otherwise returns Ok with the (allow=false) audit
    /// trail already recorded.
    async fn pre_tool_use(&self, tool_name: &str, args: &Value) -> Result<()>;

    /// Called after a tool runs.
    async fn post_tool_use(
        &self,
        tool_name: &str,
        result: &Value,
        ok: bool,
        error: Option<&str>,
    ) -> Result<()>;

    /// Called when an outbound or inbound message passes through the agent.
    async fn on_message(&self, body: &[u8], outbound: bool) -> Result<Option<String>>;

    /// Called when the agent attempts to invoke a SKILLS.md skill.
    async fn on_skill_invoke(&self, skill_name: &str, args: Option<&Value>) -> Result<()>;
}
