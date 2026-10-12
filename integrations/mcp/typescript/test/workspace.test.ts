import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { OpenAgentWorkspace } from '@openagentid/sdk/local';
import { z } from 'zod';
import { expect, it } from 'vitest';
import { createWorkspaceMcpClient, createWorkspaceMcpServer, withOpenAgent, withOpenAgentClient, buildIdentityMeta } from '../src/index.js';

it('runs real MCP calls with SDK keys, request binding, policy, replay and revocation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'oaid-mcp-'));
  const server = new McpServer({ name: 'verified-tools', version: '1.0.0' });
  const raw = new Client({ name: 'verified-agent', version: '1.0.0' });
  try {
    const audience = 'https://tools.example.test';
    const signer = await OpenAgentWorkspace.initialize(join(directory, 'signer'), { audience: 'https://signer.example.test' });
    const receiver = await OpenAgentWorkspace.initialize(join(directory, 'receiver'), { audience });
    const caller = await signer.createAgent('MCP caller');
    await receiver.trustIdentity(await signer.exportIdentity(caller.did));
    const authority = createWorkspaceMcpServer({ workspace: receiver, did: caller.did,
      authorize: identity => identity.did === caller.did ? ['mcp:echo:invoke'] : [] });
    const authenticated = withOpenAgent(server, { agent: authority.agent });
    let invocations = 0;
    authenticated.registerTool('echo', { inputSchema: { text: z.string() } }, async ({ text }) => {
      invocations += 1;
      return { content: [{ type: 'text', text }] };
    });
    authenticated.registerTool('forbidden', {}, async () => { throw new Error('Must not run'); });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await raw.connect(clientTransport);
    const agent = createWorkspaceMcpClient({ workspace: signer, did: caller.did, audience, issueChallenge: authority.issueChallenge });
    const client = withOpenAgentClient(raw, { agent });
    const ok = await client.callTool({ name: 'echo', arguments: { text: 'signed request' } });
    expect(ok.content).toEqual([{ type: 'text', text: 'signed request' }]);
    expect(ok._meta?.openagent).toMatchObject({ verified_did: caller.did });
    const proof = await agent.signRequest('echo', audience, { text: 'original' });
    const tampered = await raw.callTool({ name: 'echo', arguments: { text: 'tampered' }, _meta: buildIdentityMeta(proof) });
    expect(tampered.isError).toBe(true);
    const original = { name: 'echo', arguments: { text: 'original' }, _meta: buildIdentityMeta(proof) };
    expect((await raw.callTool(original)).isError).not.toBe(true);
    expect((await raw.callTool(original)).isError).toBe(true);
    expect((await client.callTool({ name: 'forbidden' })).isError).toBe(true);
    const beforeRevoke = await agent.signRequest('echo', audience, { text: 'revoked' });
    await receiver.revoke(caller.did);
    expect((await raw.callTool({ name: 'echo', arguments: { text: 'revoked' }, _meta: buildIdentityMeta(beforeRevoke) })).isError).toBe(true);
    expect(invocations).toBe(2);
  } finally {
    await raw.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it.each([false, true])('binds raw calls while schemas default/coerce/transform/strip (already connected: %s)', async alreadyConnected => {
  const directory = await mkdtemp(join(tmpdir(), 'oaid-mcp-schema-'));
  const server = new McpServer({ name: 'schema-tools', version: '1.0.0' });
  const raw = new Client({ name: 'schema-caller', version: '1.0.0' });
  try {
    const audience = 'https://schema.example.test';
    const signer = await OpenAgentWorkspace.initialize(join(directory, 'signer'), { audience: 'https://signer.example.test' });
    const receiver = await OpenAgentWorkspace.initialize(join(directory, 'receiver'), { audience });
    const caller = await signer.createAgent('Schema caller');
    await receiver.trustIdentity(await signer.exportIdentity(caller.did));
    // Initialize MCP's low-level tools/call handler before installing middleware.
    server.registerTool('public_probe', {}, async () => ({ content: [{ type: 'text', text: 'ready' }] }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    if (alreadyConnected) { await server.connect(serverTransport); await raw.connect(clientTransport); }
    const authority = createWorkspaceMcpServer({ workspace: receiver, did: caller.did,
      authorize: identity => identity.did === caller.did ? ['mcp:defaults:invoke', 'mcp:transform:invoke'] : [] });
    const policyArguments: unknown[] = [];
    const authenticated = withOpenAgent(server, { agent: authority.agent,
      requireScopes(toolName, args) { policyArguments.push(args); return [`mcp:${toolName}:invoke`]; } });
    let invocations = 0;
    authenticated.registerTool('defaults', { inputSchema: { count: z.number().default(5) } }, async ({ count }) => {
      invocations += 1;
      return { content: [{ type: 'text', text: String(count) }] };
    });
    authenticated.registerTool('transform', { inputSchema: { amount: z.coerce.number().transform(async value => {
      await new Promise(resolve => setTimeout(resolve, value === 3 ? 5 : 1));
      return value * 2;
    }) } }, async args => {
      invocations += 1;
      return { content: [{ type: 'text', text: JSON.stringify(args) }] };
    });
    if (!alreadyConnected) { await server.connect(serverTransport); await raw.connect(clientTransport); }
    const agent = createWorkspaceMcpClient({ workspace: signer, did: caller.did, audience, issueChallenge: authority.issueChallenge });
    const client = withOpenAgentClient(raw, { agent });
    const [defaults, transformed, concurrent] = await Promise.all([
      client.callTool({ name: 'defaults', arguments: {} }),
      client.callTool({ name: 'transform', arguments: { amount: '3', stripped: 'signed field' } }),
      client.callTool({ name: 'transform', arguments: { amount: '4' } }),
    ]);
    expect(defaults.content).toEqual([{ type: 'text', text: '5' }]);
    expect(transformed.content).toEqual([{ type: 'text', text: '{"amount":6}' }]);
    expect(concurrent.content).toEqual([{ type: 'text', text: '{"amount":8}' }]);
    expect(policyArguments).toContainEqual({ count: 5 });
    expect(policyArguments).toContainEqual({ amount: 6 });
    // Each mutation produces the same parsed values, but changes the signed wire call.
    for (const [toolName, signedArgs, changedArgs] of [
      ['defaults', {}, { count: 5 }],
      ['transform', { amount: '3' }, { amount: 3 }],
      ['transform', { amount: '3', stripped: 'original' }, { amount: '3', stripped: 'tampered' }],
    ] as const) {
      const proof = await agent.signRequest(toolName, audience, signedArgs);
      const result = await raw.callTool({ name: toolName, arguments: changedArgs, _meta: buildIdentityMeta(proof) });
      expect(result.isError).toBe(true);
    }
    expect(invocations).toBe(3);
  } finally {
    await raw.close(); await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
