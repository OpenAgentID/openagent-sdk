# OpenAgentID 0.2 inventory — 11 October 2026

Canonical source: https://github.com/OpenAgentID/openagent-sdk, main
`06d4768d0966361a3034f750acbf98231e3b0bf1`. A clean checkout is at
`/Volumes/PRO-G40/Life/OpenSoftware/OpenAgentID/openagent-sdk`. No new repository
or fork was created. Existing private development work is preserved.

## Published packages

The live npm registry reported these latest versions on 11 October:

| Packages under @openagentid | Latest |
| --- | --- |
| sdk, sdk-testing, oidc, http, scim, mcp, claude-agent, crypto-wasm, skills-policy, anchor-eas | 0.1.1 |
| aegis-sdk, arsenal-sdk, client | 0.1.1 |
| oas-attestation, oas-crypto, oas-did, oas-document, oas-lineage, oas-resolve, oas-sdk, oas-vanilla | 1.0.2 |

The unscoped `create-openagent` package is 0.1.1. No package has a 0.2.0
version. Registry signatures exist; no npm provenance attestations were present.
SDK and OIDC 0.1.1 identify source revision
`90a3870ca976790e6de7df6db6ad06256007d6ca`. The only GitHub release is v0.1.0
at `9ef3f571a9d584ebee080cb1aec591f684cec603`.

Primary evidence: https://registry.npmjs.org/@openagentid%2Fsdk,
https://registry.npmjs.org/@openagentid%2Foidc and
https://registry.npmjs.org/-/v1/search?text=%40openagentid&size=250.

## Legacy merge and protocol sources

`l1felabs/openagentid` default head is
`9f69881744f3b57ce07545721d1edc1ae489018c`. PR 2 merged the provider-neutral
claim normalization and OIDC discovery/JWKS doctor at
`07c280bc6991646706207cb690c231975fc9d7c9`; CI run 37845102562 passed.
It is not a signing OIDC provider. Its SDK/CLI packages are private development
packages. PR 1 is an open documentation/component-map change at
`33cfe1ab724e6328f6a33317122400a2d7fdbaa2`.

The local developer-entry source is dirty at base
`d7e06717bd08b543e3ea01430265986809d8d733`. Its fixed-seed fixture runner,
uncommitted conformance changes and vendored protocols are not production
identity services and must not replace canonical source.

`OpenAgentID/oats` main is
`5587a0f5cd9629d63d16243fec407c509b6297a9`. Rust `oats-score`, `oats-oracle`
and `oats-sdk` are 0.1.0. The README defines five-component scoring, weighted
.30/.25/.20/.15/.10, 90-day half-life and evidence confidence. No separate
normative spec was found. Crypto, owner and revocation validation are callers'
responsibility; the oracle accepts unsigned JSON and tolerates malformed data.
Canonical integration needs a fail-closed verified evidence boundary.

`OpenAgentID/oas-glyph` main is
`f0090dd344d31e4b2724338968655fbdec3837e9`. It has a Rust deterministic
BLAKE3/grid/SVG implementation, without an npm SDK or avatar override field.

## Live observations and gaps

Website and docs returned 200. Website OIDC discovery returned 404; public
`api.openagent.id` discovery/JWKS/health returned 401 OpenAgent challenges.
`auth.life.one` discovery/JWKS returned 200 with EdDSA and agent claims;
`id.life.one` discovery returned 200 with RS256. These observations do not prove
agent federation or a working relying-party journey. The open.software TLS
probe failed from this environment.

The canonical TypeScript OIDC bridge has dummy key derivation, unsigned
lineage, `unsigned-token-placeholder` success and `exchange-act-placeholder`
inside exchanges. It lacks a complete authorization-code provider. Existing
optional OAS SDK peers target ^0.1.0 while npm OAS SDK is 1.0.2. A unified
verification HTTP/SDK/CLI surface, legacy-readable identity, OATS verified
ingestion and glyph override support are required for 0.2.

Canonical CI run 30704489060 failed on missing private dependency credentials
and Swift runner setup. TypeScript SDK, Go, Python and Kotlin passed. The OAS,
Arsenal and AEGIS GitHub dependencies remain private despite the free/open
project direction; changing their visibility is outside this release.

## Release gates

Every PR needs green CI and an Iris Core Review pass for its exact full head,
routed through Hans. Application checks execute remotely on Depot. Show the
exact package contents, versions and hashes before npm publication. The current
npm operator session returns E401, so publication access is not established.
