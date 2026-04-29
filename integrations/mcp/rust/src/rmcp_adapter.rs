//! Optional adapter for the upstream `rmcp` crate (Rust MCP SDK).
//!
//! This module is only compiled when the `rmcp` feature is enabled. It
//! provides a thin newtype, [`RmcpOpenAgent`], that wraps a
//! [`crate::handler::WrappedHandler`] and exposes the handle the rmcp
//! `ServerHandler` glue can dispatch to.
//!
//! ## Why a separate adapter?
//!
//! The `rmcp` crate's public trait surface has changed multiple times
//! in the 0.x line — `ServerHandler::call_tool`, `tool_handler!`
//! macros, parameter types, and the `ServerHandlerExt` trait were all
//! reshuffled between 0.1 and 0.2. To keep this crate forward-
//! compatible we deliberately keep the adapter narrow:
//!
//!   * The middleware engine ([`crate::OpenAgentMiddleware`]) lives in
//!     the unconditional code path and works with any handler that
//!     satisfies our [`crate::ToolHandler`] trait.
//!   * The rmcp adapter only translates between rmcp's wire types and
//!     our [`crate::ToolCall`] / [`crate::ToolResult`] types. Any
//!     future rmcp release that breaks the adapter only forces this
//!     file to update — the rest of the crate (and any user code that
//!     wraps a custom handler) keeps working.
//!
//! ## Version pinned
//!
//! Built against `rmcp@^0.2`. The adapter calls into the
//! `rmcp::model::CallToolRequestParam` / `CallToolResult` shapes that
//! are stable across the 0.2.x releases.

use std::sync::Arc;

use crate::errors::McpAuthError;
use crate::handler::{ToolCall, ToolHandler, ToolResult, WrappedHandler};

/// Newtype wrapper around a [`WrappedHandler`] that exposes a method
/// the user's `rmcp::ServerHandler::call_tool` implementation can
/// delegate to.
///
/// ## Usage
///
/// ```ignore
/// // 1. Build your handler and wrap it with the middleware.
/// use openagent_mcp::{Config, InMemoryToolHandler, OpenAgentMiddleware, RmcpOpenAgent, WithOpenAgent};
/// # async fn example(agent: std::sync::Arc<dyn openagent_mcp::Agent>) {
/// let inner = InMemoryToolHandler::new();
/// let middleware = OpenAgentMiddleware::new(Config::new(agent));
/// let wrapped = inner.with_openagent(middleware);
/// let adapter = RmcpOpenAgent::new(wrapped);
///
/// // 2. From your rmcp ServerHandler::call_tool, delegate:
/// // async fn call_tool(&self, params: CallToolRequestParam, ctx: RequestContext<RoleServer>)
/// //     -> Result<CallToolResult, ErrorData>
/// // {
/// //     adapter.dispatch(params, &ctx).await
/// // }
/// # let _ = adapter;
/// # }
/// ```
///
/// The dispatch helper handles the JSON conversion and error mapping
/// so the rmcp glue stays a one-liner.
pub struct RmcpOpenAgent<H>
where
    H: ToolHandler + 'static,
{
    inner: Arc<WrappedHandler<H>>,
}

impl<H: ToolHandler + 'static> std::fmt::Debug for RmcpOpenAgent<H> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RmcpOpenAgent").finish_non_exhaustive()
    }
}

impl<H: ToolHandler + 'static> Clone for RmcpOpenAgent<H> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

impl<H: ToolHandler + 'static> RmcpOpenAgent<H> {
    /// Wrap an [`WrappedHandler`] so it can be plugged into rmcp.
    pub fn new(handler: WrappedHandler<H>) -> Self {
        Self {
            inner: Arc::new(handler),
        }
    }

    /// Translate an rmcp `CallToolRequestParam` into a [`ToolCall`],
    /// run the middleware pipeline, and return a [`ToolResult`] ready
    /// to be converted back into rmcp's `CallToolResult` by the caller.
    ///
    /// We deliberately do not import rmcp's types here — the conversion
    /// to and from those types lives in the user's `ServerHandler`
    /// implementation. That way, when rmcp bumps its API again, only
    /// the user's call site needs to be touched.
    pub async fn dispatch_value(
        &self,
        name: String,
        arguments: serde_json::Value,
        meta: serde_json::Value,
    ) -> Result<ToolResult, McpAuthError> {
        let call = ToolCall {
            name,
            arguments,
            meta,
        };
        self.inner.call_tool(call).await
    }

    /// Borrow the inner wrapped handler. Useful for tests and for
    /// callers that want to invoke `list_tools` directly.
    pub fn handler(&self) -> &Arc<WrappedHandler<H>> {
        &self.inner
    }
}
