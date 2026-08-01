# OpenAgent SDK

**Agent auth in 3 lines.** One SDK for identity, credentials, and verification — built on [OAS](https://github.com/OpenAgentID/oas) (W3C DID identity), [Arsenal](https://github.com/OpenAgentID/arsenal) (scoped capability tokens), and [AEGIS](https://github.com/OpenAgentID/aegis) (verification and policy).

Every language implementation is gated by the same conformance suite — the canonical ACT verification vectors in [`conformance/`](conformance/) — so a token that verifies in one language verifies in all of them.

## Languages

| Language | Package | Install | Docs |
|---|---|---|---|
| TypeScript | [`@openagentid/sdk`](https://www.npmjs.com/package/@openagentid/sdk) | `npm install @openagentid/sdk` | [sdks/typescript](sdks/typescript/) |
| Python | [`openagentid-sdk`](sdks/python/) | `pip install openagentid-sdk` | [sdks/python](sdks/python/) |
| Rust | [`openagent-sdk`](sdks/rust/) | `cargo add openagent-sdk` | [sdks/rust](sdks/rust/) |
| Go | [`openagent`](sdks/go/) | `go get github.com/OpenAgentID/openagent-sdk/sdks/go` | [sdks/go](sdks/go/) |
| Swift | [`OpenAgentSDK`](sdks/swift/) | SwiftPM — this repo as a package dependency | [sdks/swift](sdks/swift/) |
| Kotlin | [`id.openagent:sdk`](sdks/kotlin/) | Gradle — see the module README | [sdks/kotlin](sdks/kotlin/) |

Registry publishes beyond npm are rolling out now; every SDK can also be consumed directly from this repository in the meantime.

## What's in the box

- **Verify-first ACT verification** — `act.verify()` fluent builders and framework middleware (Express, fetch, Axum, FastAPI/Starlette, `net/http`, Ktor) in every language
- **Key custody** — seed-based Ed25519 key management with identical semantics across languages
- **Fail-closed subsystems** — no silent stubs in production; in-memory fakes live in [`@openagentid/sdk-testing`](sdks/testing/) for tests only
- **Core Protocol authentication** — the Section 15 challenge-response flow, with HTTP adapters in [`adapters/http`](adapters/http/)
- **EAS anchoring** — chain-agnostic lineage anchors with an Ethereum Attestation Service adapter in [`adapters/eas`](adapters/eas/)
- **Bridges & integrations** — [OIDC](bridges/oidc/), [SCIM 2.0](bridges/scim/), [MCP](integrations/mcp/), [Claude Agent SDK](integrations/claude-agent-sdk/)
- **Shared crypto** — [`@openagentid/crypto-wasm`](crates/openagent-crypto-wasm/), the Rust crypto core compiled to WASM for cross-language parity

## Repository layout

```
sdks/         Language SDKs (typescript, python, rust, go, swift, kotlin) + testing
adapters/     Protocol adapters (http, eas, weave)
bridges/      Enterprise bridges (oidc, scim)
integrations/ Framework integrations (mcp, claude-agent-sdk)
crates/       Rust crates (auth protocol, crypto-wasm, skills policy)
conformance/  Canonical test vectors + runners (Rust, TypeScript)
examples/     Runnable examples (typescript, rust)
packages/     create-openagent project scaffolder
deploy/       Deployment targets (docker, aws-lambda, cloudflare-worker, vercel-edge)
docs/         Additional documentation
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All changes must keep the conformance suite green in every language.

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT), at your option.
