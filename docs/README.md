# OpenAgentID documentation

OpenAgentID is free, open agent identity and developer tooling in the
Open Software family. Create a real identity, verify a
signed request and mount an animated avatar on infrastructure you control.
Life provides optional hosted services around the same core.

## Start here

```sh
npx create-openagent@0.6.0 my-agent-app --yes
cd my-agent-app
npm install
npm run dev
```

Open the printed local URL, then run `npm run agent` in another terminal. The
receiver verifies a real signed request and updates the local avatar. The starter
uses public SDK 0.8.0; no account, hosted identity service or private package is
required. Node 20+ and private persistent storage are required for local identity.

The [developer-tooling guide](developer-tooling.md) covers the complete public
journey: explicit receiver trust, CLI commands, durable challenges/replay and
revocation, portable verification, browser state and optional OIDC/OATS.

## Choose your integration

| Task | Guide |
| --- | --- |
| Add identity to an existing JavaScript/TypeScript app | [Quickstart](getting-started/quickstart-typescript.md) and [installation](getting-started/installation.md) |
| Create keys, exchange public identity and retain trust | [Creating an agent](guides/creating-an-agent.md) |
| Verify signature, lineage, current authority and replay | [Identity verifier and Fetch API](identity-verification.md) |
| Authenticate HTTP requests with configured clients | [Request authentication](guides/authenticating-requests.md) |
| Animate current agent state or render deterministic SVG | [Characters and live eyes](characters.md), [Glyph](glyph.md) and [character design](guides/character-design.md) |
| Federate an agent into an OIDC relying party | [OIDC provider](../bridges/oidc/typescript/README.md) |
| Score verified agent attestations | [OATS verified-ingestion contract](oats.md) |
| Understand trust, ownership, scopes and presentation | [Core concepts](getting-started/core-concepts.md) |
| Supply service or anchor adapters | [Architecture](architecture/overview.md) and [lineage/anchor authority](architecture/lineage-finality.md) |
| Find exported TypeScript types | [API reference](reference/typescript-api.md) and [SDK source](../sdks/typescript/src/index.ts) |
| Use the Rust integration facade | [Rust integration quickstart](getting-started/quickstart-rust.md) |

## Current release and boundaries

The current release is `@openagentid/sdk` 0.8.0 with `create-openagent` 0.6.0;
the [README's package table](../README.md#packages) lists every npm package and
version, and the [0.8.0 release contents](release-0.8.0.md) describe what
shipped. Releases are published as described in [RELEASING](RELEASING.md).
Other language modules and integration crates have their own feature and
version tracks.

The browser catalog contains 18 families, 77 kinds and 18 shared expressions,
including the One family of coloured heads with one bar for an eye.
Autos, plush material, on-face eyes and face crop are the defaults. Appearance
choices preserve the live eye timeline; they convey no identity authority or
application permissions.

Agents can have an approved person/org owner or be explicitly authorized self
roots. The receiver controls trust and permissions. Neither DID syntax, a valid
signature nor an avatar alone establishes a human owner, tenant membership or
access to a service.

The configured `OpenAgentRuntime` facade wraps supplied OAS, Arsenal and AEGIS
clients. It does not instantiate them from endpoint strings, automatically issue
credentials during creation or make private dependencies publicly accessible.
The standalone local identity and avatar path does not depend on these clients.

Existing integration guides/examples describe particular adapters and may need
provider configuration and dependency access. Use the public starter for the
complete first-run example; consult actual module types before adopting an
older provider-specific example. Anchor providers are explicit integrations,
not a mandatory chain for every identity.

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai).
Licensed under [Apache-2.0](../LICENSE-APACHE) or [MIT](../LICENSE-MIT), at your option.
