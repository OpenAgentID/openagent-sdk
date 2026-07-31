# Skills Governance

Scopes say "you can call OpenAI." Skills say "you know how to draft a PR comment." The two are distinct layers: scopes gate *API access*, skills gate *behavioral abilities*. OpenAgent governs skills through a `SKILLS.md` policy file that lives next to your agent code.

## The SKILLS.md file

```markdown
# SKILLS.md

## web-search
description: Search the web for factual information.
scopes: [tavily:search:invoke]
policy:
  allow: always

## draft-pr-comment
description: Draft a comment on a pull request.
scopes: [github:pulls:comment, openai:chat:invoke]
policy:
  allow: if ctx.lineage[0] == "did:oas:acme:hmr:alice"

## merge-pr
description: Merge a pull request.
scopes: [github:pulls:merge]
policy:
  allow: if approval.active("human:alice", maxAgeSeconds=300)
  deny: if now().hour < 9 or now().hour > 17

## delete-file
description: Delete a file from the repo.
scopes: [github:repo:write]
policy:
  allow: never
```

Each skill has a name, a description, a scope list, and a policy block. The policy is a small DSL: `allow:`, `deny:`, each followed by `always`, `never`, or an `if <expression>`. Expressions have access to a context (`ctx.*`), the clock (`now()`), the skill arguments (`args.*`), a set of attestations like recent human approvals (`approval.active(...)`), a rate limiter (`rate.*`), and a spend counter (`spend.*`).

The file is parsed once at agent boot, compiled to a policy AST, and evaluated on every `canInvoke` call. Typical overhead is under 10 microseconds per check.

## Wiring into your agent

```ts
import { OpenAgent } from '@openagentid/sdk';

const agent = await OpenAgent.loadAgent(process.env.AGENT_DID!, {
  skillsPolicyPath: './SKILLS.md',
});

// Later, inside your agent loop:
const policy = agent.skillsPolicy();
const decision = policy.canInvoke('draft-pr-comment', { prNumber: 42 });

if (!decision.allowed) {
  console.log(`skill denied: ${decision.reason}`);
  return;
}

await invokeSkill('draft-pr-comment', { prNumber: 42 });
```

```rust
let agent = OpenAgent::load_agent_with_skills(&did, Path::new("./SKILLS.md")).await?;

let policy = agent.skills_policy();
let decision = policy.can_invoke("draft-pr-comment", &json!({ "prNumber": 42 }))?;

if !decision.allowed {
    tracing::warn!(reason = %decision.reason, "skill denied");
    return Ok(());
}

invoke_skill("draft-pr-comment", json!({ "prNumber": 42 })).await?;
```

`canInvoke` always returns a decision object, never throws. The `reason` field is a structured explanation — "deny clause matched: now().hour < 9", or "allow clause not satisfied: approval.active for human:alice expired 412 seconds ago". You can render this to your UI or your logs without worrying about information disclosure (policies have no secrets in them).

## Human-in-the-loop approvals

The most important policy predicate is `approval.active(identity, maxAgeSeconds)`. It checks whether a specific human has issued an approval token for the current agent within a time window. This is how OpenAgent expresses "don't do the destructive thing unless a human just said okay."

Approvals are minted via a separate flow (usually a mobile or web UI where the human gets pinged with a notification). The approval itself is a signed token that says "I, alice, approve did:oas:acme:agent:WorkerBot to perform skill:merge-pr for the next 300 seconds." It lives in the AEGIS verification service and is queried by `approval.active`.

A typical approval UX: the agent attempts the skill, the policy denies with `reason: 'requires human approval'`, your agent code surfaces a prompt to the human via Slack/Taps/webhook, the human approves in their UI, the agent retries, and the second attempt succeeds. Your agent code never handles approval tokens directly — it just retries the skill after a wait.

## Cost and rate limits

```markdown
## expensive-llm-call
description: Use the most expensive model.
scopes: [openai:chat:invoke]
policy:
  allow: if spend.daily(USD) < 50 and rate.hourly("expensive-llm-call") < 10
```

`spend.daily(USD)` reads from the broker's per-agent spend counter (the broker knows how much each agent has cost because it proxies every API call). `rate.hourly(skill_name)` reads from a per-agent rolling window.

These counters are authoritative on the broker side, not just advisory. A compromised agent cannot rewrite them — if the policy says "daily < 50," the broker will start returning `PolicyDenied` at $50.01 no matter what the agent does.

## Denial audit trail

Every policy decision — allow or deny — is written to the agent's audit log with a hash chain. You can replay the audit log offline and verify that no entries were altered or removed. This is what makes skills governance defensible in a compliance review: you can show an auditor "here are the 14 times this agent attempted `merge-pr`, 2 succeeded because alice approved within the window, 12 were denied because the window had closed."

The audit log entry format is documented in [wire-formats.md](../reference/wire-formats.md).

## Testing policies

OpenAgent ships a policy test harness. You write scenario fixtures in a YAML file and the harness runs them against your `SKILLS.md`:

```yaml
# skills.test.yaml
- name: merge requires recent approval
  skill: merge-pr
  context:
    approvals:
      - identity: human:alice
        age_seconds: 60
        target_skill: merge-pr
  now: '2026-01-01T10:30:00Z'
  expect: allow

- name: merge denied outside business hours
  skill: merge-pr
  context: { approvals: [] }
  now: '2026-01-01T22:00:00Z'
  expect: deny
```

Run with `openagent skills test skills.test.yaml`. The tests execute in under a millisecond each and are ideal for CI.

## What skills don't cover

Skills govern *what* an agent can invoke. They do not govern *what inputs* a skill receives — validating and sanitizing arguments is still the responsibility of the skill implementation. Skills do not govern *how often* a scope is exercised outside of named skill invocations — for that, use broker rate limits. And skills don't cover the raw execution environment — for that, run the skill inside an Omega WASM sandbox.

Next: [MCP integration](mcp-integration.md).
