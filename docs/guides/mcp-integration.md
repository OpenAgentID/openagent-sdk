# MCP Integration

Authenticated Model Context Protocol tools using the current OpenAgentID SDK.
Works with SDK `^0.7.2` and MCP SDK `^1.27.0`.

```sh
npm install @openagentid/sdk@^0.7.2 @openagentid/mcp@0.2.0 @modelcontextprotocol/sdk@^1.27.0 zod
```

## Run a real server and client

The [complete stdio example](https://github.com/OpenAgentID/openagent-sdk/tree/main/examples/typescript/02-mcp-server)
creates real Ed25519 identities in separate signer and receiver workspaces,
starts a separate MCP server process, authenticates a tool call and verifies
unsigned and revoked callers are rejected. It needs no hosted account or API key.

```sh
git clone https://github.com/OpenAgentID/openagent-sdk.git
cd openagent-sdk/examples/typescript/02-mcp-server
npm install
npm start
```

## Current SDK adapters

`createWorkspaceMcpServer({ workspace, did, authorize })` returns an `agent`
for `withOpenAgent(server, { agent })` and an `issueChallenge` method.
Expose challenge issuance on your trusted MCP transport before wrapping the
server. `authorize(verifiedIdentity)` obtains scopes from your receiver policy.
Identity trust alone never grants tool access.

`createWorkspaceMcpClient({ workspace, did, audience, issueChallenge })` returns
an agent for `withOpenAgentClient(client, { agent })`. Its challenge callback
calls the receiver's challenge endpoint. The audience is explicit and must
match the receiver; no keys travel in request metadata.

The receiver binds each nonce to the DID, tool name and canonical JSON arguments.
The SDK verifies the signature, current trust, revocation and replay state. The
middleware then checks `mcp:<tool>:invoke` scopes and any configured skills policy.
Argument-changing `beforeCall` hooks run **before** signing. Custom verifiers
receive the original transmitted tool request as their third argument, captured
at the public MCP transport boundary before schema parsing. Authorization policies
and tool handlers receive the parsed arguments. Defaults, coercion, transforms and
unknown-field stripping therefore work without weakening request binding.

The workspace adapter is a single-process challenge coordinator backed by durable
SDK trust/replay state. Keep one adapter alive for the process lifetime. Restart
invalidates outstanding challenges. Distributed deployments should supply a
shared atomic challenge authority through the custom `Agent` contract. The standard MCP server transport
keeps raw request context isolated across asynchronous concurrent calls. Custom
server implementations without a transport use the arguments they pass directly
to the middleware callback.

## Policy and audit

- `requireScopes(toolName, args)` overrides the per-tool scope set.
- `scopeFormat(toolName)` customizes the default scope name.
- `createSkillsPolicy` rejects unlisted skill names and unauthorized DIDs.
- `preCall`, `postCall` and `onError` receive verified identity context.
- Results include `_meta.openagent` with `verified_did`, scopes and an audit ID.

`requireIdentity: false` explicitly permits anonymous calls; do not enable it
on protected tools. Callbacks and bespoke `Agent` implementations are trusted
application configuration, not substitutes for signature verification.

## Migration from 0.1

The SDK's `OpenAgentInstance` was never the adapter's `Agent` interface. Use the
workspace factories or implement the declared signing/verifier contract. The
new factories make that conversion explicit and exercise the current SDK with
real keys. Existing custom adapters remain supported; bind the verifier's new
`request` argument to your signed request data.
