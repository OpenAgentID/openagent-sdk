//! Handler trait + adapters that the middleware wraps.
//!
//! The middleware is generic over a small [`ToolHandler`] trait so it
//! can wrap:
//!
//!   * The upstream `rmcp::ServerHandler` (via the optional `rmcp`
//!     adapter behind the `rmcp` feature flag),
//!   * Any custom MCP server runtime an application has built,
//!   * The [`InMemoryToolHandler`] used by the test suite.
//!
//! All any concrete handler needs to do is implement
//! [`ToolHandler::call_tool`] and return the available tool names from
//! [`ToolHandler::list_tools`]. The auth pipeline is handled here, in
//! [`crate::OpenAgentMiddleware`].

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::errors::McpAuthError;
use crate::middleware::OpenAgentMiddleware;

/// A single inbound `tools/call` request.
///
/// `meta` carries the request metadata pulled from the MCP envelope —
/// in particular `meta["openagent"]["identity"]` is where the auth
/// envelope lives. The middleware reads it and never modifies it in
/// place.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    /// The tool name (e.g., `"search_web"`).
    pub name: String,
    /// JSON arguments the caller supplied.
    #[serde(default)]
    pub arguments: serde_json::Value,
    /// Request metadata. Identity envelope lives at
    /// `meta["openagent"]["identity"]`.
    #[serde(default)]
    pub meta: serde_json::Value,
}

/// A single outbound tool result. The middleware stamps audit metadata
/// onto `meta` after the handler returns.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    /// MCP content blocks (text, image, resource_link, etc).
    #[serde(default)]
    pub content: serde_json::Value,
    /// Optional structured content (the new MCP 2025 field).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structured_content: Option<serde_json::Value>,
    /// Optional `isError` flag for error responses returned via the
    /// happy-path channel.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
    /// Result metadata. Audit metadata is stamped here on success.
    #[serde(default)]
    pub meta: serde_json::Value,
}

impl ToolResult {
    /// Build a simple text result with no metadata.
    pub fn text(message: impl Into<String>) -> Self {
        Self {
            content: serde_json::json!([{ "type": "text", "text": message.into() }]),
            structured_content: None,
            is_error: None,
            meta: serde_json::Value::Object(serde_json::Map::new()),
        }
    }
}

/// Description of a registered tool, returned by
/// [`ToolHandler::list_tools`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisteredTool {
    /// Tool name.
    pub name: String,
    /// Optional description for clients.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// The trait every concrete server handler implements. Two methods —
/// `list_tools` and `call_tool` — keep the surface narrow and stable
/// across MCP SDK versions.
#[async_trait]
pub trait ToolHandler: Send + Sync {
    /// Return the tools this handler exposes.
    async fn list_tools(&self) -> Vec<RegisteredTool>;

    /// Execute a single tool call. Implementations should NOT do any
    /// authentication or authorization — that runs in the middleware
    /// before this is invoked.
    async fn call_tool(&self, call: ToolCall) -> Result<ToolResult, McpAuthError>;
}

/// Marker trait — anything that implements [`ToolHandler`] can be
/// wrapped via [`WithOpenAgent::with_openagent`].
pub trait WithOpenAgent: ToolHandler + Sized {
    /// Wrap this handler with the OpenAgent middleware.
    ///
    /// ```no_run
    /// use openagent_mcp::{Config, InMemoryToolHandler, OpenAgentMiddleware, WithOpenAgent};
    /// # use std::sync::Arc;
    /// # async fn example(agent: std::sync::Arc<dyn openagent_mcp::Agent>) {
    /// let handler = InMemoryToolHandler::new();
    /// let middleware = OpenAgentMiddleware::new(Config::new(agent));
    /// let authed = handler.with_openagent(middleware);
    /// # let _ = authed;
    /// # }
    /// ```
    fn with_openagent(self, middleware: OpenAgentMiddleware) -> WrappedHandler<Self> {
        WrappedHandler {
            inner: Arc::new(self),
            middleware,
        }
    }
}

impl<T: ToolHandler + Sized> WithOpenAgent for T {}

/// Result of wrapping a [`ToolHandler`] with [`OpenAgentMiddleware`].
///
/// `WrappedHandler` itself implements [`ToolHandler`], so the wrapped
/// instance is a drop-in replacement for the original — the rest of
/// your server code keeps working unchanged.
pub struct WrappedHandler<T: ToolHandler + ?Sized> {
    pub(crate) inner: Arc<T>,
    pub(crate) middleware: OpenAgentMiddleware,
}

impl<T: ToolHandler + ?Sized> std::fmt::Debug for WrappedHandler<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WrappedHandler")
            .field("middleware", &self.middleware)
            .finish_non_exhaustive()
    }
}

impl<T: ToolHandler + ?Sized> Clone for WrappedHandler<T> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
            middleware: self.middleware.clone(),
        }
    }
}

#[async_trait]
impl<T: ToolHandler + ?Sized + 'static> ToolHandler for WrappedHandler<T> {
    async fn list_tools(&self) -> Vec<RegisteredTool> {
        self.inner.list_tools().await
    }

    async fn call_tool(&self, call: ToolCall) -> Result<ToolResult, McpAuthError> {
        let inner = Arc::clone(&self.inner);
        self.middleware
            .run(call, move |inner_call| {
                let inner = Arc::clone(&inner);
                Box::pin(async move { inner.call_tool(inner_call).await })
            })
            .await
    }
}

/// In-memory test handler. Useful for unit and integration tests of
/// the middleware (and as a tiny example of what a custom handler
/// looks like).
#[derive(Default)]
pub struct InMemoryToolHandler {
    tools: Mutex<HashMap<String, ToolEntry>>,
}

impl std::fmt::Debug for InMemoryToolHandler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("InMemoryToolHandler").finish_non_exhaustive()
    }
}

type ToolHandlerFn = Arc<
    dyn Fn(
            serde_json::Value,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<ToolResult, McpAuthError>> + Send>,
        > + Send
        + Sync,
>;

struct ToolEntry {
    description: Option<String>,
    handler: ToolHandlerFn,
}

impl InMemoryToolHandler {
    /// Create an empty handler.
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a tool. The handler closure receives the deserialized
    /// arguments and returns a [`ToolResult`].
    pub async fn register<F, Fut>(
        &self,
        name: impl Into<String>,
        description: Option<&str>,
        handler: F,
    ) where
        F: Fn(serde_json::Value) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = Result<ToolResult, McpAuthError>> + Send + 'static,
    {
        let mut tools = self.tools.lock().await;
        let handler: ToolHandlerFn = Arc::new(move |args| Box::pin(handler(args)));
        tools.insert(
            name.into(),
            ToolEntry {
                description: description.map(str::to_owned),
                handler,
            },
        );
    }
}

#[async_trait]
impl ToolHandler for InMemoryToolHandler {
    async fn list_tools(&self) -> Vec<RegisteredTool> {
        let tools = self.tools.lock().await;
        tools
            .iter()
            .map(|(name, entry)| RegisteredTool {
                name: name.clone(),
                description: entry.description.clone(),
            })
            .collect()
    }

    async fn call_tool(&self, call: ToolCall) -> Result<ToolResult, McpAuthError> {
        let entry_handler = {
            let tools = self.tools.lock().await;
            let Some(entry) = tools.get(&call.name) else {
                return Err(McpAuthError::ToolFailed {
                    tool: call.name.clone(),
                    source: format!("tool '{}' is not registered", call.name).into(),
                });
            };
            entry.handler.clone()
        };
        entry_handler(call.arguments).await
    }
}
