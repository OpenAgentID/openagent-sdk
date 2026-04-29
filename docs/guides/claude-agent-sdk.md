# Claude Agent SDK Integration

The Claude Agent SDK (the library behind Claude Code and similar agent harnesses) runs agents that invoke tools, read files, make HTTP calls, and consult skill definitions. OpenAgent drops into that harness as a plugin, wiring identity, capabilities, and skills governance into an existing agent loop without rewriting your agent logic.

## What the integration does

When installed as a plugin, OpenAgent intercepts three surfaces:

1. **Tool invocation.** Before any tool call, OpenAgent checks whether the current agent identity has the scopes the tool declares. If not, the call is denied with a structured error the harness can surface to the model.
2. **Credential injection.** When a tool needs an API key (OpenAI, GitHub, etc.), it asks OpenAgent, and OpenAgent hands back a fetch-shaped object that goes through the Arsenal broker. The raw credential never enters the process.
3. **Skills consultation.** Before the harness advertises a named skill to the model, OpenAgent's skills policy is consulted. Skills whose current context would deny invocation are hidden from the advertised list (or flagged with a "requires approval" marker for human-in-the-loop skills).

The integration is a one-line install and a configuration block.

## TypeScript — installing the plugin

```ts
import { ClaudeAgent } from '@anthropic/claude-agent-sdk';
import { openagentPlugin } from '@openagent/sdk/claude-agent';

const agent = new ClaudeAgent({
  model: 'claude-sonnet-4-6',
  tools: [...],
  plugins: [
    openagentPlugin({
      agentDid: process.env.AGENT_DID!,
      skillsPolicyPath: './SKILLS.md',
    }),
  ],
});

await agent.run('Summarize yesterday\'s PR activity and post a report to #engineering');
```

That's it. Once the plugin is in the plugin list, every tool call the agent makes is gated, every credential fetch goes through the broker, and every skill invocation consults the policy. You can watch the intercepts via `agent.on('openagent:decision', d => console.log(d))` which fires on every allow/deny decision.

## Rust — installing the plugin

```rust
use claude_agent_sdk::ClaudeAgent;
use openagent_sdk::claude_agent::plugin as openagent_plugin;
use std::path::Path;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let agent = ClaudeAgent::builder()
        .model("claude-sonnet-4-6")
        .plugin(openagent_plugin::builder()
            .agent_did(std::env::var("AGENT_DID")?)
            .skills_policy(Path::new("./SKILLS.md"))
            .build()?)
        .build()?;

    agent.run("Summarize yesterday's PR activity and post a report to #engineering").await?;
    Ok(())
}
```

## Tool declarations

For the plugin to gate a tool correctly, the tool needs to declare what scopes it requires. The Claude Agent SDK has a metadata field for this:

```ts
agent.defineTool({
  name: 'github_create_pr',
  description: 'Open a pull request against the repo.',
  metadata: {
    openagent: {
      scopes: ['github:pulls:write'],
      skill: 'draft-pr',   // optional: also consult the skills policy
    },
  },
  parameters: { /* ... */ },
  handler: async (args, ctx) => {
    const github = await ctx.openagent.credentialsFor('github');
    return github.post('https://api.github.com/...', { /* ... */ });
  },
});
```

At invocation time, the plugin:

1. Checks `ctx.openagent.hasScope('github:pulls:write')` — throws `ScopeDenied` if missing.
2. If `skill` is set, consults the skills policy via `canInvoke('draft-pr', args)` — throws `PolicyDenied` with a reason if denied.
3. Exposes the `ctx.openagent.credentialsFor(...)` surface to the handler, already bound to the current agent.

The agent's plugin context is `ctx.openagent`, which holds a ready-to-use `Agent` object for the current run.

## Human approval hooks

When a skill policy denies a call because it requires a human approval, the plugin emits a `needs-approval` event instead of a hard failure. You can wire this to Slack, email, a mobile push, or a web UI:

```ts
agent.on('openagent:needs-approval', async (evt) => {
  const url = await sendSlackApprovalPrompt(evt.skill, evt.args, evt.reason);
  console.log(`approval requested: ${url}`);
});
```

The agent run pauses. When the human approves (via whatever UI you built, which creates an approval token in AEGIS), the policy re-evaluates on the next attempt and the run continues. If the human denies or times out, the run fails with a reason that rolls up into the model's context so it can recover gracefully.

## Delegated sub-agents

The Claude Agent SDK spawns sub-agents for parallel task execution. When the plugin is active, every sub-agent is automatically delegated from the parent:

```ts
const child = await ctx.openagent.delegate({
  name: 'subtask-1',
  scopes: ctx.openagent.scopes.filter(s => s !== 'github:pulls:merge'),
  expiresInMinutes: 30,
});
```

Sub-agents inherit a strict subset of the parent's scopes — the plugin enforces this automatically when the harness calls `spawnSubAgent`. You can override the subset policy if you want finer control, but the default is "everything the parent has, minus high-risk scopes."

## Audit log correlation

Every decision, every credential fetch, and every tool call gets tagged with the Claude Agent SDK's run ID and task ID. You can replay an entire agent run from the audit log:

```ts
const entries = await OpenAgent.audit(ctx.openagent.did).forRun(runId);
for (const e of entries) {
  console.log(`${e.timestamp} ${e.kind} ${e.decision} ${e.reason ?? ''}`);
}
```

This is especially useful for debugging: when a run fails mysteriously, the audit log tells you exactly which tool was denied, what scope was missing, and which policy clause fired.

## Stdio-mode MCP servers as Claude Agent tools

If your agent runs an MCP server as a tool, and that MCP server itself uses OpenAgent, the two integrate cleanly: the outer agent's delegated ACT is passed to the MCP server via the `clientInfo.openagent` handshake field, and the MCP server authenticates as if the outer agent called it directly. No double-wrapping required.

Next: [multi-chain wallets](multi-chain-wallets.md).
