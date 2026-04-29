# @openagent/mcp

OpenAgent middleware for the [Model Context Protocol](https://modelcontextprotocol.io).

Add OAS identity verification, Arsenal capability tokens, and AEGIS authorization to any MCP server in three lines.

## Install

```bash
npm install @openagent/mcp @modelcontextprotocol/sdk @openagent/sdk
```

## Server: add auth to MCP in 3 lines

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { withOpenAgent } from '@openagent/mcp';
import { agent } from './my-agent.js';

const server = new McpServer({ name: 'my-tools', version: '0.1.0' });

const authedServer = withOpenAgent(server, {
  agent,
  requireScopes: (toolName) => [`mcp:${toolName}:invoke`],
});

authedServer.registerTool(
  'search_web',
  { description: 'search the web', inputSchema: { q: z.string() } },
  async ({ q }) => ({ content: [{ type: 'text', text: `results for ${q}` }] }),
);
```

That is it. Every tool call now:

1. Pulls the identity envelope from `extra._meta.openagent.identity`.
2. Verifies it against your `IdentityVerifier` (OAS DID + Arsenal ACT + AEGIS policy).
3. Enforces the per-tool scopes returned by `requireScopes`.
4. Runs the optional `skillsPolicy` hook (consults SKILLS.md-style rules).
5. Runs the user's tool body.
6. Stamps `audit_id`, `verified_did`, and `scopes` into the response `_meta.openagent`.

## Client: sign every outbound call

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { withOpenAgentClient } from '@openagent/mcp';
import { agent } from './my-agent.js';

const client = new Client({ name: 'my-agent', version: '0.1.0' });
const authedClient = withOpenAgentClient(client, {
  agent,
  audience: 'did:oas:vendor:tools-server',
});

await authedClient.callTool({
  name: 'search_web',
  arguments: { q: 'mcp' },
});
```

The interceptor wraps `callTool` only — `listTools`, `listResources`, `getPrompt`, and every other client method pass straight through.

## Hooks

`withOpenAgent` accepts three optional hooks plus the skills policy:

```ts
withOpenAgent(server, {
  agent,
  preCall: ({ toolName, identity }) => {
    metrics.increment('mcp.tool.calls', { tool: toolName, did: identity.did });
  },
  postCall: ({ toolName, identity, durationMs, result }) => {
    audit.write({ tool: toolName, did: identity.did, ms: durationMs });
  },
  onError: ({ toolName, identity, error }) => {
    audit.writeError({ tool: toolName, did: identity?.did ?? null, error });
  },
});
```

## Skills policy

MCP tools and SKILLS.md entries describe the same thing — a capability an
agent can invoke. When an MCP server exposes a skill-like tool (default
matchers: `invoke_skill`, `run_skill`, `execute_skill`, `skill.invoke`,
`skill.run`), the middleware consults a policy hook before allowing the
call.

```ts
import {
  withOpenAgent,
  createSkillsPolicy,
  InMemorySkillsPolicyStore,
} from '@openagent/mcp';

const skillsPolicy = createSkillsPolicy({
  store: new InMemorySkillsPolicyStore([
    { skillName: 'cook_dinner', dids: ['did:oas:org:kitchen:agent:alice'] },
    { skillName: 'order_pizza', dids: null }, // any verified caller
  ]),
});

withOpenAgent(server, { agent, skillsPolicy });
```

You can also write your own store that reads from `SKILLS.md` files, a
remote service, or AEGIS policy bundles — just implement the
`SkillsPolicyStore` interface.

## Errors

Every middleware-rejected call surfaces a typed error:

| Error                          | Code     | When                                            |
| ------------------------------ | -------- | ----------------------------------------------- |
| `MissingIdentityError`         | `-32001` | `_meta.openagent.identity` was absent           |
| `IdentityVerificationError`    | `-32001` | The verifier rejected the envelope              |
| `AuthorizationDeniedError`     | `-32002` | Caller does not hold the required scopes        |
| `SkillsPolicyDeniedError`      | `-32003` | The skills policy hook returned `allow: false`  |

All extend `OpenAgentMcpError`, which carries a `code`, `message`, and
optional `data` payload — ready for serialization through the JSON-RPC
error envelope the MCP SDK expects.

## Configuration reference

```ts
interface OpenAgentMcpConfig {
  agent: Agent;
  requireScopes?: (toolName: string, args: unknown) => readonly string[];
  requireIdentity?: boolean;            // default: true
  skillsPolicy?: SkillsPolicyHook;
  preCall?: PreCallHook;
  postCall?: PostCallHook;
  onError?: ErrorHook;
  scopeFormat?: (toolName: string) => string;
}
```

## Versioning

This package is built against `@modelcontextprotocol/sdk@^1.27.0`. Both
the deprecated `tool(name, schema, cb)` overloads and the current
`registerTool(name, config, cb)` API are intercepted, so any 1.x server
works without code changes.

## Testing

```bash
npm test
```

The test suite uses [vitest](https://vitest.dev) and exercises the
middleware against both a synthetic MCP server and a real
`@modelcontextprotocol/sdk` server connected over the SDK's
`InMemoryTransport`.

## Documentation

- Spec: <https://openagent.id/docs/integrations/mcp>
- OpenAgent SDK: <https://openagent.id/docs/sdk>
- MCP: <https://modelcontextprotocol.io>

## License

Apache-2.0
