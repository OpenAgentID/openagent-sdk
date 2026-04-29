# `openagent-claude-agent`

**OAS identity + capability control for Rust agent harnesses, in 3 lines.**

A framework-agnostic Rust crate that wires OpenAgent identity, capability
control, and tamper-evident audit logging into the lifecycle of any Rust
agent harness.

## Status

Anthropic does **not** currently ship an official Rust Claude Agent SDK
— the reference integration lives in the TypeScript package
[`@openagent/claude-agent`](../typescript). This crate is the **Rust
analog**: a small trait surface plus drop-in policy / audit primitives
that any Rust agent harness can implement.

If you're using the TypeScript Claude Agent SDK, install the npm
package. If you're building a Rust agent harness (Forge, Aut0, a custom
runtime), use this crate.

## What you get

- **`OpenAgentIdentity` trait** — DID + signing key abstraction with a
  default deterministic in-process implementation for tests
- **`CapabilityChecker` trait** — Arsenal-backed scope checks
  (`tools:invoke:<name>`, `skills:invoke:<name>`)
- **`SkillsPolicy` trait** — gates SKILLS.md skill invocations,
  defaults to `DenyUnlessScopedSkillsPolicy`
- **`OpenAgentHooks` trait** — the lifecycle contract any harness can
  implement to receive enforcement
- **`OpenAgentPlugin` struct** — composition root that ties everything
  together and emits a hash-chained audit log
- **Hash-chained audit** with `verify_chain()` — BLAKE3 over canonical
  JSON, tamper-evident

## Quick start

```rust
use std::sync::Arc;
use openagent_claude_agent::{
    audit::InMemoryAuditSink,
    identity::{Identity, OpenAgentIdentity},
    plugin::{DenyMode, OpenAgentPlugin, PluginConfig},
    policy::{StaticCapabilityChecker, DenyUnlessScopedSkillsPolicy},
};

#[tokio::main]
async fn main() -> Result<(), openagent_claude_agent::Error> {
    let identity: Arc<dyn OpenAgentIdentity> = Arc::new(Identity::new(
        "did:oas:acme:agent:refactor-bot",
        "agent",
        [0u8; 32],
    ));
    let plugin = OpenAgentPlugin::new(PluginConfig {
        identity,
        capabilities: Arc::new(StaticCapabilityChecker::new([
            "tools:invoke:bash",
            "skills:invoke:web.*",
        ])),
        skills_policy: Arc::new(DenyUnlessScopedSkillsPolicy),
        sink: Arc::new(InMemoryAuditSink::new()),
        sign_messages: false,
        deny_mode: DenyMode::Throw,
    });

    plugin.session_start("session-001").await?;
    plugin.pre_tool_use("bash", &serde_json::json!({"cmd": "ls"})).await?;
    plugin.post_tool_use("bash", &serde_json::json!("a\nb"), true, None).await?;
    plugin.session_end().await?;
    Ok(())
}
```

### Production wiring with `openagent-sdk`

```rust,ignore
use std::sync::Arc;
use openagent_sdk::{OpenAgent, CreateAgentOptions};
use openagent_claude_agent::{
    audit::InMemoryAuditSink,
    identity::{OpenAgentIdentity, OpenAgentSdkIdentity},
    plugin::{DenyMode, OpenAgentPlugin, PluginConfig},
    policy::{StaticCapabilityChecker, OpenAgentSdkSkillsPolicy},
};

let agent = OpenAgent::create_agent(CreateAgentOptions {
    name: "refactor-bot",
    scopes: &["openai:chat:completions"],
    ..Default::default()
}).await?;

// Bridge the SDK identity + skills policy into the plugin.
let identity: Arc<dyn OpenAgentIdentity> = Arc::new(OpenAgentSdkIdentity::new(agent.clone()));
let skills = Arc::new(OpenAgentSdkSkillsPolicy::new(agent.skills_policy()));

let plugin = OpenAgentPlugin::new(PluginConfig {
    identity,
    capabilities: Arc::new(StaticCapabilityChecker::new(["tools:invoke:*"])),
    skills_policy: skills,
    sink: Arc::new(InMemoryAuditSink::new()),
    sign_messages: true,
    deny_mode: DenyMode::Throw,
});
```

## Wiring into a Rust harness

The harness owns the Claude (or other model) lifecycle. At the
appropriate points it forwards events to the plugin:

```rust
use openagent_claude_agent::OpenAgentHooks;

async fn agent_loop(plugin: &impl OpenAgentHooks) -> Result<(), Box<dyn std::error::Error>> {
    plugin.on_session_start("sess").await?;

    // Before every tool call:
    plugin.pre_tool_use("bash", &serde_json::json!({"cmd": "pwd"})).await?;
    let result = run_tool("bash", "pwd").await?;
    plugin.post_tool_use("bash", &serde_json::json!(result), true, None).await?;

    // Before every SKILLS.md skill:
    plugin.on_skill_invoke("web.search", None).await?;

    // For every outbound message:
    plugin.on_message(b"hello", true).await?;

    plugin.on_session_end().await?;
    Ok(())
}
# async fn run_tool(_t: &str, _a: &str) -> Result<String, std::io::Error> { Ok("ok".into()) }
```

## Skills policy

The default `DenyUnlessScopedSkillsPolicy` requires the agent to hold
`skills:invoke:<name>` for every SKILLS.md entry it tries to invoke.
Compose with allow-lists for stricter control:

```rust
use std::sync::Arc;
use openagent_claude_agent::policy::{
    AllowListSkillsPolicy, CompositeSkillsPolicy, DenyUnlessScopedSkillsPolicy, SkillsPolicy,
};

let policy: Arc<dyn SkillsPolicy> = Arc::new(CompositeSkillsPolicy::new(vec![
    Arc::new(AllowListSkillsPolicy::new(["web.search", "fs.read"], None)),
    Arc::new(DenyUnlessScopedSkillsPolicy),
]));
```

## Audit chain

Records are hash-chained with BLAKE3 over canonical JSON. Verify a chain
in O(n):

```rust
use openagent_claude_agent::audit::verify_chain;

let records = sink.snapshot();
verify_chain(&records)?; // Err(AuditBroken { index }) on tamper
```

## Adapter seam

If a future Claude Agent SDK for Rust ships, the integration is a thin
shim that forwards SDK lifecycle events to `OpenAgentHooks` — no other
code in this crate needs to change. See the inline comments in
`hooks.rs` and `plugin.rs` for the seams.

## Optional features

- `skills-policy` — enables a path-dep on the `openagent-skills-policy`
  reference crate. Off by default so the integration builds in
  isolation.

## License

Apache-2.0 OR MIT
