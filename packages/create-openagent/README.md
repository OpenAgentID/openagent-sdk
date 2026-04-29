# create-openagent

Scaffold an OpenAgent project in seconds.

## Usage

```bash
npx create-openagent my-agent-app
```

## Templates

| Template | Description |
|----------|-------------|
| `agent` | Standalone agent with identity and tools |
| `mcp-server` | MCP server with OpenAgent auth middleware |
| `web-dashboard` | Next.js dashboard for agent management |
| `full-stack` | All three combined |

## Options

```
--template <type>    agent | mcp-server | web-dashboard | full-stack
--adapter <type>     http | websocket | grpc
--bridge <type>      oidc | scim | none
--deploy <target>    cloudflare | vercel | aws | docker | local
--bioagentic         Include Bioagentic entity classification
--fabrics            Include Fabrics routing
```

## Non-Interactive Mode

```bash
npx create-openagent my-app --template agent --deploy docker --adapter http --bridge none
```

## Learn More

- [OpenAgent Docs](https://openagent.id/docs)
- [OAS Specification](https://openagent.id/spec)
