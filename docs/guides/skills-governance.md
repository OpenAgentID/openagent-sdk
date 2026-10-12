# Skills Governance

The public SDK 0.7.2 has a small immutable skills allowlist. It is separate
from the specialized `openagent-skills-policy` source component, service
capability authorization and actual tool argument validation.

## Public allowlist contract

`SkillsPolicy` exposes `canInvoke(skill): boolean`, `assertCanInvoke(skill)`,
`listAllowed()`, `grant(skill)` and `revoke(skill)`. `InMemorySkillsPolicy`
supports exact names and suffix wildcards. Grant/revoke return a new policy;
missing matches deny. `assertCanInvoke` throws `SkillDeniedError` on refusal.

```ts
import { InMemorySkillsPolicy, type SkillsPolicy } from '@openagentid/sdk';

export async function invokeAllowed<T>(
  policy: SkillsPolicy,
  skill: string,
  invoke: () => Promise<T>,
): Promise<T> {
  policy.assertCanInvoke(skill);
  return invoke();
}

export const repositoryPolicy = new InMemorySkillsPolicy(['read-file']);
```

The application approves the policy and authenticates/authorizes the caller
before invoking the guard. This function permits no input validation, tenant
access or capability budget merely from a skill name. Do not expose an
unrestricted mutation of the allowlist as remote authorization.

`OpenAgentInstance.skillsPolicy()` returns the configured policy;
`withSkillsPolicy(policy)` returns a new instance. `OpenAgentRuntime.loadAgent`
accepts a DID and optional skill-name array, not `{skillsPolicyPath}`. Creation
accepts optional `skills`; absent skills default to deny-all.

## Specialized policy source

`crates/openagent-skills-policy/typescript` separately exports `SkillsPolicy`,
`InvocationContext`, `SkillsManifest`, `RateLimiter`, typed rule/constraint
errors and invocation receipt `AuditChain`. Its
[`engine.ts`](../../crates/openagent-skills-policy/typescript/src/engine.ts),
[`schema.ts`](../../crates/openagent-skills-policy/typescript/src/schema.ts) and
[`skillsMd.ts`](../../crates/openagent-skills-policy/typescript/src/skillsMd.ts)
define the actual versioned YAML/Markdown and consent/time/rate/argument
contracts. A source manifest is not a current public package-release promise.

That specialized class does not have the same boolean interface as the small
unified facade. Write an explicit adapter for the exact source API and wire it
before actual execution. Real consent, clock and rate state belong to the
selected deployment; there is no automatic human approval UI, broker spend
oracle or universal expression DSL in the public allowlist.

## Audit and enforcement

Record actual permission decisions at the application boundary and preserve a
real durable sink when needed. Specialized invocation receipts are component
records, not proof every denied/allowed tool call was captured. The public
allowlist has no automatic hash-chain audit, compliance profiles or `oaid
skills test` command. [Audit responsibilities](audit-and-compliance.md).

Keep arguments, environment/sandbox controls, provider scope and tenant
permission checks at their corresponding action boundaries. A local allowlist
is not a tamper-proof remote permission store. See
[request authentication](authenticating-requests.md) and
[developer tooling](../developer-tooling.md).
