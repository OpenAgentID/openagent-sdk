# OpenAgent SDK Examples

Runnable example projects for the OpenAgent SDK. Each subdirectory is a self-contained project — copy it out, adjust the package reference, and run.

## Layout

```
examples/
├── typescript/
│   ├── 01-hello-agent/           # Minimal 3-line agent auth demo
│   ├── 02-mcp-server/            # MCP server with OpenAgent auth
│   ├── 03-claude-agent-plugin/   # Claude Agent SDK plugin integration
│   ├── 04-delegated-agent/       # Parent delegating to a child worker
│   ├── 05-skills-governance/     # SKILLS.md policy in action
│   └── 06-credential-proxy/      # Using the Arsenal broker for API calls
└── rust/
    ├── 01-hello-agent/
    ├── 02-mcp-server/
    ├── 03-delegated-agent/
    └── 04-skills-governance/
```

## Running an example

Every TypeScript example expects `bun` (works with `node 20+` too):

```bash
cd examples/typescript/01-hello-agent
bun install
bun run start
```

Every Rust example uses plain `cargo`:

```bash
cd examples/rust/01-hello-agent
cargo run
```

## Prerequisites

Examples assume you have an Arsenal broker reachable at `OPENAGENT_BROKER_URL` and a parent DID you're authorized to act on behalf of. For local development, the SDK ships with a `FakeBroker` mode (`OPENAGENT_BROKER_URL=fake://in-memory`) that mints valid tokens in-process without any external service. Examples default to this mode so they run out of the box; production deployments should point at a real broker.

## Environment variables

- `OPENAGENT_BROKER_URL` — Arsenal broker URL. Defaults to `fake://in-memory`.
- `OPENAGENT_AEGIS_URL` — AEGIS verifier URL. Defaults to `fake://in-memory`.
- `OPENAGENT_NAMESPACE` — DID namespace. Defaults to `example`.
- `OPENAGENT_PARENT_DID` — Parent DID for `createAgent` calls. Defaults to a per-example local HMR.
- `OPENAGENT_LOG` — Log level (`error`, `warn`, `info`, `debug`). Defaults to `info`.

## Relationship to the SDKs

Examples reference `@openagentid/sdk` (TS) and `openagent-sdk` (Rust) as workspace dependencies. If you're running outside the workspace, change the reference to a published version or a path dependency. Feel free to copy and adapt.

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](../LICENSE-APACHE) or [MIT license](../LICENSE-MIT), at your option.
