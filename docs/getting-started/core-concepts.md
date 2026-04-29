# Core Concepts

OpenAgent is built on four ideas: **DIDs**, **lineage**, **capabilities**, and **skills**. You can ship real code without understanding the cryptography behind any of them, but a single read of this page will save you hours of debugging later.

## DIDs (Decentralized Identifiers)

Every participant in an OpenAgent system — a human, an agent, a tool, a model, a service — has a DID. It looks like this:

```
did:oas:acme:agent:8hT3k4Pq2mXrY9vWbCdEfGh1JkLmNo
```

Read left to right: the `did:oas` prefix says this is an Open Agent Specification identifier. `acme` is the **namespace** (usually your organization or tenant). `agent` is the **entity kind** — one of 11 kinds including `hmr` (human machine root), `agent`, `tool`, `skill`, `model`, `dataset`, `service`, and `agent:instance`. The trailing string is a **fingerprint** derived from the entity's public key.

A DID is a public identifier. You can put one in a log line, a JWT, a URL. It does not contain any secrets. Every DID corresponds to an Ed25519 keypair; the private half lives wherever you put it (hardware token, secret manager, filesystem, the Arsenal broker), and the public half is derivable from the DID itself.

DIDs are offline-verifiable, meaning that given a DID and a signature, you can verify the signature without contacting any server — no OAuth introspection endpoint, no network round trip. That property is what makes OpenAgent workable at edge scale.

## Lineage

Every agent traces back to a human. This is the lineage model, and it is the most important concept in OpenAgent.

When a human onboards to OpenAgent, they receive an HMR (Human Machine Root) DID. When the human spawns their first agent, that agent's DID is minted under the HMR — the agent's public key is derived via HKDF from the human's key material, and a **lineage proof** is signed binding the child to the parent. If that first agent spawns a child of its own, the same thing happens: HKDF-derived key, signed lineage proof.

The result is a tree. Every agent has a chain of lineage proofs going back to a human root. Given any agent DID, you can cryptographically verify its entire ancestry — who spawned whom, in what order, and with the consent of each parent along the way. The chain is offline-verifiable.

Why does this matter? It means there is always a human accountable for any autonomous action. It means an agent cannot spoof its ancestry. It means revoking a parent revokes every descendant. It means your audit log is not just "this agent did X" but "this agent, descended from this human, did X."

OpenAgent enforces a **no-amplification rule**: a child agent can never hold scopes that its parent did not. Delegation strictly contracts the scope; it cannot expand it. See [delegating-authority.md](../guides/delegating-authority.md).

## Capabilities (Arsenal ACTs)

A DID answers "who are you." A capability token answers "what are you allowed to do." OpenAgent uses **Arsenal Capability Tokens** (ACTs) for this: short-lived, scoped tokens issued by the Arsenal broker and bound to a DID.

An ACT carries:

- The DID it was minted for.
- A list of **scopes** in `service:resource:action` form (e.g. `openai:chat:invoke`, `github:repo:read`, `postgres:db:readwrite`).
- An expiration timestamp.
- A set of policy references (what AEGIS policies apply).
- A signature from the broker.

When an agent makes an API call via `credentialsFor`, the SDK hands the ACT to the Arsenal broker, the broker verifies the token, checks that the scope permits the requested call, attaches the real provider credential, proxies upstream, and returns the response. The credential never enters the agent process — which means an agent can be completely compromised without the provider credential leaking.

The scope grammar is documented in detail in [scope-grammar.md](../reference/scope-grammar.md). Scopes are hierarchical (`github:repo:read` is weaker than `github:repo:*`, which is weaker than `github:*:*`) and negations are supported (`!github:repo:delete` subtracts a scope).

## Skills

An agent's capabilities say "you can call OpenAI." Its skills say "you know how to research a topic, draft a report, and submit a pull request." Skills are higher-level abilities declared in a `SKILLS.md` file that lives alongside the agent code. Each skill has a name, a description, and a policy clause saying when it can be invoked.

OpenAgent ships with a skills governance layer that reads `SKILLS.md`, compiles the policies, and exposes a single function: `agent.skillsPolicy().canInvoke(name, context)`. Your agent runtime (Claude Agent SDK, a custom loop, an MCP server) calls that function before invoking any skill. If it returns `false`, the skill is denied, the denial is logged to the audit trail, and your code gets a structured reason.

Skills governance lets you say things like "this agent can invoke the `web-search` skill freely, but `delete-file` requires an active human approval token issued in the last 60 seconds." It is where human-in-the-loop approvals, rate limits, and cost ceilings live. See [skills-governance.md](../guides/skills-governance.md) for the full policy grammar.

## Putting it together

When a request arrives at your service:

1. **Authenticate** — verify the DID and the ACT, producing a `Context`.
2. **Authorize** — check that the context's scopes cover the operation you're about to perform.
3. **Act** — load the agent, call `credentialsFor` to get a fetch proxy, make the upstream call.
4. **Govern** — before invoking any named skill, ask the skills policy.
5. **Audit** — every step above writes a hash-chained entry to the audit log that can be replayed and verified offline.

The SDK handles all five steps for you. You write application code. That is the entire promise of OpenAgent.

Next: read the [creating an agent](../guides/creating-an-agent.md) guide.
