# openagent-skills-policy

**Governance for agent skills.**

Agents in the L1fe ecosystem discover specialized capabilities through
`SKILLS.md` files and the Claude Code `Skill` tool. Today, that discovery
surface has no gate: any agent can invoke any skill it finds, with no rate
limiting, no argument validation, and no audit trail.

`openagent-skills-policy` closes that gap.

## Positioning

This package is **not** a new primitive. It is a specialized
[Arsenal](../../../arsenal) policy — the same scope grammar, the same
audit shape, the same rate-limit surface — applied to the narrow
problem of "which of the skills declared in this `SKILLS.md` is this
agent allowed to invoke right now?"

```
openagent-skills-policy
        │
        ├──► SKILLS.md parser     (discover the skill surface)
        ├──► YAML policy loader   (author rules against that surface)
        └──► Policy engine        (runtime enforcement + audit)
                │
                ├──► arsenal-core::scope    (resource grammar)
                ├──► arsenal-core::limits   (rate-limit surface)
                └──► arsenal-core::audit    (receipt shape)
```

## What it gates

Every policy dimension is optional and per-skill:

| Dimension         | What it gates                                             |
|-------------------|-----------------------------------------------------------|
| `allow` / `deny`  | Whether the skill can be invoked at all.                  |
| `rate_limit`      | Max invocations per sliding window (GCRA algorithm).      |
| `arg_constraints` | JSON Schema applied to the skill's invocation arguments.  |
| `time_windows`    | Hours (UTC) and weekdays during which invocation is ok.   |
| `require_consent` | HITL approval must accompany the invocation.              |
| `audit_level`     | `none` / `hash` / `full` — how much lands in the chain.   |

A top-level `default` rule catches every skill that has no explicit entry.
The recommended starting point is `default.allow: false` (deny unknown
skills) and an opt-in allow list.

## Policy format

```yaml
version: 1
agent: did:oas:l1fe:agent:my-bot
description: Policy for a frontend-focused design agent
skills:
  frontend-design:
    allow: true
    rate_limit:
      window: 1h
      max: 10
    arg_constraints:
      type: object
      required: [component]
      properties:
        component:
          type: string
    audit_level: hash
  deploy-production:
    allow: true
    require_consent: true
    audit_level: full
  rm-rf:
    allow: false
default:
  allow: false
```

The YAML is validated at load time — any authoring mistake (unknown
version, bad rate-limit window, malformed JSON Schema, out-of-range hours)
raises an error before the engine ever serves a request.

## Rust

```rust
use openagent_skills_policy::{Did, InvocationContext, SkillsPolicy};
use serde_json::json;

let yaml = include_str!("policy.yaml");
let mut policy = SkillsPolicy::from_yaml(yaml)?;

let ctx = InvocationContext::new(
    Did::new("did:oas:l1fe:agent:my-bot")?,
    "session-42",
    json!({ "component": "Button" }),
);

// Read-only authorization check.
policy.can_invoke("frontend-design", &ctx)?;

// Authorize, advance rate limit, append to audit chain.
let receipt = policy.record_invocation("frontend-design", &ctx)?;
println!("receipt #{} => {}", receipt.sequence, receipt.receipt_hash);

assert!(policy.audit_chain().verify());
```

See [`rust/`](./rust/) for the full crate. Tests: `cargo test`.

## TypeScript

```ts
import { Did, InvocationContext, SkillsPolicy } from "@openagent/skills-policy";

const policy = SkillsPolicy.fromYaml(yaml);

const ctx = new InvocationContext({
  agentDid: Did.parse("did:oas:l1fe:agent:my-bot"),
  sessionId: "session-42",
  arguments: { component: "Button" },
});

policy.canInvoke("frontend-design", ctx);
const receipt = policy.recordInvocation("frontend-design", ctx);
```

See [`typescript/`](./typescript/) for the full package. Tests: `npm test`
or `bun test`.

The Rust and TypeScript implementations are 1:1 in behavior: they parse
the same YAML, use the same GCRA rate-limit algorithm, and produce
hash-chained audit receipts that verify under either language. The
canonical serialization of receipts is identical so that a receipt
written by the TS package can be verified by the Rust crate and vice
versa.

## Discovering the skill surface

Both languages ship a `SKILLS.md` parser so policies can be authored
against the actual file:

```rust
// Rust
let manifest = SkillsManifest::from_file(Path::new("SKILLS.md"))?;
for name in manifest.names() {
    println!("discovered skill: {name}");
}
```

```ts
// TypeScript
const manifest = await SkillsManifest.fromFile("SKILLS.md");
for (const name of manifest.names()) {
    console.log("discovered skill:", name);
}
```

## Audit receipts

Every recorded invocation produces a `Receipt` that extends a BLAKE3 hash
chain. Tampering with any past receipt invalidates every subsequent hash.
Receipts are immutable — `record_invocation` always creates a new one
rather than mutating existing state.

`audit_level` controls how much of the invocation is captured:

- `none` — no receipt appended to the chain (sentinel returned).
- `hash` — receipt contains skill, DID, session, timestamp, and a hash of
  the arguments (safe default — does not leak argument content).
- `full` — receipt includes the full arguments JSON (use for
  high-sensitivity skills where forensics must reconstruct the payload).

## Integration

The top-level `@openagent/sdk` package and `openagent-sdk` Rust crate
consume this package and expose it as `agent.skillsPolicy()` — the
MCP integration and Claude Agent SDK integration consult it before
allowing any skill invocation.

## License

Apache-2.0 OR MIT.
