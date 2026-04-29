import { OpenAgent, OpenAgentError } from '@openagent/sdk';

async function main() {
  OpenAgent.configure({
    brokerUrl: process.env.OPENAGENT_BROKER_URL ?? 'fake://in-memory',
    aegisUrl: process.env.OPENAGENT_AEGIS_URL ?? 'fake://in-memory',
    namespace: process.env.OPENAGENT_NAMESPACE ?? 'example',
  });

  const parentDid = process.env.OPENAGENT_PARENT_DID ?? 'did:oas:example:hmr:local-dev';

  // === Parent agent with broad scopes ===
  const parent = await OpenAgent.createAgent({
    parent: parentDid,
    name: 'RootBot',
    scopes: ['github:*:*', 'openai:chat:invoke', 'tavily:search:invoke'],
  });
  console.log(`parent did=${parent.did}`);
  console.log(`parent scopes=${JSON.stringify(parent.scopes)}\n`);

  // === Child delegation — strict subset ===
  const child = await parent.delegate({
    name: 'Worker',
    scopes: ['github:pulls:read', 'openai:chat:invoke'],
    expiresInMinutes: 30,
  });
  console.log(`child did=${child.did}`);
  console.log(`child scopes=${JSON.stringify(child.scopes)}`);
  console.log(`child lineage=${JSON.stringify(child.lineage)}\n`);

  // === Grandchild delegation — narrower still ===
  const grandchild = await child.delegate({
    name: 'Shard1',
    scopes: ['github:pulls:read'],
    expiresInMinutes: 10,
  });
  console.log(`grandchild did=${grandchild.did}`);
  console.log(`grandchild scopes=${JSON.stringify(grandchild.scopes)}`);
  console.log(`grandchild lineage=${JSON.stringify(grandchild.lineage)}\n`);

  // === Attempt to amplify — should fail ===
  console.log(`attempting amplification: grandchild trying to add github:pulls:write...`);
  try {
    await grandchild.delegate({
      name: 'BadShard',
      scopes: ['github:pulls:write'], // not held by any ancestor
    });
    console.log(`ERROR: amplification was NOT blocked — this is a bug!`);
  } catch (err) {
    if (err instanceof OpenAgentError && err.code === 'SCOPE_AMPLIFICATION') {
      console.log(`denied: ${err.code}: ${err.message}`);
    } else {
      throw err;
    }
  }

  console.log(`\n=== handing the child ACT to a worker ===`);
  console.log(`export AGENT_DID='${child.did}'`);
  console.log(`export AGENT_ACT='${child.actCompactString}'`);
  console.log(`the worker process calls OpenAgent.loadAgent(AGENT_DID, { act: AGENT_ACT })`);
  console.log(`and inherits exactly the child's scopes, lineage, and expiration.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
