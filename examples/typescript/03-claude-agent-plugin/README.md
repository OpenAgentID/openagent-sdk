# 03 — Claude Agent SDK Plugin

Shows how to drop OpenAgent into an existing Claude Agent SDK run as a plugin. Every tool call the agent makes gets gated by scopes, every credential fetch goes through the Arsenal broker, and skills are governed by a `SKILLS.md` file.

## What it shows

- `openagentPlugin` installation in a Claude Agent SDK builder.
- Tool metadata declaring required scopes and skill names.
- Automatic delegation for sub-agents (scopes contract, never amplify).
- Human-approval hooks via the `openagent:needs-approval` event.
- The audit log entries you see for an entire run.

## Run it

```bash
bun install
bun run start
```

The example uses a mocked Claude Agent SDK (`src/mock-claude-agent.ts`) so it runs without an API key. The point is to show the integration shape, not to actually call Claude. Swap the import for the real SDK to run against production.

## Key moments

1. The agent is created with a narrow scope set: `['github:pulls:read', 'github:pulls:comment', 'openai:chat:invoke']`.
2. The plugin is installed with `skillsPolicyPath: './SKILLS.md'`.
3. A `draft_pr_comment` tool is declared with `metadata.openagent.scopes = ['github:pulls:comment']` and `metadata.openagent.skill = 'draft-pr-comment'`.
4. A `merge_pr` tool is declared with `metadata.openagent.scopes = ['github:pulls:merge']` — which the agent does not hold. The plugin denies the call structurally.
5. The skills policy on `merge-pr` says `allow: never`, so even if the scope were present, the skills layer would still deny.
6. Every decision is logged to the audit chain printed at the end.

## SKILLS.md

See `./SKILLS.md` for the policy file. Edit it to change what the agent can invoke without touching the code.

## Try this next

- Change `draft-pr-comment` to require a human approval window and watch the run pause.
- Add a `scopes` entry to allow `merge_pr` and observe that it's still denied by the skills policy (defense in depth).
- Compare the audit log between a successful and a denied run.

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](../../../LICENSE-APACHE) or [MIT license](../../../LICENSE-MIT), at your option.
