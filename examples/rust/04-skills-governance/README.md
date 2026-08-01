# 04 — Skills Governance (Rust)

Demonstrates the `SKILLS.md` policy layer in Rust. An agent is loaded with a skills file, and the example runs a sequence of skill invocation attempts, printing the decision and reason for each.

## What it shows

- `OpenAgent::load_agent_with_skills(did, path)`.
- `agent.skills_policy().can_invoke(name, &args)`.
- Structured `PolicyDecision` with `allowed`, `reason`, `requires_approval`, `approval_prompt`.
- Editing `SKILLS.md` to change behavior without touching code.

## Run it

```bash
cargo run
```

Expected output (timestamps will vary):

```
agent did=did:oas:example:agent:...
skills loaded: web-search, delete-file, send-email, deploy-prod

[decision] skill=web-search allowed=true
[decision] skill=delete-file allowed=false reason=deny clause matched: allow: never
[decision] skill=send-email allowed=false reason=requires approval: approval.active for human:alice
[decision] skill=deploy-prod allowed=false reason=deny clause matched: now().hour < 9 or now().hour > 17
```

## SKILLS.md

Open `./SKILLS.md` and edit a policy — flip `delete-file` to `allow: always`, re-run, and observe the decision change. The skills governance layer is declarative.

## Try this next

- Add a `rate.hourly` clause to `deploy-prod`.
- Add a `spend.daily(USD) < 100` gate to an LLM-using skill.
- Write a test fixture (`skills.test.yaml`) and run `openagent skills test` against it.
- Compare with the TypeScript example in [../../typescript/05-skills-governance](../../typescript/05-skills-governance) — the behavior is identical.

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](../../../LICENSE-APACHE) or [MIT license](../../../LICENSE-MIT), at your option.
