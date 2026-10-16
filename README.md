# OpenAgent SDK

OpenAgentID is a free, open [Open Software](https://open.software) core project
alongside Henry, Weave, Flocks and Fleets. Create an agent identity, verify its
signed requests and give it an animated avatar without an account or hosted
identity service. Your application controls keys, trust and access.

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
crafted families and holiday characters are selectable; every family also offers
flat material, raised eyes and glasses/headphones. Keys and trust survive restarts.
The starter uses SDK 0.8.0 and public npm dependencies only.
Every character family shares a brighter color direction and soft plush finish;
distinct silhouettes and signature details keep each family recognizable.

For an existing application, install `@openagentid/sdk@0.8.0` and follow the
[TypeScript/JavaScript quickstart](docs/getting-started/quickstart-typescript.md).
The [developer-tooling guide](docs/developer-tooling.md) covers the current CLI,
receiver trust/storage, portable verification, OIDC/OATS and browser state APIs.
The included `oaid` CLI creates identities, exchanges public trust documents,
issues challenges, signs and verifies proofs, revokes local trust and renders
avatars. No command requires a Life service. See the
[0.8.0 release contents](docs/release-0.8.0.md).

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
Owned and explicitly authorized self-root identities are supported; identity
verification grants no application permission by itself. Chain-finality providers
are explicit [authority/anchor integrations](docs/architecture/lineage-finality.md),
not a prerequisite for the public starter. The EAS adapter can be configured for Base; its availability does not prove
a deployed default or a completed migration.

The canonical ACT vectors in [`conformance/`](conformance/) exercise shared
verification cases. They do not establish universal language/API parity or
compatibility beyond the qualified formats and cases.

## Languages

| Language | Distribution | Current integration |
|---|---|---|
| TypeScript | npm `@openagentid/sdk` 0.7.3 | `npm install @openagentid/sdk@0.7.3`; [current guide](docs/developer-tooling.md) |
| Python | PyPI `openagentid-sdk` 0.1.0 | `pip install openagentid-sdk==0.1.0`; [module](sdks/python/) |
| Rust | Unified facade is source-only | [sdks/rust](sdks/rust/); optional OAS/Arsenal/AEGIS Git dependencies may require separate access |
| Go | Source module | [sdks/go](sdks/go/); Go 1.26.4+, use the checkout's module |
| Swift | Source package | Add [sdks/swift](sdks/swift/) as a local package, not the repository root |
| Kotlin | Source module | [sdks/kotlin](sdks/kotlin/); no unified Maven Central release is asserted |

Registry availability was checked on 12 October 2026; SDK 0.8.0 and
create-openagent 0.6.0 are listed above as source releases until they are
published. Each language has its own
API and release track. The TypeScript local workspace and browser player need
no private repository. The starter is `create-openagent` 0.6.0; the separate
OIDC provider is `@openagentid/oidc` 0.2.0.

## What's in the box

- **Local identity and CLI** — real Ed25519 keys, explicit receiver trust, persisted challenges/revocation and the bundled `oaid` commands.
- **Portable verification** — configurable authoritative keys, owner/self-root policy, revocation and atomic replay.
- **Live avatars** — deterministic appearance, face framing, shared smooth eyes and status updates independent of identity permission.
- **Protocol components** — ACT verification and framework adapters have their own source APIs and crypto-binding requirements; they are distinct from local possession JWTs.
- **EAS anchoring** — the configurable Ethereum Attestation Service adapter in [`adapters/eas`](adapters/eas/), including Base endpoint configuration.
- **Bridges and integrations** — [OIDC](bridges/oidc/), [SCIM](bridges/scim/), [MCP](integrations/mcp/) and [harness source](integrations/claude-agent-sdk/) have distinct configuration and availability boundaries.
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

### The One family

`skin: 'one'` draws an agent as One: a round disc with one bar for an eye, in one
of twelve colours, or Digital One (`charcoal`) for One itself, with its own eye
style `agent-eye-v1`. It is still at rest and shows its live status with
agent-eye's faces and moves. Hosts that draw only Ones can use the light
`@openagentid/sdk/one` entry, whose live runtime is 14.5 KB gzipped. Autos
remains the default family. Keep One colours in your own agent records until
every reader of your identity documents runs SDK 0.8.0. See
[the One family](docs/characters.md#the-one-family) and the
[0.8.0 release contents](docs/release-0.8.0.md).

### Shared finish and eye placement

All 17 two-eyed character families default to `finish: 'plush'` and `eyePlacement: 'face'`.
Select `finish: 'flat'` or `eyePlacement: 'raised'` when rendering, saving an
appearance or calling `player.setAppearance`. Accessories and the live eye
state persist across those changes. See the [0.7.3 release guide](docs/release-0.7.3.md).
