//! # `openagent-claude-agent`
//!
//! OpenAgent identity, capability control, and tamper-evident audit hooks
//! for the Claude Agent SDK.
//!
//! ## What this crate is
//!
//! Anthropic does not (yet) ship an official Rust Claude Agent SDK — the
//! reference integration lives in the TypeScript package
//! `@openagent/claude-agent`. This crate is the **framework-agnostic Rust
//! analog**: a small trait surface plus drop-in policy / audit primitives
//! that any Rust agent harness can implement.
//!
//! Implement [`AgentHarness`] in your harness, hand it an
//! [`OpenAgentPlugin`], and the OpenAgent identity / capability / audit
//! contracts are wired in.
//!
//! ## Quick start
//!
//! ```no_run
//! use openagent_claude_agent::{
//!     audit::InMemoryAuditSink,
//!     identity::{Identity, OpenAgentIdentity},
//!     plugin::{DenyMode, OpenAgentPlugin, PluginConfig},
//!     policy::{StaticCapabilityChecker, DenyUnlessScopedSkillsPolicy},
//! };
//! use std::sync::Arc;
//!
//! # async fn run() -> Result<(), openagent_claude_agent::Error> {
//! let identity: Arc<dyn OpenAgentIdentity> = Arc::new(Identity::new(
//!     "did:oas:test:agent:refactor-bot",
//!     "agent",
//!     [0u8; 32],
//! ));
//! let plugin = OpenAgentPlugin::new(PluginConfig {
//!     identity,
//!     capabilities: Arc::new(StaticCapabilityChecker::new(["tools:invoke:bash"])),
//!     skills_policy: Arc::new(DenyUnlessScopedSkillsPolicy),
//!     sink: Arc::new(InMemoryAuditSink::new()),
//!     sign_messages: false,
//!     deny_mode: DenyMode::Throw,
//! });
//! plugin.session_start("sess-1").await?;
//! plugin.pre_tool_use("bash", &serde_json::json!({"cmd": "ls"})).await?;
//! plugin.post_tool_use("bash", &serde_json::json!("ok"), true, None).await?;
//! plugin.session_end().await?;
//! # Ok(())
//! # }
//! ```
//!
//! ## Modules
//!
//! - [`identity`] — `OpenAgentIdentity` and a default in-process implementation.
//! - [`policy`] — `CapabilityChecker` and `SkillsPolicy` traits + defaults.
//! - [`audit`] — Hash-chained audit log with verifiable records.
//! - [`hooks`] — Trait `OpenAgentHooks` framework adapters can implement.
//! - [`plugin`] — Composition root: `OpenAgentPlugin` ties everything together.

#![deny(unsafe_code)]
#![warn(missing_docs)]

pub mod audit;
pub mod error;
pub mod hash;
pub mod hooks;
pub mod identity;
pub mod plugin;
pub mod policy;

pub use error::Error;
pub use hooks::{HookContext, OpenAgentHooks};
pub use plugin::{OpenAgentPlugin, PluginConfig};
