# OpenAgentID public developer tooling

## Package contents

| Package | Version | Included |
|---|---|---|
| `@openagentid/sdk` | `0.4.0` | Node-only local identity workspace, expanded `oaid` CLI, TypeScript declarations, ESM/CommonJS modules, existing identity/verification APIs and self-contained animated-avatar browser module |
| `create-openagent` | `0.2.0` | Embedded Node application starter, real HTTP signer/receiver flow, browser viewer, integration tests and setup instructions |

The independent `@openagentid/oidc@0.2.0` package is unchanged. Both new archives
include their README, changelog and Apache-2.0/MIT licenses. Private identities,
keys, local state and `node_modules` directories are not included in the archives.

## First run

```sh
npx create-openagent@0.2.0 my-agent-app --yes
cd my-agent-app
npm install
npm run dev
```

Open the printed loopback URL and run `npm run agent` in another terminal.
The generated signer obtains a fresh challenge and proves possession of its
persisted Ed25519 key. A separate receiver verifies its explicit public-key pin,
current local revocation and single-use challenge. Only then does it process
the request. Its actual completion status updates the browser's live eyes.
Autos is the default skin; SpaceX and expression overrides are available.

## CLI and integration API

The SDK provides `oaid init`, `agent create/list/export/trust/revoke`,
`challenge`, `prove`, `verify --local`, `doctor` and `avatar`. Existing remote
verification, OIDC diagnostics and Glyph commands remain available. Commands
emit public JSON metadata or explicit proof/SVG output and use nonzero exit
codes for refusals. Output files are created exclusively.

`@openagentid/sdk/local` exports `OpenAgentWorkspace` and its typed public
identity/challenge/error contracts. The workspace requires private persistent
storage on one host. Its keys, trust pins, challenge consumption and revocations
survive restart; neither missing state nor corrupt state triggers replacement
identities. Revocation is local to the receiver. Applications retain their own
authorization and tenant policy.

No Life account, hosted identity authority, template download, private package
or runtime telemetry is required. Public npm is used to install dependencies;
the generated identity flow and avatar rendering run locally. The starter is
bound to loopback. Deployment requires an application's own HTTPS transport,
storage and authorization policy.

## Migration and qualification

`create-openagent` 0.2 supports the complete `starter` path. Historical template,
adapter, bridge and deployment selectors are refused with migration guidance.
Existing generated applications remain untouched. The Rust facade's private
OAS/Arsenal/AEGIS source dependencies remain a separate public-adoption gap.

The release gate installs exact packed archives in fresh Node 20 and Node 22
applications, checks public dependency resolution, runs real HTTP/keypair,
restart, concurrent replay, revocation and refusal tests, and inspects desktop
and mobile browser eye transitions, stable DOM nodes and reduced motion.
The full repository CI and independent review apply to the final release head.
This package release does not establish deployment on a real o.page profile.
