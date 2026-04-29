//! Plugin composition root.
//!
//! Wires identity, capabilities, skills policy, and audit into a single
//! struct that implements [`crate::hooks::OpenAgentHooks`]. Any Rust
//! agent harness can either embed this directly or wrap it.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{json, Value};
use tokio::sync::RwLock;

use crate::audit::{AuditChain, AuditKind, AuditSink, Outcome};
use crate::error::{Error, Result};
use crate::hash::{hash_hex, hash_value};
use crate::hooks::{HookContext, OpenAgentHooks};
use crate::identity::OpenAgentIdentity;
use crate::policy::{skill_scope, tool_scope, CapabilityChecker, SkillsPolicy};

/// Behaviour on a denied tool / skill request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DenyMode {
    /// Return `Err(Error::ToolDenied / SkillDenied)`.
    Throw,
    /// Record the deny in the audit log and return `Ok(())`.
    Block,
}

/// Plugin configuration.
pub struct PluginConfig {
    /// The verified OpenAgent identity to attach to the session. Any
    /// implementor of [`OpenAgentIdentity`] is accepted — typically an
    /// [`crate::identity::OpenAgentSdkIdentity`] in production or
    /// [`crate::identity::Identity`] in tests.
    pub identity: Arc<dyn OpenAgentIdentity>,
    /// Capability checker (Arsenal-backed in production).
    pub capabilities: Arc<dyn CapabilityChecker>,
    /// Skills policy.
    pub skills_policy: Arc<dyn SkillsPolicy>,
    /// Audit sink.
    pub sink: Arc<dyn AuditSink>,
    /// Sign outbound messages with the agent key.
    pub sign_messages: bool,
    /// Behaviour on deny.
    pub deny_mode: DenyMode,
}

/// The composition root that drives the lifecycle hooks.
pub struct OpenAgentPlugin {
    config: PluginConfigInner,
    ctx: RwLock<Option<HookContext>>,
}

struct PluginConfigInner {
    identity: Arc<dyn OpenAgentIdentity>,
    capabilities: Arc<dyn CapabilityChecker>,
    skills_policy: Arc<dyn SkillsPolicy>,
    sink: Arc<dyn AuditSink>,
    sign_messages: bool,
    deny_mode: DenyMode,
}

impl OpenAgentPlugin {
    /// Construct a new plugin from configuration.
    pub fn new(config: PluginConfig) -> Self {
        Self {
            config: PluginConfigInner {
                identity: config.identity,
                capabilities: config.capabilities,
                skills_policy: config.skills_policy,
                sink: config.sink,
                sign_messages: config.sign_messages,
                deny_mode: config.deny_mode,
            },
            ctx: RwLock::new(None),
        }
    }

    /// Begin a new session — must be called before any other hook.
    pub async fn session_start(&self, session_id: &str) -> Result<()> {
        let chain = Arc::new(AuditChain::new(
            session_id.to_string(),
            self.config.identity.did().to_string(),
            self.config.sink.clone(),
        ));
        chain
            .append(
                AuditKind::SessionStart,
                None,
                Outcome::Ok,
                None,
                None,
                Some(json!({
                    "did": self.config.identity.did(),
                    "kind": self.config.identity.kind(),
                })),
            )
            .await?;
        let ctx = HookContext {
            identity: self.config.identity.clone(),
            capabilities: self.config.capabilities.clone(),
            skills_policy: self.config.skills_policy.clone(),
            chain,
            sign_messages: self.config.sign_messages,
        };
        let mut guard = self.ctx.write().await;
        *guard = Some(ctx);
        Ok(())
    }

    /// End the current session.
    pub async fn session_end(&self) -> Result<()> {
        let mut guard = self.ctx.write().await;
        if let Some(ctx) = guard.as_ref() {
            ctx.chain
                .append(
                    AuditKind::SessionStop,
                    None,
                    Outcome::Ok,
                    None,
                    None,
                    Some(json!({"did": ctx.identity.did(), "head": ctx.chain.head()})),
                )
                .await?;
        }
        *guard = None;
        Ok(())
    }

    /// Verify a tool call against Arsenal scopes (preflight).
    pub async fn pre_tool_use(&self, tool_name: &str, args: &Value) -> Result<()> {
        let guard = self.ctx.read().await;
        let ctx = guard.as_ref().ok_or(Error::NoActiveSession)?;
        let required = tool_scope(tool_name);
        let decision = ctx.capabilities.check(&required).await?;
        let input_hash = hash_value(args)?;
        if !decision.allowed {
            ctx.chain
                .append(
                    AuditKind::ToolPreflight,
                    Some(tool_name),
                    Outcome::Deny,
                    Some(input_hash),
                    None,
                    Some(json!({
                        "required_scope": required,
                        "reason": decision.reason.clone().unwrap_or_default(),
                    })),
                )
                .await?;
            return match self.config.deny_mode {
                DenyMode::Throw => Err(Error::ToolDenied {
                    tool: tool_name.to_string(),
                    required_scope: required,
                    reason: decision
                        .reason
                        .unwrap_or_else(|| "no matching scope".to_string()),
                }),
                DenyMode::Block => Ok(()),
            };
        }
        ctx.chain
            .append(
                AuditKind::ToolPreflight,
                Some(tool_name),
                Outcome::Allow,
                Some(input_hash),
                None,
                Some(json!({
                    "required_scope": required,
                    "matched_scope": decision.matched_scope,
                })),
            )
            .await?;
        Ok(())
    }

    /// Emit a post-tool-use audit record.
    pub async fn post_tool_use(
        &self,
        tool_name: &str,
        result: &Value,
        ok: bool,
        error: Option<&str>,
    ) -> Result<()> {
        let guard = self.ctx.read().await;
        let ctx = guard.as_ref().ok_or(Error::NoActiveSession)?;
        let output_hash = hash_value(result)?;
        ctx.chain
            .append(
                AuditKind::ToolComplete,
                Some(tool_name),
                if ok { Outcome::Ok } else { Outcome::Error },
                None,
                Some(output_hash),
                error.map(|e| json!({"error": e})),
            )
            .await?;
        Ok(())
    }

    /// Sign an outbound message and emit an audit record.
    pub async fn on_message(&self, body: &[u8], outbound: bool) -> Result<Option<String>> {
        let guard = self.ctx.read().await;
        let ctx = guard.as_ref().ok_or(Error::NoActiveSession)?;
        let input_hash = hash_hex(body);
        let signature = if ctx.sign_messages && outbound {
            let sig = ctx.identity.sign(body).await?;
            Some(hex::encode(sig))
        } else {
            None
        };
        ctx.chain
            .append(
                AuditKind::MessageSigned,
                None,
                if signature.is_some() {
                    Outcome::Ok
                } else {
                    Outcome::Allow
                },
                Some(input_hash),
                None,
                Some(json!({
                    "direction": if outbound { "out" } else { "in" },
                    "signature": signature,
                })),
            )
            .await?;
        Ok(signature)
    }

    /// Consult the skills policy before a SKILLS.md skill runs.
    pub async fn on_skill_invoke(
        &self,
        skill_name: &str,
        args: Option<&Value>,
    ) -> Result<()> {
        let guard = self.ctx.read().await;
        let ctx = guard.as_ref().ok_or(Error::NoActiveSession)?;
        let decision = ctx
            .skills_policy
            .evaluate(skill_name, ctx.identity.as_ref(), ctx.capabilities.as_ref())
            .await?;
        let input_hash = match args {
            Some(v) => Some(hash_value(v)?),
            None => None,
        };
        ctx.chain
            .append(
                AuditKind::SkillPreflight,
                Some(skill_name),
                if decision.allowed {
                    Outcome::Allow
                } else {
                    Outcome::Deny
                },
                input_hash,
                None,
                Some(json!({
                    "required_scope": skill_scope(skill_name),
                    "reason": decision.reason.clone(),
                    "matched_scope": decision.matched_scope.clone(),
                })),
            )
            .await?;
        if !decision.allowed {
            return match self.config.deny_mode {
                DenyMode::Throw => Err(Error::SkillDenied {
                    skill: skill_name.to_string(),
                    reason: decision
                        .reason
                        .unwrap_or_else(|| "policy denied".to_string()),
                }),
                DenyMode::Block => Ok(()),
            };
        }
        Ok(())
    }
}

#[async_trait]
impl OpenAgentHooks for OpenAgentPlugin {
    async fn on_session_start(&self, session_id: &str) -> Result<()> {
        self.session_start(session_id).await
    }

    async fn on_session_end(&self) -> Result<()> {
        self.session_end().await
    }

    async fn pre_tool_use(&self, tool_name: &str, args: &Value) -> Result<()> {
        OpenAgentPlugin::pre_tool_use(self, tool_name, args).await
    }

    async fn post_tool_use(
        &self,
        tool_name: &str,
        result: &Value,
        ok: bool,
        error: Option<&str>,
    ) -> Result<()> {
        OpenAgentPlugin::post_tool_use(self, tool_name, result, ok, error).await
    }

    async fn on_message(&self, body: &[u8], outbound: bool) -> Result<Option<String>> {
        OpenAgentPlugin::on_message(self, body, outbound).await
    }

    async fn on_skill_invoke(&self, skill_name: &str, args: Option<&Value>) -> Result<()> {
        OpenAgentPlugin::on_skill_invoke(self, skill_name, args).await
    }
}
