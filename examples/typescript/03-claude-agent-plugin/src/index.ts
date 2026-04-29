import { OpenAgent } from '@openagent/sdk';
import { ClaudeAgent, openagentPlugin } from './mock-claude-agent.js';

async function main() {
  OpenAgent.configure({
    brokerUrl: process.env.OPENAGENT_BROKER_URL ?? 'fake://in-memory',
    aegisUrl: process.env.OPENAGENT_AEGIS_URL ?? 'fake://in-memory',
    namespace: process.env.OPENAGENT_NAMESPACE ?? 'example',
  });

  const parent = process.env.OPENAGENT_PARENT_DID ?? 'did:oas:example:hmr:local-dev';

  // Mint the agent the Claude harness will act as.
  const openagent = await OpenAgent.createAgent({
    parent,
    name: 'pr-review-bot',
    scopes: ['github:pulls:read', 'github:pulls:comment', 'openai:chat:invoke'],
    // NB: no github:pulls:merge — merging is denied structurally.
  });

  // Load the skills policy from SKILLS.md beside this file.
  const skillsAgent = await OpenAgent.loadAgent(openagent.did, {
    skillsPolicyPath: new URL('../SKILLS.md', import.meta.url).pathname,
  });

  const claude = new ClaudeAgent({
    model: 'claude-sonnet-4-6',
    plugins: [openagentPlugin({ agentDid: skillsAgent.did, skillsPolicyPath: 'SKILLS.md' })],
  });

  claude.setOpenAgent(skillsAgent);

  claude.on('openagent:decision', (evt) => {
    console.log(`[audit] decision tool=${evt.tool} allowed=${evt.allowed} reason=${evt.reason ?? ''}`);
  });

  claude.on('openagent:needs-approval', (evt) => {
    console.log(`[audit] needs-approval skill=${evt.skill} reason=${evt.reason}`);
  });

  // Allowed: has the scope, skill policy allows.
  claude.defineTool({
    name: 'draft_pr_comment',
    description: 'Draft a comment on a pull request.',
    parameters: {},
    metadata: {
      openagent: {
        scopes: ['github:pulls:comment', 'openai:chat:invoke'],
        skill: 'draft-pr-comment',
      },
    },
    handler: async (_args, ctx) => {
      const openai = await ctx.openagent.credentialsFor('openai');
      void openai; // in a real run, call the chat endpoint here
      return { drafted: 'LGTM — minor nit on the null-check in line 42.' };
    },
  });

  // Denied by missing scope.
  claude.defineTool({
    name: 'merge_pr',
    description: 'Merge a pull request.',
    parameters: {},
    metadata: {
      openagent: {
        scopes: ['github:pulls:merge'],
        skill: 'merge-pr',
      },
    },
    handler: async () => {
      throw new Error('should never reach here');
    },
  });

  await claude.run('Review PR #42 and post a comment. Merge if safe.');

  console.log(`\ndemo complete. audit trail printed above.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
