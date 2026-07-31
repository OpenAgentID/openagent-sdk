import { OpenAgent } from '@openagentid/sdk';

OpenAgent.configure({
  brokerUrl: process.env.OPENAGENT_BROKER_URL ?? 'fake://in-memory',
  aegisUrl: process.env.OPENAGENT_AEGIS_URL ?? 'fake://in-memory',
  namespace: process.env.OPENAGENT_NAMESPACE ?? 'example',
});

async function main() {
  const parent = process.env.OPENAGENT_PARENT_DID ?? 'did:oas:example:hmr:local-dev';

  const agent = await OpenAgent.createAgent({
    parent,
    name: 'mcp-test-client',
    scopes: ['tavily:search:invoke'],
  });

  console.log(`client agent: ${agent.did}`);

  const url = process.env.MCP_URL ?? 'http://localhost:3000/mcp';

  async function call(method: string, params?: Record<string, unknown>) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `OpenAgent ${agent.actCompactString}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    });
    return res.json() as Promise<{ result?: unknown; error?: unknown }>;
  }

  const init = await call('initialize');
  console.log('initialize:', init);

  const list = await call('tools/list');
  console.log('tools/list:', list);

  const callResult = await call('tools/call', {
    name: 'summarize_url',
    arguments: { url: 'https://example.com' },
  });
  console.log('tools/call:', callResult);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
