# Creating an Agent

This guide covers everything you need to mint an agent: picking a parent, choosing scopes, setting an expiration, naming, namespaces, and where to store the resulting ACT. It assumes you have read [core concepts](../getting-started/core-concepts.md).

## The minimal call

```ts
import { OpenAgent } from '@openagentid/sdk';

const agent = await OpenAgent.createAgent({
  parent: 'did:oas:acme:hmr:alice',
  name: 'research-bot',
  scopes: ['openai:chat:invoke'],
});
```

```rust
use openagent_sdk::{OpenAgent, CreateAgentOptions};

let agent = OpenAgent::create_agent(
    CreateAgentOptions::new("did:oas:acme:hmr:alice", "research-bot")
        .scopes(["openai:chat:invoke"])
).await?;
```

That is the happy path. The SDK verifies the parent exists, derives a new keypair under the parent's lineage, signs a lineage proof, requests an ACT from the broker, and returns an `Agent` object. The entire round trip takes 15–40 ms locally.

## Picking a parent

Every agent must have a parent. The parent is either a human (an HMR DID) or another agent. You cannot create a top-level agent with no parent — that would break the lineage rule and leave the agent unanchored.

In practice, your service will hold a handle to some root identity: a human operator's HMR for a dev environment, an on-behalf-of service account for multi-tenant production, or a parent agent that represents "this deployment" in a more complex topology. The parent DID goes into the `parent` field.

If the parent is a human, the call requires proof that the caller is authorized to act on behalf of that human. Usually that means the calling process holds the human's signing key, is holding a delegated ACT that grants `openagent:agent:create`, or is inside an authenticated session (OAuth, SSO, a passkey flow) that the AEGIS verifier recognizes.

If the parent is another agent, the rules are the same but simpler: the calling process must be that agent (hold its key / token). See [delegating-authority.md](delegating-authority.md) for the delegation patterns.

## Choosing scopes

Scopes follow the `service:resource:action` grammar documented in [scope-grammar.md](../reference/scope-grammar.md). Pick the narrowest set that lets the agent do its job. A research bot might need:

```ts
scopes: [
  'openai:chat:invoke',          // call the chat API
  'anthropic:messages:invoke',    // call the messages API
  'tavily:search:invoke',         // use the search tool
  'notion:pages:read',            // read Notion pages
  'notion:pages:write',           // write Notion pages
],
```

A code-review agent might need:

```ts
scopes: [
  'github:pulls:read',
  'github:pulls:comment',
  'openai:chat:invoke',
  '!github:pulls:merge',          // explicit negation: never merge
],
```

The negation is important. Even if a parent grants broad scopes, you can contract them when creating the child. Delegation can only take scopes away, never add them. This is the no-amplification rule.

## Naming and namespaces

The `name` is a human-readable label, not a unique identifier. It shows up in logs and dashboards. Pick something you can recognize six months from now.

The namespace segment in the DID (the `acme` in `did:oas:acme:agent:...`) is usually your organization or tenant. It is set in one of three ways, in order of precedence: explicitly via `namespace` in the create options, implicitly by inheritance from the parent's namespace, or via the `OPENAGENT_NAMESPACE` environment variable. Most deployments inherit.

## Expirations and refresh

ACTs are short-lived by design. The default expiration is 1 hour. You can shorten it (for a one-shot job) or extend it:

```ts
const agent = await OpenAgent.createAgent({
  parent, name, scopes,
  expiresInHours: 24 * 7,   // one week
});
```

An expired ACT can be refreshed without re-running the whole creation ritual — just call `agent.refresh()` and the SDK will request a fresh token from the broker using the stored signing key. If the parent has been revoked, or if an AEGIS policy has flipped, the refresh will fail and you'll need to re-provision.

For very long-lived agents, use a short ACT and a refresh loop. The SDK has `agent.startAutoRefresh(intervalSeconds)` that spawns a background task to keep the token fresh.

## Where to store the ACT

The ACT is a Bearer token. Treat it like one. Don't commit it to git, don't log it at INFO level, don't ship it to a frontend. The normal patterns work: a secret manager, a Kubernetes secret, an env var injected at runtime.

The DID is not sensitive — it's a public identifier. Feel free to log it, expose it in APIs, embed it in URLs. Only the ACT and the agent's private key are sensitive.

If the calling process needs to act as multiple agents (for example, a multi-tenant service acting on behalf of many users), store the DID → ACT mapping in your database and use `OpenAgent.loadAgent(did, { act })` at the start of each request.

## A full provisioning script

```ts
// scripts/provision-agent.ts
import { OpenAgent } from '@openagentid/sdk';
import { writeFileSync } from 'node:fs';

const parent = process.env.PARENT_DID ?? 'did:oas:acme:hmr:alice';
const name   = process.argv[2] ?? 'research-bot';

const agent = await OpenAgent.createAgent({
  parent, name,
  scopes: ['openai:chat:invoke', 'tavily:search:invoke'],
  expiresInHours: 24 * 30,
});

writeFileSync(
  `./secrets/${name}.json`,
  JSON.stringify({ did: agent.did, act: agent.actCompactString }, null, 2),
  { mode: 0o600 },
);

console.log(`minted ${agent.did}`);
```

Run it once, commit the DID to config, feed the ACT via your secret manager. Done.

Next: [authenticating requests](authenticating-requests.md).
