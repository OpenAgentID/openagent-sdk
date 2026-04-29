//! # `openagent-mcp` — OpenAgent middleware for the Model Context Protocol
//!
//! Add OAS identity verification, Arsenal capability tokens, and AEGIS
//! authorization to any MCP server in three lines.
//!
//! ## Quick start
//!
//! ```no_run
//! use openagent_mcp::{
//!     Agent, Config, Identity, IdentityVerifier, OpenAgentMiddleware,
//!     ToolHandler, VerifiedIdentity, WithOpenAgent,
//! };
//! use std::sync::Arc;
//!
//! # async fn example(my_handler: impl ToolHandler + Send + Sync + 'static, agent: Arc<dyn Agent>) {
//! let middleware = OpenAgentMiddleware::new(Config::new(agent));
//! let authed = my_handler.with_openagent(middleware);
//! # let _ = authed;
//! # }
//! ```
//!
//! ## Architecture
//!
//! The crate is organized in three layers:
//!
//! 1. **Traits and types** ([`Agent`], [`IdentityVerifier`], [`ToolHandler`],
//!    [`Identity`], [`VerifiedIdentity`], [`Config`]) — the contract every
//!    integration speaks.
//! 2. **Middleware engine** ([`OpenAgentMiddleware`]) — the auth pipeline:
//!    extract identity, verify, enforce scopes, run skills policy, run
//!    pre/post hooks, stamp audit metadata.
//! 3. **Adapters** — `WithOpenAgent` for any custom handler, and an
//!    optional `rmcp` adapter behind the `rmcp` feature flag for the
//!    upstream Rust MCP SDK.
//!
//! ## Version pinning
//!
//! The optional `rmcp` adapter is built against `rmcp@^0.2`. The crate
//! itself does **not** depend on rmcp by default — it ships a small
//! [`ToolHandler`] trait that any server implementation can satisfy. This
//! lets the same middleware support `rmcp`, custom transports, and
//! native OpenAgent runtimes without locking into a single MCP SDK
//! version.

#![deny(rust_2018_idioms)]
#![warn(missing_docs, missing_debug_implementations)]

mod errors;
mod handler;
mod middleware;
mod skills;
mod types;

#[cfg(feature = "rmcp")]
mod rmcp_adapter;

#[cfg(feature = "rmcp")]
pub use rmcp_adapter::RmcpOpenAgent;

pub use errors::{McpAuthError, McpErrorCode};
pub use handler::{
    InMemoryToolHandler, RegisteredTool, ToolCall, ToolHandler, ToolResult, WithOpenAgent,
    WrappedHandler,
};
pub use middleware::{OpenAgentMiddleware, default_require_scopes, default_scope_format};
pub use skills::{
    InMemorySkillsStore, SkillsPolicy, SkillsPolicyDecision, SkillsRule, SkillsStore,
    DEFAULT_SKILL_TOOL_NAMES,
};
pub use types::{
    Agent, AuditMeta, Config, ErrorHook, Identity, IdentityVerifier, PostCallHook, PreCallHook,
    ScopeDeriver, VerifiedIdentity,
};
