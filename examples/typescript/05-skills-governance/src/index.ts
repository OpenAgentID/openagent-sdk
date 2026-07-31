import { OpenAgent } from '@openagentid/sdk';

async function main() {
  OpenAgent.configure({
    brokerUrl: process.env.OPENAGENT_BROKER_URL ?? 'fake://in-memory',
    aegisUrl: process.env.OPENAGENT_AEGIS_URL ?? 'fake://in-memory',
    namespace: process.env.OPENAGENT_NAMESPACE ?? 'example',
  });

  const parent = process.env.OPENAGENT_PARENT_DID ?? 'did:oas:example:hmr:local-dev';

  const agent = await OpenAgent.createAgent({
    parent,
    name: 'governed-bot',
    scopes: [
      'tavily:search:invoke',
      'github:repo:write',
      'postmark:email:send',
      'deploy:prod:invoke',
    ],
  });

  const skillsAgent = await OpenAgent.loadAgent(agent.did, {
    skillsPolicyPath: new URL('../SKILLS.md', import.meta.url).pathname,
  });

  const policy = skillsAgent.skillsPolicy();

  console.log(`agent did=${skillsAgent.did}`);
  console.log(`skills loaded: ${policy.list().map((s) => s.name).join(', ')}\n`);

  const attempts = [
    { name: 'web-search', args: { query: 'autonomous agents' } },
    { name: 'delete-file', args: { path: 'README.md' } },
    { name: 'send-email', args: { to: 'alice@example.com' } },
    { name: 'deploy-prod', args: { service: 'api' } },
  ];

  for (const attempt of attempts) {
    const decision = policy.canInvoke(attempt.name, attempt.args);
    console.log(`[decision] skill=${decision.skill} allowed=${decision.allowed}${decision.reason ? ' reason=' + decision.reason : ''}`);
    if (decision.requiresApproval) {
      console.log(`           approvalPrompt: ${decision.approvalPrompt}`);
    }
  }

  console.log(`\nedit SKILLS.md to change policies and re-run — no code changes needed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
