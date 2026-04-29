//! The OpenAgent middleware engine.
//!
//! This module contains the auth pipeline that runs on every tool call:
//!
//!   1. Extract the identity envelope from `call.meta.openagent.identity`.
//!   2. Verify it via the configured `IdentityVerifier`.
//!   3. Enforce the per-tool scopes returned by `require_scopes`.
//!   4. Run the optional skills policy hook.
//!   5. Run the optional pre-call hook.
//!   6. Invoke the inner handler.
//!   7. Stamp audit metadata onto the response.
//!   8. Run the optional post-call hook.
//!   9. On error, run the optional error hook and return the error.
//!
//! Hooks are stored as `Arc<dyn Fn>` so they can be cloned cheaply
//! between requests.

use std::pin::Pin;
use std::sync::Arc;
use std::time::Instant;

use crate::errors::McpAuthError;
use crate::handler::{ToolCall, ToolResult};
use crate::skills::SkillsPolicyDecision;
use crate::types::{
    AuditMeta, Config, ErrorContext, Identity, PostCallContext, PreCallContext, ScopeDeriver,
    VerifiedIdentity,
};

/// Default scope format used when [`Config::with_require_scopes`] is
/// not supplied. Returns `mcp:<tool>:invoke`.
pub fn default_scope_format(tool_name: &str) -> String {
    format!("mcp:{tool_name}:invoke")
}

/// Default scope deriver used when [`Config::with_require_scopes`] is
/// not supplied.
pub fn default_require_scopes(tool_name: &str, _args: &serde_json::Value) -> Vec<String> {
    vec![default_scope_format(tool_name)]
}

/// The middleware engine.
///
/// Cheap to clone — internally just an `Arc` over the config and a
/// derived scope deriver.
#[derive(Clone)]
pub struct OpenAgentMiddleware {
    config: Arc<Config>,
    scope_deriver: ScopeDeriver,
}

impl std::fmt::Debug for OpenAgentMiddleware {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OpenAgentMiddleware")
            .field("config", &self.config)
            .finish()
    }
}

impl OpenAgentMiddleware {
    /// Create a new middleware engine.
    pub fn new(config: Config) -> Self {
        let scope_deriver = config.require_scopes.clone().unwrap_or_else(|| {
            Arc::new(|tool_name: &str, args: &serde_json::Value| {
                default_require_scopes(tool_name, args)
            })
        });
        Self {
            config: Arc::new(config),
            scope_deriver,
        }
    }

    /// Run the middleware pipeline against a single call. The
    /// `inner` closure is invoked once the auth pipeline approves the
    /// call. It receives the (unmodified) `ToolCall`.
    ///
    /// This is the function adapters call from inside their concrete
    /// `call_tool` implementations. Most users do not call it
    /// directly — they wrap their handler with
    /// [`crate::WithOpenAgent::with_openagent`] instead.
    pub async fn run<F>(&self, call: ToolCall, inner: F) -> Result<ToolResult, McpAuthError>
    where
        F: FnOnce(
                ToolCall,
            )
                -> Pin<Box<dyn std::future::Future<Output = Result<ToolResult, McpAuthError>> + Send>>
            + Send
            + 'static,
    {
        let started_at = Instant::now();
        let tool_name = call.name.clone();
        let args = call.arguments.clone();

        let identity = match self.run_auth_pipeline(&tool_name, &args, &call.meta).await {
            Ok(id) => id,
            Err(err) => {
                self.run_error_hook(&tool_name, &args, None, &err).await;
                return Err(err);
            }
        };

        if let Some(pre_call) = &self.config.pre_call {
            let context = PreCallContext {
                tool_name: &tool_name,
                args: &args,
                identity: &identity,
            };
            (pre_call)(&context).await;
        }

        let result = match inner(call).await {
            Ok(result) => result,
            Err(err) => {
                self.run_error_hook(&tool_name, &args, Some(&identity), &err).await;
                return Err(err);
            }
        };

        let stamped = stamp_audit_meta(result, &identity);
        let duration_ms = started_at.elapsed().as_millis();

        if let Some(post_call) = &self.config.post_call {
            let stamped_value =
                serde_json::to_value(&stamped).unwrap_or(serde_json::Value::Null);
            let context = PostCallContext {
                tool_name: &tool_name,
                args: &args,
                identity: &identity,
                duration_ms,
                result: &stamped_value,
            };
            (post_call)(&context).await;
        }

        Ok(stamped)
    }

    async fn run_auth_pipeline(
        &self,
        tool_name: &str,
        args: &serde_json::Value,
        meta: &serde_json::Value,
    ) -> Result<VerifiedIdentity, McpAuthError> {
        let identity = extract_identity(meta);
        let identity = match identity {
            Some(id) => id,
            None => {
                if self.config.require_identity {
                    return Err(McpAuthError::MissingIdentity {
                        tool: tool_name.to_owned(),
                    });
                }
                return Ok(anonymous_identity());
            }
        };

        let required_scopes = (self.scope_deriver)(tool_name, args);
        let verifier = self.config.agent.verifier();
        let verified = verifier
            .verify(&identity, &required_scopes)
            .await
            .map_err(|err| {
                if let McpAuthError::VerificationFailed { .. }
                | McpAuthError::AuthorizationDenied { .. } = err
                {
                    err
                } else {
                    McpAuthError::VerificationFailed {
                        tool: tool_name.to_owned(),
                        reason: err.to_string(),
                    }
                }
            })?;

        enforce_scopes(tool_name, &required_scopes, &verified.scopes)?;

        if let Some(policy) = &self.config.skills_policy {
            let decision: SkillsPolicyDecision = policy.decide(tool_name, args, &verified).await;
            if !decision.allow {
                return Err(McpAuthError::SkillsPolicyDenied {
                    tool: tool_name.to_owned(),
                    reason: decision.reason,
                });
            }
        }

        Ok(verified)
    }

    async fn run_error_hook(
        &self,
        tool_name: &str,
        args: &serde_json::Value,
        identity: Option<&VerifiedIdentity>,
        error: &McpAuthError,
    ) {
        if let Some(hook) = &self.config.on_error {
            let context = ErrorContext {
                tool_name,
                args,
                identity,
                error,
            };
            (hook)(&context).await;
        }
    }
}

fn enforce_scopes(
    tool_name: &str,
    required: &[String],
    held: &[String],
) -> Result<(), McpAuthError> {
    let missing: Vec<&String> = required.iter().filter(|r| !held.contains(r)).collect();
    if !missing.is_empty() {
        return Err(McpAuthError::AuthorizationDenied {
            tool: tool_name.to_owned(),
            required: required.join(", "),
            held: held.join(", "),
        });
    }
    Ok(())
}

fn extract_identity(meta: &serde_json::Value) -> Option<Identity> {
    let openagent = meta.get("openagent")?;
    let identity = openagent.get("identity")?;
    serde_json::from_value(identity.clone()).ok()
}

fn anonymous_identity() -> VerifiedIdentity {
    VerifiedIdentity {
        did: "did:oas:anonymous".to_owned(),
        scopes: Vec::new(),
        audit_id: "anonymous".to_owned(),
        claims: serde_json::Value::Null,
    }
}

fn stamp_audit_meta(mut result: ToolResult, identity: &VerifiedIdentity) -> ToolResult {
    let audit_meta = AuditMeta {
        audit_id: identity.audit_id.clone(),
        verified_did: identity.did.clone(),
        scopes: identity.scopes.clone(),
    };
    let mut meta_obj = match result.meta.take() {
        serde_json::Value::Object(map) => map,
        _ => serde_json::Map::new(),
    };
    let audit_value =
        serde_json::to_value(&audit_meta).unwrap_or(serde_json::Value::Null);
    meta_obj.insert("openagent".to_owned(), audit_value);
    result.meta = serde_json::Value::Object(meta_obj);
    result
}
