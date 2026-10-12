# Skills governance

Use `createSkillsPolicyInvoker` with the published `@openagentid/skills-policy`
engine to keep authorization, arguments, consent, quotas and audit receipts on
the actual execution path.

## Run the complete example

```sh
cd examples/typescript/05-skills-governance
npm install
npm start
```

The [example](../../examples/typescript/05-skills-governance/src/index.ts) loads
[policy.yaml](../../examples/typescript/05-skills-governance/policy.yaml), proves
unknown-skill and invalid-argument denial, executes one permitted operation,
refuses the next invocation after its quota, and verifies the receipt hash chain.
Every assertion runs against the actual published policy package.

## Bind policy to invocation context

```ts
import { Did, InvocationContext, SkillsPolicy } from '@openagentid/skills-policy';
import { createSkillsPolicyInvoker } from '@openagentid/sdk/integrations/skills-policy';

export function bindPolicy(policy: SkillsPolicy, agentDid: string, sessionId: string) {
  return createSkillsPolicyInvoker({
    policy,
    agentDid,
    context: ({ arguments: args }) => new InvocationContext({
      agentDid: Did.parse(agentDid), sessionId, arguments: args,
    }),
  });
}
```

The host authenticates the agent and session before calling this helper. Invoke
`await invoker.invoke(skill, args, () => actualOperation(args))`; successful
results include `{ result, receipt }`. The adapter requires the policy's agent,
context's agent, actual argument object and a nonempty session to agree. It calls
`recordInvocation` before executing the operation, so denial never runs the
callback and an accepted invocation consumes its quota.

Policy YAML uses actual fields such as `arg_constraints`, `rate_limit`,
`time_windows`, `require_consent` and `audit_level`. Supply consent through the
trusted context factory only after the application's real approval flow.
A receipt records authorization/invocation; operation success/failure belongs
in the host's result log. Persist audit receipts and trusted heads where durable
history is required; an in-memory chain alone is not a durable audit service.

## Lightweight allowlists

For simple local checks, the SDK root still exports `InMemorySkillsPolicy`.
It implements `canInvoke(skill): boolean`, `assertCanInvoke(skill)`,
`listAllowed()`, `grant(skill)` and `revoke(skill)`. Grant/revoke return a new
immutable policy; exact names and suffix wildcards are supported. Agent creation
accepts `skills`, and `withSkillsPolicy(policy)` returns a new agent instance.

The contextual policy engine and the boolean allowlist have different
contracts. The new adapter preserves the full contextual workflow instead of
casting away arguments or quota accounting. `SKILLS.md` discovery manifests
remain separate from authorization YAML.

Keep tenant permission, provider capabilities and environment/sandbox controls
at their action boundaries. See [request authentication](authenticating-requests.md),
[credential transport](managing-credentials.md) and the
[component integration contracts](../../sdks/typescript/INTEGRATION_NOTES.md).
