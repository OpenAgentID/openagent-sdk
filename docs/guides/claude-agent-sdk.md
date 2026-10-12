# Agent Harness Integration

OpenAgentID identity, capabilities and skill policy can be attached to a host
agent loop. The repository includes the separate Claude Agent SDK integration
source under `integrations/claude-agent-sdk`; the public unified SDK has no
`@openagentid/sdk/claude-agent` subpath. The public starter does not require
this harness or integration package.

## Actual source contract

The TypeScript integration entry exports `openAgentPlugin` plus lifecycle/tool/
skill hooks, capability and skills-policy interfaces, and component audit
primitives. Its actual `OpenAgentPluginOptions` requires:

- `agent: OpenAgentIdentity`, supplied by the host's real identity custody.
- `capabilities: CapabilityChecker`, implementing the chosen authoritative
  permission contract.
- Optional `skillsPolicy`, `audit`, `signMessages` and `denyMode`.

`openAgentPlugin` returns the component's own hook object. The host must wire
those hooks into its exact installed harness API before operations occur.
Placing an arbitrary object into a host's `plugins` array is not proof its
callbacks are called or refusals block execution. Package names in the source
manifest do not establish current public availability or compatibility with a
particular external harness release.

The hooks include `onSessionStart`, `preToolUse`, `postToolUse`, `onMessage`,
`onSkillInvoke` and `onSessionEnd`, with typed context/input/result structures.
Use the actual source types; the integration `OpenAgentIdentity` and checker
are not automatically a unified `OpenAgentInstance` or an authenticated human
owner. A static capability checker is configured policy data, not proof that a
broker authorized the caller.

## Wire real authority and controls

Before granting tools, verify the accepted proof/root/revocation/replay under
[current identity authority](../identity-verification.md). Adapt the result and
application permission to the component's identity/checker interfaces. Keep
trusted keys, audience, tenant and requested scopes under host control.

Call the pre-tool/skill guard before side effects and honor its denial result or
exception; invoke post-tool hooks only after the actual outcome. Validate
arguments and outbound targets separately. The source has no automatic parent
`.delegate()` or human-approval UI, subagent high-risk-scope filter, paused-run
consent workflow or unified credential injection. Provision child identity and
permissions through the actual signer/issuer contracts.

## Audit and message signing

`audit: true` selects memory plus console sinks; it does not provision durable
storage. A custom `AuditSink` must use the host's actual custody/failure policy.
Component audit chains swallow sink failures, so hook success cannot certify
compliance delivery. There is no `OpenAgent.audit(...).forRun()` query DSL.
[Audit responsibilities](audit-and-compliance.md).

Optional message signing uses the real supplied identity signer and its exact
message contract. The host/receiver still validates the signed content,
recipient and accepted key policy; a signature callback is not a registered
Messages transport or proof that an agent profile can reply.

Source: [`plugin.ts`](../../integrations/claude-agent-sdk/typescript/src/plugin.ts),
[`hooks.ts`](../../integrations/claude-agent-sdk/typescript/src/hooks.ts),
[`types.ts`](../../integrations/claude-agent-sdk/typescript/src/types.ts) and
[`index.ts`](../../integrations/claude-agent-sdk/typescript/src/index.ts).
Use the [public starter and CLI](../developer-tooling.md) for a complete
account-free first-run application; adopt a harness integration only with its
real dependency, adapter and custody contracts.
