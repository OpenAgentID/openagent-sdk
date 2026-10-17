# Claude Agent SDK Integration

OpenAgentID identity, tool/skill policy and audit hooks for the Claude Agent SDK.
Compatible with OpenAgentID SDK 0.7 (from 0.7.2) and 0.8 (`^0.7.2 || ^0.8.0`); the native hook adapter is qualified
against `@anthropic-ai/claude-agent-sdk@0.3.296` and supports that `0.3` line.

```sh
npm install @openagentid/sdk @openagentid/claude-agent @anthropic-ai/claude-agent-sdk@^0.3.296
```

## Run without a model account

The [complete example](https://github.com/OpenAgentID/openagent-sdk/tree/main/examples/typescript/03-claude-agent-plugin)
creates separate signer/receiver workspaces and drives actual SDK-typed hook
inputs. Each permission check verifies a real signature and current receiver
trust. It proves allowed Read, denied Bash and rejection after revocation.

```sh
git clone https://github.com/OpenAgentID/openagent-sdk.git
cd openagent-sdk/examples/typescript/03-claude-agent-plugin
npm install
npm start
```

Use its `options.hooks` with the real harness:

```ts
import { query } from '@anthropic-ai/claude-agent-sdk';
// `options` is the configured hooks object from the complete example.
for await (const message of query({ prompt: 'Read README.md', options })) {
  if (message.type === 'result') console.log(message);
}
```

Calling `query` needs your normal model authentication and can incur model usage.
The offline example runs hooks and real cryptography without calling a model.

## Native hooks

`createOpenAgentHooks({ agent, capabilities, skillsPolicy?, audit? })` returns:

- `hooks`: assign directly to `query({ options: { hooks } })`.
- `inspectAudit(sessionId)`: inspect the current session's audit buffer.

Actual `SessionStart`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure` and
`SessionEnd` hooks are wired. Each session has its own lifecycle and audit chain.
`Skill` tool calls require both `sdkToolScope('Skill')` and the configured skill
policy (`sdkSkillScope(name)` by default). Native hooks use these scope helpers
to encode uppercase or punctuated names into the SDK scope grammar without
colliding with differently spelled tools. Use the helpers when granting scopes;
simple lowercase names retain their readable form. Exceptions and cancelled preflight
checks return an explicit native deny decision. Successful checks return `{}`,
so the host's normal permission rules still apply.

## Identity custody

Use `createSdkAgentIdentity(openAgentInstance)` to adapt a current SDK facade
agent. Pass a raw signer explicitly when message signing is needed:

```ts
const identity = createSdkAgentIdentity(agent, {
  publicKey: agent.document.publicKeyMultibase,
  sign: payload => oasProvider.signBytes(agent.did, payload),
});
```

Here `oasProvider` is the `createOasIdentityProvider` returned by
`@openagentid/sdk/integrations/oas`. Its real raw signing operation retains key
custody. The one-argument adapter does not expose a signer: an identity
provider's `signChallenge` result signs an assertion envelope, not raw message
bytes, and cannot be substituted for it. For workspace-only policy, use its exported public document
and verify possession/current trust in the capability checker, as the example does.
A DID string or public key alone does not establish identity trust.

Message signing is an explicit framework-independent feature of
`openAgentPlugin({ signMessages: true, ... })` and requires `agent.sign`.
The Claude SDK has no generic outbound `onMessage` signing hook; the adapter does
not pretend one exists. `openAgentPlugin` remains available for applications that
own their lifecycle and call its handlers directly.

## Migration from 0.1

Remove `options.plugins: [openAgentPlugin(...)]`. Claude's plugins option loads
plugin directories; it never accepted this lifecycle object. Replace it with
`options.hooks: createOpenAgentHooks(...).hooks`. Adapt SDK facade identities with
`createSdkAgentIdentity`, and recheck authoritative identity/scope state in the
capability checker rather than relying on mutable request claims.

`StaticCapabilityChecker` is an explicit application allowlist. Audit records
form a hash chain; persist them in your audit sink and anchor retained heads
externally when you need protection against wholesale history replacement.
