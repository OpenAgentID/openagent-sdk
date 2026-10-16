# create-openagent

A working OpenAgentID application from public packages. Real Ed25519 identity,
explicit receiver trust, authenticated HTTP requests and animated avatars run
locally without a Life account or a hosted identity service.

```sh
npx create-openagent@0.6.0 my-agent-app --yes
cd my-agent-app
npm install
npm run dev
```

In a second terminal, run `npm run agent`. It signs an actual server-issued
challenge; the receiver verifies the signature and current trust and consumes
the challenge exactly once. The viewer uses Autos by default, offers all 18 families and 75 kinds with face
framing (including SpaceX, holiday characters and the One family), and updates from actual verified requests. It uses the same SDK player you can
mount in your own UI. Soft plush is the default finish, with flat material
as an option, and on-face or raised eye placement on every two-eyed family. Those controls
keep the selected accessories and actual verified-request state intact. Glasses
and headphones use refined metal frames and soft cushions. SDK 0.8.0 adds the
One family: a coloured disc with one bar for an eye that shows the same verified
status and keeps the selected wearables for when you switch back.

Node 20.19+ is required. Private keys and receiver state stay in the generated
application's ignored local data directory. Preserve this directory across
restarts; never commit or serve it. Only public identity documents are exchanged
between the separate signer and receiver workspaces.

## Commands

- `create-openagent my-app --yes`: generate the complete default starter without prompts.
- `create-openagent my-app --template starter`: select the same starter explicitly.
- `create-openagent --help`: show supported options.
- `create-openagent --version`: report the scaffolder version.

Existing directories are never overwritten. Invalid, duplicate and unsupported
options are refused rather than silently producing a partially wired project.
The generated project includes its own instructions and real integration tests.

## Migrating from 0.1.x

The 0.1.x agent, MCP, dashboard and full-stack generators emitted old SDK ranges
and incomplete subsystem setup. Version 0.2 supports the verified `starter`
path. Old template, adapter, bridge and deployment selectors are rejected with
an actionable message. Existing generated applications are not modified. Their
source templates remain in the repository for future migration.

The SDK's OIDC, verification, middleware, credential and character APIs remain
available independently. See the [public quickstart](https://github.com/OpenAgentID/openagent-sdk/blob/main/docs/getting-started/quickstart-typescript.md)
for adding identity to an existing application instead of generating a new one.

## License

Apache-2.0 OR MIT, same as OpenAgentID.
