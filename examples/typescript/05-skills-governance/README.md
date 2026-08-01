# 05 — Skills Governance

Demonstrates skills governance: a `SKILLS.md` policy file that says what behavioral skills an agent can invoke, independent of its raw scopes. Shows allow/deny decisions, human approval prompts, and the audit trail.

## What it shows

- `SKILLS.md` parsing and policy compilation.
- `agent.skillsPolicy().canInvoke(name)` returning structured decisions.
- Skills that are always allowed (`web-search`).
- Skills that are always denied (`delete-file`).
- Skills that require a recent human approval (`send-email`).
- Skills that depend on the current time of day (`deploy-prod`).
- Every decision, logged with its reason.

## Run it

```bash
bun install
bun run start
```

You'll see a sequence of skill invocation attempts with the decision and reason for each:

```
[decision] skill=web-search allowed=true
[decision] skill=delete-file allowed=false reason=deny clause matched: allow: never
[decision] skill=send-email allowed=false reason=requires approval: approval.active for human:alice expired
[decision] skill=deploy-prod allowed=false reason=deny clause matched: now().hour < 9 or now().hour > 17
```

## Editing SKILLS.md

Open `./SKILLS.md` and change a policy — for example, flip `delete-file` from `allow: never` to `allow: always`, re-run, and watch the decision change. Skills governance is declarative: you don't touch agent code to change behavior.

## Try this next

- Add a rate limit clause: `allow: if rate.hourly("send-email") < 10`.
- Add a spend gate: `allow: if spend.daily(USD) < 100`.
- Write a skills test file (see [guide](../../../docs/guides/skills-governance.md)) and run `openagent skills test`.
- Use this pattern to gate tool invocations in [03-claude-agent-plugin](../03-claude-agent-plugin).

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](../../../LICENSE-APACHE) or [MIT license](../../../LICENSE-MIT), at your option.
