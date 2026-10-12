import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { OpenAgentWorkspace } from '@openagentid/sdk/local';
import { createWorkspaceMcpServer, withOpenAgent } from '@openagentid/mcp';
import { z } from 'zod';

const directory = process.argv[2];
const allowedDid = process.argv[3];
if (!directory || !allowedDid) throw new Error('Receiver workspace and authorized DID are required');
const workspace = await OpenAgentWorkspace.open(directory);
const authority = createWorkspaceMcpServer({ workspace, did: allowedDid,
  authorize: identity => identity.did === allowedDid ? ['mcp:echo:invoke'] : [],
});
const server = new McpServer({ name: 'openagent-example-tools', version: '1.0.0' });
// Challenge issuance is public, bounded and still requires a receiver-trusted DID.
server.registerTool('openagent_challenge', { inputSchema: {
  did: z.string(), toolName: z.string(), args: z.record(z.unknown()).optional(),
} }, async input => ({ content: [{ type: 'text', text: JSON.stringify(await authority.issueChallenge(input)) }] }));
const authenticated = withOpenAgent(server, { agent: authority.agent });
authenticated.registerTool('echo', { inputSchema: { text: z.string() } }, async ({ text }) => ({ content: [{ type: 'text', text }] }));
await server.connect(new StdioServerTransport());
