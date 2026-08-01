# openagent-sdk

> **Clerk for autonomous agents.** One import. One identity. One credential proxy.
> One verification pipeline. Zero glue code.

The OpenAgent SDK is the developer-facing facade for the L1fe agent stack. It
wraps three layers under a single Rust crate so app developers don't have to
learn three vocabularies:

- **OAS** (`oas-sdk`) — `did:oas` identity and the upstream Sigil-backed lineage verifier contract.
- **Arsenal** (`arsenal-sdk`) — Agent Capability Tokens and the credential proxy
  that lets agents call APIs without ever seeing raw secrets.
- **AEGIS** (`aegis-sdk`) — verification, authentication, policy, and delegation.

If you've used Clerk for web auth or Auth0 for OIDC, this is the same idea for
autonomous agents.

## Agent auth in three lines

```rust
use openagent_sdk::{OpenAgent, CreateAgentOptions};

let agent = OpenAgent::create_agent(CreateAgentOptions {
    name: "my-bot",
    scopes: &["openai:chat:completions", "github:repo:read"],
    ..Default::default()
}).await?;

println!("agent did: {}", agent.did());
```

That's it. The agent now has a signed OAS identity document, a default skill
policy, and is ready to receive credentials once its privileged authority path
is verified through OAS with Sigil GAL backing.

## What you get

| Capability | Method | Wraps |
|------------|--------|-------|
| Mint or derive an agent identity | `OpenAgent::create_agent` | `oas-sdk` |
| Verify an inbound DID and lineage authority | `Verifier::verify` / `authenticate_with_verifier` | `oas-sdk` + `aegis-sdk` |
| Fetch credentials through a proxy | `agent.credentials_for("openai").await?.post(...)` | `arsenal-sdk` |
| Check whether a skill is allowed | `agent.check_skill("frontend-design")` | `openagent-skills-policy` (stub) |

## Wiring an Arsenal broker

The default `create_agent` path is offline-friendly: it mints identities but
does not connect to a credential broker. For production, use the builder:

```rust
use openagent_sdk::{OpenAgentBuilder, CreateAgentOptions};
use arsenal_sdk::{ArsenalClient, AgentIdentityLoader};
use arsenal_core::identity::TenantId;

let identity = AgentIdentityLoader::generate(TenantId::generate(), "ops")?;
let arsenal = ArsenalClient::builder()
    .identity(identity)
    .broker_url("https://broker.l1fe.ai")
    .broker_mtls("/etc/l1fe/agent.crt", "/etc/l1fe/agent.key")
    .build()?;

let agent = OpenAgentBuilder::new()
    .with_arsenal_client(arsenal)
    .build(CreateAgentOptions {
        name: "ops-bot",
        scopes: &["openai:chat:completions"],
        ..Default::default()
    })
    .await?;

let creds = agent.credentials_for("openai").await?;
let response = creds.post(
    "https://api.openai.com/v1/chat/completions",
    Default::default(),
    serde_json::to_vec(&payload)?,
).await?;
```

The proxy will resolve `{{OAUTH2_OPENAI_TOKEN}}` (or whatever variable is bound
to the agent's capability) server-side. The agent never sees the raw key.

## Wiring an AEGIS verifier

AEGIS should consume the OAS verification result. It may add policy,
authentication, wallet, and delegation checks, but it should not maintain a
separate lineage definition.

```rust
use std::sync::Arc;
use openagent_sdk::OpenAgentBuilder;
use aegis_core::PluginRegistry;

let registry = Arc::new(PluginRegistry::new());
// ... register DID resolvers, auth providers, policy engines on the registry ...

let agent = OpenAgentBuilder::new()
    .with_aegis_registry(registry)
    .build(opts)
    .await?;

let verifier = agent.verifier().expect("just attached");
let ctx = verifier.verify("did:oas:l1fe:agent:other").await?;
assert!(ctx.is_valid());
```

## Skills policy

`openagent-sdk` ships a stub `SkillsPolicy` trait and a default
`AllowListPolicy`. Once `openagent-skills-policy` lands, the SDK will depend on
it directly and the public surface (`can_invoke`, `allowed_skills`,
`SkillsPolicyHandle`) will stay the same.

```rust
use openagent_sdk::{AllowListPolicy};

let agent = agent.with_skills_policy(
    AllowListPolicy::with_skills(["frontend-design", "code-review"])
);
agent.check_skill("frontend-design")?;  // Ok
agent.check_skill("rocket-science")?;   // SkillDenied
```

## Sync shim for CLI tools

```rust
let agent = openagent_sdk::sync::create_agent(CreateAgentOptions {
    name: "cli-bot",
    ..Default::default()
})?;
```

## Cargo features

| Feature | Default | Effect |
|---------|---------|--------|
| `aegis` | off | Reserved — full AEGIS pipeline always enabled today |
| `arsenal` | off | Reserved — Arsenal client is always linked today |
| `full` | off | Convenience meta-feature |

The features exist so the SDK can shrink in a future release; today the wrapped
crates are always linked.

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](../../LICENSE-APACHE) or [MIT license](../../LICENSE-MIT), at your option.
