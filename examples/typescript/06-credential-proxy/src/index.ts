import { OpenAgent, OpenAgentError } from '@openagent/sdk';

async function main() {
  OpenAgent.configure({
    brokerUrl: process.env.OPENAGENT_BROKER_URL ?? 'fake://in-memory',
    aegisUrl: process.env.OPENAGENT_AEGIS_URL ?? 'fake://in-memory',
    namespace: process.env.OPENAGENT_NAMESPACE ?? 'example',
  });

  const parent = process.env.OPENAGENT_PARENT_DID ?? 'did:oas:example:hmr:local-dev';

  const agent = await OpenAgent.createAgent({
    parent,
    name: 'proxy-demo',
    scopes: ['echo:any:invoke', 'openai:chat:invoke'],
  });

  console.log(`agent did=${agent.did}\n`);

  // === GET via the proxy ===
  const echo = await agent.credentialsFor('echo');
  try {
    const res = await echo.get('https://echo.example.com/ping');
    console.log(`GET status=${res.status} body=${(await res.text()).slice(0, 80)}`);
  } catch (err) {
    handleError(err);
  }

  // === POST with JSON body ===
  try {
    const res = await echo.post('https://echo.example.com/submit', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
    console.log(`POST status=${res.status} body=${(await res.text()).slice(0, 80)}`);
  } catch (err) {
    handleError(err);
  }

  // === Streaming response ===
  try {
    const openai = await agent.credentialsFor('openai');
    const stream = await openai.stream('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        stream: true,
        messages: [{ role: 'user', content: 'Say hello.' }],
      }),
    });

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let count = 0;
    while (count < 3) {
      const { done, value } = await reader.read();
      if (done) break;
      process.stdout.write(`stream chunk: ${decoder.decode(value).slice(0, 60)}\n`);
      count++;
    }
    reader.releaseLock();
  } catch (err) {
    handleError(err);
  }

  console.log(`\nthroughout: no raw credential was ever held in this process.`);
}

function handleError(err: unknown) {
  if (err instanceof OpenAgentError) {
    console.log(`  openagent error: code=${err.code} status=${err.httpStatus} msg=${err.message}`);
    return;
  }
  console.log(`  unexpected error:`, err);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
