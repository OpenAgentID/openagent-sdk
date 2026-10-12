# OpenAgent SDK Examples

Runnable example projects for the OpenAgent SDK. Each subdirectory is a self-contained project — copy it out, adjust the package reference, and run.

## Layout

```
examples/
├── typescript/
│   ├── 01-hello-agent/           # Separate signer/receiver and replay refusal
│   ├── 02-mcp-server/            # MCP server with OpenAgent auth
│   ├── 03-claude-agent-plugin/   # Native Claude hooks and verified permissions
│   ├── 04-delegated-agent/       # OAS parent/child identities and scope authority
│   ├── 05-skills-governance/     # Contextual YAML skill policy and signed receipts
│   └── 06-credential-proxy/      # Using the Arsenal broker for API calls
└── rust/
    ├── 01-hello-agent/
    ├── 02-mcp-server/
    ├── 03-delegated-agent/
    └── 04-skills-governance/
```

## Start here

The updated [Hello Agent](typescript/01-hello-agent/) uses Node 20+ and the public
current SDK local authority with actual signing keys and replay refusal. For a full
HTTP application and animated UI, use the [generated starter](../docs/getting-started/quickstart-typescript.md).

The six TypeScript projects are exercised by the packed-package compatibility
runner. Each contains a complete program: `npm install` followed by `npm start`.
MCP starts a real stdio server; the Claude example invokes the official typed
hooks without paid model calls; OAS creates signed parent/child documents;
Skills Policy enforces contextual grants; the credential example runs a real
signed-capability broker and protected upstream on loopback. Their READMEs
identify the production custody and transport configuration you supply.

The Rust projects use their own Cargo manifests and feature contracts; they do
not consume the TypeScript npm SDK. The generated starter remains the shortest
path to a complete identity, authenticated HTTP and live avatar application.

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](../LICENSE-APACHE) or [MIT license](../LICENSE-MIT), at your option.
