# OpenAgent SDK Documentation

**OpenAgent is Clerk/Auth0 for autonomous agents.**

Identity, capabilities, credentials, and governance — one import, two languages (Rust and TypeScript), zero vendor lock-in. OpenAgent gives every agent a portable OAS identity, Sigil-finalized lineage for privileged authority, a scoped capability token that your backends can trust, and a policy layer that decides which skills the agent is allowed to invoke.

Under the hood, OpenAgent is a thin facade over three standards:

- **OAS** (Open Agent Specification) — W3C DID-based identity and the upstream lineage verifier contract for humans, agents, tools, models, and services. Base identity is locally verifiable; privileged lineage must be Sigil-backed.
- **Arsenal** — Agent Capability Tokens (ACTs) and a credential proxy that holds your provider secrets so agents never see them.
- **AEGIS** — Verification, delegation, policy enforcement, multi-chain wallets, and audit.

You import one package. You get all three. Each layer is independently documented in [architecture/overview.md](architecture/overview.md), but you will almost never reach past the facade in day-to-day code.

## Who this is for

This documentation is written for application developers — people building agentic products who need to answer the question *"how do I know this request really came from my agent, and is this agent allowed to do what it's asking to do?"* If you have ever wrapped an OpenAI key in an API and panicked about how to rotate it, OpenAgent is for you. If you are building an MCP server and want to gate tools by caller identity, OpenAgent is for you. If you are integrating with the Claude Agent SDK and want skills governance without rolling your own policy engine, OpenAgent is for you.

This documentation is **not** a cryptography primer. You do not need to understand Ed25519, HKDF, or FROST threshold signatures to ship. The quickstarts assume ordinary backend experience in TypeScript or Rust.

## How to read these docs

1. **[Getting started](getting-started/installation.md)** — install the SDK and run a three-line demo.
2. **[Core concepts](getting-started/core-concepts.md)** — a plain-English explanation of DIDs, lineage, capabilities, and skills policies. Read this once, then refer back as needed.
3. **[Guides](guides/creating-an-agent.md)** — task-oriented walkthroughs for the things you will actually do: create an agent, authenticate a request, delegate authority, govern skills, integrate with MCP or the Claude Agent SDK, handle multi-chain wallets, and produce an audit trail.
4. **[Reference](reference/typescript-api.md)** — the public API surface, wire formats, scope grammar, and error codes.
5. **[Comparisons](comparisons/vs-oauth.md)** — why we built this instead of using OAuth, raw API keys, or Clerk.
6. **[Architecture](architecture/overview.md)** — if you want to understand the three-layer model, why the crypto core runs in WASM, and what OpenAgent does and does not protect against.
7. **[Lineage finality](architecture/lineage-finality.md)** — how OAS SDK centralizes Sigil-backed lineage verification for downstream systems.

## A word on stability

The SDKs are versioned 0.1.0 at the time of this writing. The public facade (`OpenAgent.createAgent`, `OpenAgent.authenticate`, `agent.credentialsFor`, `agent.skillsPolicy`) is the stable surface and will follow SemVer. The underlying OAS, Arsenal, and AEGIS crates have their own release tracks documented in the architecture section — you should not depend on them directly unless you are writing an adapter.

## Examples

The companion [examples directory](../examples/) has runnable projects for each major workflow: hello-agent, MCP server integration, Claude Agent SDK plugin, delegated agents, skills governance, and credential proxy. Every example is a self-contained project that compiles and runs once the SDK packages resolve.

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](../LICENSE-APACHE) or [MIT license](../LICENSE-MIT), at your option.
