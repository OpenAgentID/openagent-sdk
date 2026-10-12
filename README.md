# OpenAgent SDK

OpenAgentID is a free, open [Open Software](https://open.software) core project
alongside Henry, Weave, Flocks and Fleets. Create an agent identity, verify its
signed requests and give it an animated avatar without an account or hosted
identity service. Your application controls keys, trust and access.

## Start a working application

```sh
npx create-openagent@0.4.0 my-agent-app --yes
cd my-agent-app
npm install
npm run dev
```

Open the local URL, then run `npm run agent` in a second terminal. The receiver
verifies a real signed request; its status updates the agent's live eyes. Autos
is the default skin; SpaceX, original crafted families and holiday characters are selectable. Keys and trust survive restarts.
The starter uses SDK 0.6.0 and public npm dependencies only.

For an existing application, install `@openagentid/sdk@0.6.0` and follow the
[TypeScript/JavaScript quickstart](docs/getting-started/quickstart-typescript.md).
The included `oaid` CLI creates identities, exchanges public trust documents,
issues challenges, signs and verifies proofs, revokes local trust and renders
avatars. No command requires a Life service. See the
[0.6.0 shipment contents](docs/release-0.6.0.md).

Life sells optional hosted services around this core. Inside the Life ecosystem,
LifeID authenticates humans, Blinds brokers credentials and Genesis KMS stores
customer secrets. Those integrations are independent of the standalone path.

## Identity and avatar releases

The **0.2.0 release** adds a signing [OIDC provider](bridges/oidc/typescript/),
[identity verification API/SDK/CLI](docs/identity-verification.md),
[OAS Glyph avatars](docs/glyph.md) and [verified OATS scoring](docs/oats.md).
See the [inventory](docs/inventory-2026-10-11.md) for the published 0.1.x baseline.
The [0.2.0 shipment list](docs/release-0.2.0.md) defines the two package artifacts
and migration requirements before publication.
Both `@openagentid/sdk@0.2.0` and `@openagentid/oidc@0.2.0` are published.
Hosted issuer/LifeID integration remains a separate rollout.

The following **SDK 0.2.1** adds the [open character API](docs/characters.md):
Autos is the default agent skin, SpaceX provides eight geometric shapes, and
both share sixteen live-eye expressions with blinking and gaze. A skin chooses
the body/face; the avatar expression chooses its eye state. Identity stays stable.

**SDK 0.2.2** adds avatar-only compatibility with literal existing IAM
agent-instance ULIDs and exports `isAgentAvatarDid` for consumer display
selection. The assigned DID stays unchanged; authentication admission does too.

**SDK 0.3.0**, now published, adds [live expression state](docs/characters.md):
update an agent's status to smoothly change its eyes in place. Reasoning selects
thoughtful; blocked or error selects concerned. Autos and SpaceX share all
eighteen expressions, ongoing blinks and gaze, and system reduced-motion support.
The clock-driven animator works without a DOM; the browser player mounts inline
SVG once and accepts updates from the host's authorized state channel.

## Start with public developer tooling

SDK 0.4 adds a local-first CLI and working application
starter. Generate and retain real Ed25519 identities, explicitly trust a public
identity at your receiving application, verify issued challenges and revoke
trust without a Life account or centralized service. See the
[TypeScript/JavaScript quickstart](docs/getting-started/quickstart-typescript.md).

The existing `OpenAgent` facade wraps configured OAS, Arsenal and AEGIS clients.
Those clients must be supplied; endpoint strings alone do not initialize them.
The standalone local identity and live-avatar APIs need only this public SDK.

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

The npm SDK is published. Check each language module before selecting it: Rust
currently references private OAS, Arsenal and AEGIS repositories. That path is not
yet a public clean-clone onboarding experience. The TypeScript local identity
and avatar path has no private repository requirement.

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

### Character accessories

Glasses and headphones are optional, combinable layers on every character family.
Use `accessories: ['glasses', 'headphones']` when rendering or mounting a character,
and `player.setAppearance({ accessories: [] })` to remove them without resetting
its live eyes. See the [accessory release guide](docs/release-0.6.0.md) for profile, API and CLI examples.
