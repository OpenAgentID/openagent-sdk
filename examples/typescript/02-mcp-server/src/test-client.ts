import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { OpenAgentWorkspace, type LocalChallenge } from '@openagentid/sdk/local';
import { createWorkspaceMcpClient, withOpenAgentClient } from '@openagentid/mcp';

// Every invocation uses a new durable directory; private keys stay there.
const directory = resolve('.openagent-example', new Date().toISOString().replaceAll(':', '-'));
await mkdir(directory, { recursive: true });
const audience = 'https://mcp.example.test';
const signer = await OpenAgentWorkspace.initialize(join(directory, 'signer'), { audience: 'https://signer.example.test' });
const receiver = await OpenAgentWorkspace.initialize(join(directory, 'receiver'), { audience });
const agent = await signer.createAgent('MCP example');
await receiver.trustIdentity(await signer.exportIdentity(agent.did));
const raw = new Client({ name: 'openagent-example-client', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath,
  args: ['--import', 'tsx', fileURLToPath(new URL('./server.ts', import.meta.url)), join(directory, 'receiver'), agent.did],
});
try {
  await raw.connect(transport);
  const identity = createWorkspaceMcpClient({ workspace: signer, did: agent.did, audience,
    async issueChallenge(request) {
      const result = await raw.callTool({ name: 'openagent_challenge', arguments: { ...request } });
      const content = result.content;
      if (result.isError || !Array.isArray(content) || content[0]?.type !== 'text') throw new Error('Receiver refused challenge');
      return JSON.parse(content[0].text) as LocalChallenge;
    },
  });
  const client = withOpenAgentClient(raw, { agent: identity });
  const result = await client.callTool({ name: 'echo', arguments: { text: 'A real signed MCP call.' } });
  assert.deepEqual(result.content, [{ type: 'text', text: 'A real signed MCP call.' }]);
  assert.equal(result.isError, undefined);
  assert.equal((result._meta?.openagent as { verified_did: string }).verified_did, agent.did);
  const unsigned = await raw.callTool({ name: 'echo', arguments: { text: 'Unsigned call' } });
  assert.equal(unsigned.isError, true);
  await receiver.revoke(agent.did);
  await assert.rejects(client.callTool({ name: 'echo', arguments: { text: 'Revoked call' } }));
  console.log(`Verified authenticated MCP call, unsigned rejection and revocation for ${agent.did}`);
  console.log(`Private signer and receiver state: ${directory}`);
} finally { await raw.close(); await transport.close(); }
