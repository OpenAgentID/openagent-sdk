# MCP Integration

The public SDK's identity verifier can authenticate evidence at a host's tool
boundary. The repository also contains a separate MCP adapter source package
under `integrations/mcp/typescript`; it is not a
`@openagentid/sdk/mcp` subpath or an automatic hosted MCP authority.

## Adapter contract

The separate source package exports `withOpenAgent`, `withOpenAgentClient`,
`buildIdentityMeta`, skills helpers and typed verification/policy errors.
Check its actual manifest/dependency access and MCP host API before adopting it;
source availability does not certify current public distribution or
compatibility with every MCP release.

Its server wrapper intercepts `tool` and `registerTool` callbacks. The caller's
identity is extracted from per-call `_meta.openagent.identity` as
`{did, proof, nonce?, context?}`. Proof is opaque to this wrapper. The host's
`agent.verifier.verify(identity, requiredScopes)` must authenticate the actual
proof format, trusted issuer/key/root, audience/nonce, revocation, tenant and
operation permission; merely decoding metadata is not verification.

`withOpenAgent(server, config)` requires an adapter `Agent` with `did`, a
`verifier` and `signRequest(toolName, audience?)`. This is not the public
`OpenAgentInstance` or SDK `IdentityVerifier` interface; adapt them explicitly
rather than assuming structural compatibility. The verifier returns the
adapter's `{did, scopes, auditId, claims}` from trusted checks.

Required scopes default to `mcp:<tool>:invoke` and can be derived by configured
`requireScopes`/`scopeFormat`. Optional hooks are `skillsPolicy`, `preCall`,
`postCall` and `onError`. Keep `requireIdentity` enabled on protected tools;
disabling it permits an anonymous path, not a verified local identity.

## Client and transport

`withOpenAgentClient(client, {agent, audience?, beforeCall?})` wraps outbound
`callTool`, calls the actual signing adapter and attaches identity metadata.
`buildIdentityMeta` is metadata construction, not a grant of trust. Bind the
intended audience and obtain a fresh server-authorized challenge according to
the chosen proof protocol.

The implementation's identity travels on the tool call, not an invented
`clientInfo.openagent` initialize-handshake extension. Configure the actual
stdio/HTTP host transport and accepted proof format. A local possession JWT,
ACT and an adapter's opaque proof string are not interchangeable unless an
explicit verifier adapter handles them correctly.

## Host responsibilities

Authenticate and authorize before side effects, validate tool arguments,
restrict outbound credential targets and maintain durable replay/root policy.
Visibility of a tool is UX; a direct call must still pass its permission guard.
The unified SDK exposes no `authenticateHandshake`, `scopeMatches` or
`OpenAgent.audit()` helper. Use real exported verifiers and host policy, not
runnable-looking unsupported methods.

The adapter may return `audit_id`/`verified_did` result metadata. That does not
certify durable logging. A post-call hook cannot undo a completed side effect;
implement actual storage/failure policy and safe retries.
[Audit responsibilities](audit-and-compliance.md).

Source: [`types.ts`](../../integrations/mcp/typescript/src/types.ts),
[`server.ts`](../../integrations/mcp/typescript/src/server.ts),
[`client.ts`](../../integrations/mcp/typescript/src/client.ts) and
[`index.ts`](../../integrations/mcp/typescript/src/index.ts).
Start with [the public developer path](../developer-tooling.md) and
[identity verification](../identity-verification.md).
