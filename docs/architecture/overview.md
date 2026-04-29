# Architecture Overview

OpenAgent is a facade. The real work is done by three standards — OAS, Arsenal, and AEGIS — with Sigil GAL providing finality for privileged lineage. The facade's job is to make them feel like one thing from a developer's perspective, without hiding the underlying layers from anyone who needs to reach past the facade for advanced use.

This page explains the three layers, what each one owns, what the facade adds, and why the architecture is shaped this way.

## The three layers

```
+---------------------------------------------------+
|           OpenAgent SDK  (the facade)             |
|   createAgent  authenticate  credentialsFor  ...  |
+---------------------------------------------------+
|   OAS   ||   Arsenal   ||   AEGIS                 |
| (identity + lineage) (caps/proxy) (verify/policy) |
+---------------------------------------------------+
|          Sigil GAL finality + WASM crypto core     |
|           Ed25519 / HKDF / BLAKE3 / FROST          |
+---------------------------------------------------+
```

Each layer has its own crate / package and its own release track. The facade depends on all three but exposes a unified interface. You can, in principle, use OAS or Arsenal or AEGIS on its own — they're vendor-neutral standards with their own SDKs — but the facade is what most developers should import.

## OAS — Open Agent Specification

OAS is the identity standard. It defines:

- The DID method `did:oas` (see [wire-formats.md](../reference/wire-formats.md)).
- 11 entity kinds: `hmr`, `mhr`, `enr`, `agent`, `tool`, `skill`, `workflow`, `model`, `dataset`, `service`, `agent:instance`.
- The lineage verifier contract consumed by OpenAgent, Forge, Kin, Aut0, Arsenal, AEGIS, OATS, MARS, and OpenAgentID.
- Ed25519 signing, deterministic key derivation, and local proof verification.
- Portable verification for DID documents and signatures without contacting a server.
- Sigil GAL-backed authority verification for privileged lineage paths.
- FROST threshold signatures for high-value identities that require k-of-n signing.

OAS is the layer that answers **who is this agent and what lineage authority can be proven**. It is vendor-neutral by design — the OAS spec lives at openagent.id and has no L1fe-product imports. Multiple implementations can speak OAS interchangeably; the crypto is all open standards. Privileged OpenAgent deployments inject Sigil GAL as the finality source through OAS resolver/anchor adapters.

What OAS does *not* do: it says nothing about what an agent is allowed to do, how credentials get to it, or what policies gate its behavior. Those belong to Arsenal and AEGIS.

## Arsenal — Capability Tokens and Credential Proxy

Arsenal is the capability and credential layer. It defines:

- Arsenal Capability Tokens (ACTs): short-lived, scoped, signed tokens bound to a DID.
- The scope grammar `service:resource:action`, including wildcards and negations.
- An **Arsenal broker**: a service that issues ACTs, holds provider credentials, and proxies outbound API calls on behalf of agents.
- The SSRF guard: an 11-step pipeline that prevents a compromised agent from exfiltrating credentials to attacker-controlled URLs.
- Hash-chained audit logging for every token issuance and every proxied request.

The key architectural move in Arsenal is that **the broker holds the real credentials and the agent never does**. When your code calls `credentialsFor('openai').post(url, body)`, the SDK talks to the broker, the broker attaches the real API key, the broker proxies upstream, and the broker returns the response. Your agent process is credential-free. A complete compromise of an agent leaks zero provider secrets.

Arsenal is the layer that answers **what is this agent allowed to do and where does it get the credentials to do it**.

## AEGIS — Verification, Authorization, Wallet

AEGIS is the verification and authorization layer. It defines:

- A verification pipeline that checks DIDs, ACTs, lineage proofs, and policy compliance.
- A policy engine with a small expression DSL: time windows, rate limits, spending caps, IP allowlists, approval tokens.
- Challenge-response authentication (for cases where a bearer token isn't appropriate).
- Multi-chain wallets: Ed25519 / secp256k1 / sr25519 / ed25519-dalek signing across 12 blockchains with FROST threshold support.
- Delegation trees with the no-amplification rule enforced.
- A PostgreSQL-backed store for policies, approvals, and audit.

AEGIS is the layer that answers **is this request allowed right now, given everything else we know about the agent, the time, the spend, and any human approvals**. It's the layer that makes nuanced governance tractable.

## The facade

The OpenAgent SDK is a thin wrapper that imports all three layers and exposes them through a unified API. The facade:

- Presents one `OpenAgent` static namespace / one `OpenAgent` struct.
- Owns the `Agent`, `Context`, `Credentials`, `Wallet`, and `SkillsPolicy` types.
- Wires the crypto core into a single shared WASM module so TypeScript and Rust share one implementation.
- Provides framework adapters (Express, Fastify, Hono, Axum, Tower).
- Provides the Claude Agent SDK plugin and MCP helpers.
- Handles the common error type `OpenAgentError` with stable codes.
- Caches DID resolutions and scope-check results.
- Implements skills governance (the SKILLS.md policy layer).

The facade does not add cryptography or security beyond what the underlying layers provide — it is a developer-experience layer. Reaching past it is supported: if you need a feature only exposed in the OAS or AEGIS SDK directly, you can import those packages and call them. The facade will still work around the direct calls.

## Why a facade?

Two reasons. First, developer experience. Importing three packages, wiring them together, and reconciling their error types is annoying. Most developers want one package that Just Works. The facade is that package.

Second, gradual depth. The facade exposes 80% of the functionality in 20% of the surface area. When a developer is ready to reach into the lower layers — because they're implementing a custom broker, or because they need a chain we don't support out of the box, or because they're writing a verifier in a language we don't ship — the lower layers are right there, independently documented, with their own release cadence.

## Data flow in a typical request

1. Request arrives at your service with an `Authorization: OpenAgent <act>` header.
2. `OpenAgent.authenticate(req)` calls OAS to verify the DID, signature, and required Sigil-backed lineage path.
3. AEGIS applies policy to the OAS verification result and request context.
4. Arsenal confirms the scopes include the operation about to be performed and issues/accepts ACTs only after the authority path is valid.
5. Your handler receives a `Context` with everything verified.
6. Your handler calls `agent.credentialsFor('openai').post(url, body)`.
7. The SDK sends the call to the Arsenal broker with the ACT attached.
8. The broker verifies the ACT (again, defense in depth), attaches the real OpenAI key, and proxies to OpenAI.
9. The response comes back through the broker to your handler.
10. Every step writes an audit entry hashed into the chain.

Total added latency compared to a bare `fetch()`: around 2-5ms on a local broker.

## What this architecture guarantees

- **Identity is portable.** You can verify a DID+signature without network access.
- **Privileged authority is finalized.** ACTs, credential access, org membership, and service authority require a Sigil-backed lineage path from the OAS verifier.
- **Credentials never enter agent processes.** The broker is the custodian.
- **Revocation is fast and cascading.** Killing an ancestor kills every descendant within seconds.
- **Audit is tamper-evident.** The hash chain is verifiable by anyone with the chain contents.
- **Scopes cannot be amplified via delegation.** The no-amplification rule is enforced client-side and on the broker.
- **Policy evaluation is server-authoritative.** Agents cannot override spend limits or rate limits by lying about their state.

## What this architecture does not guarantee

Read [threat-model.md](threat-model.md) for the full treatment. In summary: OpenAgent does not protect against a compromised broker (that's your highest-trust component), does not prevent social-engineering attacks that trick a human into issuing a bad approval, does not defend against prompt injection attacks on LLMs that make an agent misbehave within its granted scopes, and does not provide transport security on its own (you still run TLS).

Next: [why WASM crypto](why-wasm-crypto.md), or [threat model](threat-model.md).
