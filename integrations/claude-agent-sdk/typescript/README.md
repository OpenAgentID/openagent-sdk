# `@openagentid/claude-agent`

**OAS identity + capability control for Claude agents in 3 lines.**

A drop-in plugin for the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript)
that wires the [OpenAgent SDK](https://openagent.id) into the agent
lifecycle. Your agent gets a verified `did:oas:*` identity, scoped
credential access, and tamper-evident audit logging — without touching
any agent code.

## What you get

- **Verified identity** — every session is bound to an OAS DID
  (`did:oas:<namespace>:<kind>:<id>`) with optional Ed25519 message
  signing.
- **Capability control** — every tool call is checked against the
  agent's Arsenal-issued scopes (`tools:invoke:<name>`).
- **Skills policy** — every SKILLS.md skill invocation is gated by a
  default `deny-unless-scoped` policy (`skills:invoke:<name>`).
- **Tamper-evident audit** — hash-chained records of every tool, skill,
  and message event. Verifiable in O(n) with `verifyChain()`.
- **Zero coupling** — pluggable `CapabilityChecker`, `SkillsPolicy`,
  and `AuditSink` interfaces let you replace any default with your own
  implementation.

## Install

```bash
npm install @openagentid/claude-agent @anthropic-ai/claude-agent-sdk @openagentid/sdk
# or
bun add @openagentid/claude-agent @anthropic-ai/claude-agent-sdk @openagentid/sdk
```

## Three-line usage

```ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import { openAgentPlugin, StaticCapabilityChecker } from '@openagentid/claude-agent';

const result = query({
  prompt: 'Help me refactor this code',
  options: {
    plugins: [
      openAgentPlugin({
        agent,                                                // your OAS identity
        capabilities: new StaticCapabilityChecker(['tools:invoke:*']),
        audit: true,                                          // hash-chained log
      }),
    ],
  },
});
```

That's it. Every tool call, skill invocation, and outbound message is
now identity-bound and auditable.

## Wiring an OAS identity

You can construct an `OpenAgentIdentity` directly, or get one from the
OpenAgent SDK:

```ts
import { OpenAgent } from '@openagentid/sdk';

const agent = await OpenAgent.createAgent({
  namespace: 'acme',
  name: 'refactor-bot',
  parent: humanRoot,                  // links lineage back to a human
});

// `agent` is structurally compatible with the plugin's OpenAgentIdentity.
```

## Skills policy

By default the plugin installs `DenyUnlessScopedSkillsPolicy` — every
SKILLS.md entry must be backed by an `skills:invoke:<name>` scope. To
allow only specific skills:

```ts
import {
  AllowListSkillsPolicy,
  CompositeSkillsPolicy,
  DenyUnlessScopedSkillsPolicy,
  openAgentPlugin,
} from '@openagentid/claude-agent';

openAgentPlugin({
  agent,
  capabilities,
  skillsPolicy: new CompositeSkillsPolicy([
    new AllowListSkillsPolicy(['web.search', 'fs.read']),
    new DenyUnlessScopedSkillsPolicy(),
  ]),
});
```

## Lifecycle hooks

The plugin maps to the Claude Agent SDK lifecycle:

| SDK hook        | Plugin behaviour                                              |
| --------------- | ------------------------------------------------------------- |
| `onSessionStart`| Authenticate the session, bind identity, open audit chain    |
| `preToolUse`    | Verify scope, hash input, emit `tool.preflight` record       |
| `postToolUse`   | Hash output, emit `tool.complete` record                     |
| `onMessage`     | Optionally Ed25519-sign the body, emit `message.signed`      |
| `onSkillInvoke` | Consult `SkillsPolicy`, emit `skill.preflight` record        |
| `onSessionEnd`  | Emit `session.stop` and tear down per-session state          |

## Audit chain

Every event is hash-chained:

```
record_n.prevHash = record_{n-1}.hash
record_n.hash     = blake3(canonical_json(record_n - hash))
```

Verify a chain at any time:

```ts
import { verifyChain } from '@openagentid/claude-agent';
const { valid, brokenAt } = verifyChain(records);
```

The plugin uses BLAKE3 if installed, falling back to SHA-256 from
Node's stdlib so there are zero hard runtime deps.

## Custom audit sink

```ts
import type { AuditSink, AuditRecord } from '@openagentid/claude-agent';

class AkashaSink implements AuditSink {
  async append(record: AuditRecord): Promise<void> {
    await akashaClient.append('agent_audit', record);
  }
}

openAgentPlugin({ agent, capabilities, audit: new AkashaSink() });
```

## Deny modes

```ts
openAgentPlugin({ ..., denyMode: 'throw' });   // ToolDeniedError / SkillDeniedError
openAgentPlugin({ ..., denyMode: 'block' });   // returns { allow: false, reason }
```

## Development

```bash
bun install
bun test
bun run build
```

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT), at your option.
