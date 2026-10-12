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

## Start here

The updated [Hello Agent](typescript/01-hello-agent/) uses Node 20+ and the public
SDK 0.4 local authority with actual signing keys and replay refusal. For a full
HTTP application and animated UI, use the [generated starter](../docs/getting-started/quickstart-typescript.md).

Other examples predate the current public onboarding path. They require their
specific subsystem integrations and are not qualified by the new starter tests.
Do not use historical `fake://in-memory` configuration as a production authority;
the SDK has no implicit fake-broker fallback. The public local identity path
needs no OAS/Arsenal/AEGIS private source checkout or Life-hosted service.

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](../LICENSE-APACHE) or [MIT license](../LICENSE-MIT), at your option.
