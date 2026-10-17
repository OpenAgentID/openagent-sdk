# OpenAgent SDK

[![ci](https://github.com/OpenAgentID/openagent-sdk/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/OpenAgentID/openagent-sdk/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@openagentid/sdk)](https://www.npmjs.com/package/@openagentid/sdk)
[![license](https://img.shields.io/badge/license-Apache--2.0%20OR%20MIT-blue)](#license)

OpenAgentID is a free, open Open Software core project alongside Henry, Weave,
Flocks and Fleets. Create an agent identity, verify its signed requests and give
it an animated avatar without an account or hosted identity service. Your
application controls keys, trust and access.

## Start a working application

```sh
npx create-openagent@0.6.0 my-agent-app --yes
cd my-agent-app
npm install
npm run dev
```

Open the local URL, then run `npm run agent` in a second terminal. The receiver
verifies a real signed request; its status updates the agent's live eyes. Autos
is the default skin with a soft plush finish and on-face eyes. SpaceX, original
crafted families, holiday characters and the One family are selectable; every
two-eyed family also offers flat material, raised eyes and glasses/headphones.
Keys and trust survive restarts. The starter uses SDK 0.8.0 and public npm
dependencies only.

For an existing application, install `@openagentid/sdk` and follow the
[TypeScript/JavaScript quickstart](docs/getting-started/quickstart-typescript.md).
The [developer-tooling guide](docs/developer-tooling.md) covers the CLI,
receiver trust/storage, portable verification, OIDC/OATS and browser state APIs.
The included `oaid` CLI creates identities, exchanges public trust documents,
issues challenges, signs and verifies proofs, revokes local trust and renders
avatars. No command requires a Life service.

Life sells optional hosted services around this core. Inside the Life ecosystem,
LifeID authenticates humans, Blinds brokers credentials and Genesis KMS stores
customer secrets. Those integrations are independent of the standalone path.

## Local identity and verification

The SDK holds real Ed25519 identities in a local workspace, lets a receiving
application explicitly trust a public identity, verifies issued challenges and
revokes trust without a Life account or centralized service. Owned and
explicitly authorized self-root identities are supported; identity verification
grants no application permission by itself. The
[identity verification API, SDK and CLI](docs/identity-verification.md) check
possession signatures, signed lineage, current revocation and replay; the
signing [OIDC provider](bridges/oidc/typescript/) lets agents log in to
applications; [OAS Glyph](docs/glyph.md) and [verified OATS](docs/oats.md)
complete the identity surface.

The existing `OpenAgent` facade wraps configured OAS, Arsenal and AEGIS clients.
Those clients must be supplied; endpoint strings alone do not initialize them.
The standalone local identity and live-avatar APIs need only this public SDK.
Chain-finality providers are explicit
[authority/anchor integrations](docs/architecture/lineage-finality.md), not a
prerequisite for the public starter. The EAS adapter can be configured for Base.

The canonical ACT vectors in [`conformance/`](conformance/) exercise shared
verification cases across the language SDKs for the qualified formats and cases.

## Live avatars

The [open character API](docs/characters.md) draws every agent as a character
with live eyes. Autos is the default skin; SpaceX, twelve crafted families, three
holiday families and the One family are selectable. A skin chooses the
body/face; the avatar expression chooses its eye state; identity stays stable.
Update an agent's status to smoothly change its eyes in place: reasoning selects
thoughtful, blocked or error selects concerned. Blinks, gaze and system
reduced-motion support are shared. The clock-driven animator works without a
DOM; the browser player mounts inline SVG once and accepts updates from the
host's authorized state channel.

All 17 two-eyed character families default to `finish: 'plush'` and
`eyePlacement: 'face'`. Select `finish: 'flat'` or `eyePlacement: 'raised'` when
rendering, saving an appearance or calling `player.setAppearance`. Glasses and
headphones are optional, combinable layers: use
`accessories: ['glasses', 'headphones']` when rendering or mounting a character,
and `player.setAppearance({ accessories: [] })` to remove them without resetting
its live eyes. Accessories and the live eye state persist across those changes.

`skin: 'one'` draws an agent as One: one of fourteen fun shapes in one of
eighteen colours, with one bar for an eye, or Digital One (`charcoal`), the
black circle, for One itself, with its own eye style `agent-eye-v1`. It is still
at rest and shows its live status with agent-eye's faces and moves. Hosts that
draw only Ones can use the light `@openagentid/sdk/one` entry; its browser
runtime, `@openagentid/sdk/browser/one`, stays within the 16 KiB gzipped budget
that CI checks. Keep One looks in your own agent records until every reader of
your identity documents runs SDK 0.8.0. See
[the One family](docs/characters.md#the-one-family).

## Packages

| Package | npm | Install |
|---|---|---|
| SDK | [`@openagentid/sdk`](https://www.npmjs.com/package/@openagentid/sdk) 0.8.0 | `npm install @openagentid/sdk` |
| Project generator | [`create-openagent`](https://www.npmjs.com/package/create-openagent) 0.6.0 | `npx create-openagent@0.6.0` |
| HTTP adapter | [`@openagentid/http`](https://www.npmjs.com/package/@openagentid/http) 0.2.1 | [adapters/http](adapters/http/typescript/) |
| MCP integration | [`@openagentid/mcp`](https://www.npmjs.com/package/@openagentid/mcp) 0.2.1 | [integrations/mcp](integrations/mcp/typescript/) |
| Claude Agent SDK hooks | [`@openagentid/claude-agent`](https://www.npmjs.com/package/@openagentid/claude-agent) 0.2.1 | [integrations/claude-agent-sdk](integrations/claude-agent-sdk/typescript/) |
| SCIM bridge | [`@openagentid/scim`](https://www.npmjs.com/package/@openagentid/scim) 0.2.1 | [bridges/scim](bridges/scim/typescript/) |
| OIDC provider | [`@openagentid/oidc`](https://www.npmjs.com/package/@openagentid/oidc) 0.3.0 | [bridges/oidc](bridges/oidc/typescript/); pairs with SDK 0.7 |
| Test backends | [`@openagentid/sdk-testing`](https://www.npmjs.com/package/@openagentid/sdk-testing) 0.1.3 | [sdks/testing](sdks/testing/) |
| EAS anchor | [`@openagentid/anchor-eas`](https://www.npmjs.com/package/@openagentid/anchor-eas) 0.2.0 | [adapters/eas](adapters/eas/typescript/) |

The companion packages declare `@openagentid/sdk` as a peer, so
`npm install @openagentid/sdk @openagentid/mcp` installs a matching pair. Each
release's package set is in [CHANGELOG.md](CHANGELOG.md) and the
[GitHub releases](https://github.com/OpenAgentID/openagent-sdk/releases);
[docs/RELEASING.md](docs/RELEASING.md) describes how a release is published.

## Languages

| Language | Distribution | Current integration |
|---|---|---|
| TypeScript | npm `@openagentid/sdk` 0.8.0 | `npm install @openagentid/sdk`; [current guide](docs/developer-tooling.md) |
| Python | PyPI `openagentid-sdk` 0.1.0 | `pip install openagentid-sdk==0.1.0`; [module](sdks/python/) |
| Rust | Unified facade is source-only | [sdks/rust](sdks/rust/); its optional OAS/Arsenal/AEGIS Git dependencies need access to those repositories |
| Go | Source module | [sdks/go](sdks/go/); Go 1.26.4+, use the checkout's module |
| Swift | Source package | Add [sdks/swift](sdks/swift/) as a local package, not the repository root |
| Kotlin | Source module | [sdks/kotlin](sdks/kotlin/) |

Each language has its own API and release track. The TypeScript local workspace
and browser player need no private repository.

## What's in the box

- **Local identity and CLI** — real Ed25519 keys, explicit receiver trust, persisted challenges/revocation and the bundled `oaid` commands.
- **Portable verification** — configurable authoritative keys, owner/self-root policy, revocation and atomic replay.
- **Live avatars** — deterministic appearance, face framing, shared smooth eyes and status updates independent of identity permission.
- **Protocol components** — ACT verification and framework adapters have their own source APIs and crypto-binding requirements; they are distinct from local possession JWTs.
- **EAS anchoring** — the configurable Ethereum Attestation Service adapter in [`adapters/eas`](adapters/eas/), including Base endpoint configuration.
- **Bridges and integrations** — [OIDC](bridges/oidc/), [SCIM](bridges/scim/), [MCP](integrations/mcp/) and [Claude Agent SDK hooks](integrations/claude-agent-sdk/) have distinct configuration and availability boundaries.
- **Crypto implementations** — native Node/browser modules and the separate [crypto-WASM component](crates/openagent-crypto-wasm/) serve their documented APIs; a seed does not promise identical recovery behavior across every module.

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
tools/        Release, compatibility and public-onboarding tooling
docs/         Additional documentation
```

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for the build commands and review rules,
and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Report vulnerabilities privately
as described in [SECURITY.md](SECURITY.md), never in a public issue.
OpenAgentID is maintained by [L1fe Labs, Inc.](https://l1fe.ai)
(<eng@l1fe.ai>).

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT), at your option.
