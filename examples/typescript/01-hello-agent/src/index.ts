import { OpenAgent } from '@openagent/sdk';

async function main() {
  OpenAgent.configure({
    brokerUrl: process.env.OPENAGENT_BROKER_URL ?? 'fake://in-memory',
    aegisUrl: process.env.OPENAGENT_AEGIS_URL ?? 'fake://in-memory',
    namespace: process.env.OPENAGENT_NAMESPACE ?? 'example',
  });

  const parent = process.env.OPENAGENT_PARENT_DID ?? 'did:oas:example:hmr:local-dev';

  // === 1. Create an agent ===
  const agent = await OpenAgent.createAgent({
    parent,
    name: 'hello-world',
    scopes: ['openai:chat:invoke'],
  });

  console.log(`minted ${agent.did}`);
  console.log(`scopes: ${JSON.stringify(agent.scopes)}`);
  console.log(`expires: ${agent.expiresAt.toISOString()}`);

  // === 2. Authenticate a synthetic request carrying the agent's ACT ===
  const fakeRequest = new Request('http://localhost:3000/hello', {
    method: 'POST',
    headers: {
      'authorization': `OpenAgent ${agent.actCompactString}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ message: 'hello' }),
  });

  const ctx = await OpenAgent.authenticate(fakeRequest);
  console.log(`auth context did: ${ctx.did}`);
  console.log(`auth context lineage: ${JSON.stringify(ctx.lineage)}`);

  // === 3. Get a credential proxy ===
  const openai = await agent.credentialsFor('openai');
  console.log(`credential proxy ready for service=openai`);

  // The proxy is fetch-compatible. In a real program we'd call:
  //   const res = await openai.post('https://api.openai.com/v1/chat/completions', { ... });
  // The credentials are injected by the broker — this process never sees them.
  console.log(`\ndemo complete. try the other examples in ../`);

  // Void a lint warning for unused identifier in the fake-broker path.
  void openai;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
