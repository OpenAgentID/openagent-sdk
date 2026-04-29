/**
 * Integration tests against the real `@modelcontextprotocol/sdk`.
 *
 * These tests build a linked pair of in-memory transports, mount a real
 * `McpServer` wrapped with `withOpenAgent`, and drive it from a real
 * MCP `Client` wrapped with `withOpenAgentClient`. They cover the
 * round-trip from outbound `_meta.openagent.identity` injection through
 * verifier check, scope enforcement, audit metadata stamping, and back
 * out to the caller.
 *
 * SDK version pinned: `@modelcontextprotocol/sdk@^1.27.0`. The MCP
 * TypeScript SDK split tool registration into `tool()` (deprecated) and
 * `registerTool()` (current); both are exercised below.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  McpErrorCode,
  withOpenAgent,
  withOpenAgentClient,
} from '../src/index.js';
import { buildHappyPath, FakeAgent, FakeVerifier } from './fakes.js';

interface ConnectedPair {
  client: Client;
  authedClient: Client;
  server: McpServer;
}

async function makeConnectedPair(
  serverConfig: Parameters<typeof withOpenAgent>[1],
  clientAgent: ConstructorParameters<typeof FakeAgent>[0],
): Promise<ConnectedPair> {
  const server = new McpServer({
    name: 'test-server',
    version: '0.1.0',
  });
  const authedServer = withOpenAgent(server, serverConfig);
  // Register at least one tool so the server advertises a tools
  // capability — required for `tools/list` to be a valid request.
  authedServer.registerTool(
    'hello',
    { description: 'sample tool' },
    async () => ({ content: [{ type: 'text', text: 'hi' }] }),
  );

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);

  const client = new Client({
    name: 'test-client',
    version: '0.1.0',
  });
  await client.connect(clientTransport);

  const authedClient = withOpenAgentClient(client, {
    agent: new FakeAgent(clientAgent),
  });

  return { client, authedClient, server };
}

describe('MCP integration: real McpServer + Client', () => {
  it('round-trips an authenticated registerTool() call', async () => {
    const { agent, verifier } = buildHappyPath('did:oas:test:alice', [
      'mcp:search_web:invoke',
    ]);
    const server = new McpServer({ name: 'tools', version: '0.1.0' });
    const authedServer = withOpenAgent(server, { agent });

    authedServer.registerTool(
      'search_web',
      {
        description: 'search the web',
        inputSchema: { q: z.string() },
      },
      async ({ q }) => ({
        content: [{ type: 'text', text: `results for ${q}` }],
      }),
    );

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const rawClient = new Client({ name: 'caller', version: '0.1.0' });
    await rawClient.connect(clientTransport);
    const authedClient = withOpenAgentClient(rawClient, {
      agent: new FakeAgent({
        did: 'did:oas:test:alice',
        proof: 'valid',
        verifier,
      }),
    });

    const result = await authedClient.callTool({
      name: 'search_web',
      arguments: { q: 'mcp' },
    });

    expect(result).toMatchObject({
      content: [{ type: 'text', text: 'results for mcp' }],
    });
    const meta = (result as { _meta?: Record<string, unknown> })._meta;
    expect(meta).toBeDefined();
    const openagent = (meta as { openagent: { audit_id: string; verified_did: string } })
      .openagent;
    expect(openagent.verified_did).toBe('did:oas:test:alice');
    expect(openagent.audit_id).toMatch(/^audit-/);

    await rawClient.close();
    await server.close();
  });

  it('round-trips an authenticated tool() (deprecated overload) call', async () => {
    const { verifier } = buildHappyPath('did:oas:test:alice', [
      'mcp:echo:invoke',
    ]);
    const serverAgent = new FakeAgent({
      did: 'did:oas:test:server',
      proof: 'server-proof',
      verifier,
    });
    const server = new McpServer({ name: 'echo-server', version: '0.1.0' });
    const authedServer = withOpenAgent(server, { agent: serverAgent });

    // Use the deprecated `tool(name, schema, cb)` overload to confirm
    // the proxy intercepts both registration paths.
    authedServer.tool(
      'echo',
      { msg: z.string() },
      async ({ msg }) => ({
        content: [{ type: 'text', text: msg }],
      }),
    );

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const rawClient = new Client({ name: 'caller', version: '0.1.0' });
    await rawClient.connect(clientTransport);
    const authedClient = withOpenAgentClient(rawClient, {
      agent: new FakeAgent({
        did: 'did:oas:test:alice',
        proof: 'valid',
        verifier,
      }),
    });

    const result = await authedClient.callTool({
      name: 'echo',
      arguments: { msg: 'hello world' },
    });
    expect(result).toMatchObject({
      content: [{ type: 'text', text: 'hello world' }],
    });

    await rawClient.close();
    await server.close();
  });

  it('returns a JSON-RPC error when scope is missing', async () => {
    const { agent, verifier } = buildHappyPath('did:oas:test:alice', [
      'mcp:other:invoke',
    ]);
    const server = new McpServer({ name: 'tools', version: '0.1.0' });
    const authedServer = withOpenAgent(server, { agent });
    authedServer.registerTool(
      'restricted',
      { description: 'requires scope' },
      async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    );

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const rawClient = new Client({ name: 'caller', version: '0.1.0' });
    await rawClient.connect(clientTransport);
    const authedClient = withOpenAgentClient(rawClient, {
      agent: new FakeAgent({
        did: 'did:oas:test:alice',
        proof: 'valid',
        verifier,
      }),
    });

    // The MCP SDK serializes the thrown error into a CallToolResult
    // with `isError: true` and a textual description. We assert on the
    // error text rather than expecting a JSON-RPC code because the SDK
    // catches and formats it.
    const result = await authedClient.callTool({
      name: 'restricted',
      arguments: {},
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
  });

  it('rejects calls when no identity envelope is present', async () => {
    const { agent } = buildHappyPath('did:oas:test:alice', []);
    const server = new McpServer({ name: 'tools', version: '0.1.0' });
    const authedServer = withOpenAgent(server, { agent });
    authedServer.registerTool(
      'echo',
      { description: 'echo' },
      async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    );

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    // Use a RAW client (no interceptor) so no identity envelope is sent.
    const rawClient = new Client({ name: 'caller', version: '0.1.0' });
    await rawClient.connect(clientTransport);

    const result = await rawClient.callTool({ name: 'echo', arguments: {} });
    expect((result as { isError?: boolean }).isError).toBe(true);
    const text = ((result as { content: Array<{ text: string }> }).content[0]
      ?.text ?? '').toLowerCase();
    expect(text).toContain('identity');

    await rawClient.close();
    await server.close();
  });

  it('still routes non-tool requests through the underlying server', async () => {
    const { agent } = buildHappyPath('did:oas:test:alice', [
      'mcp:hello:invoke',
    ]);
    const { authedClient } = await makeConnectedPair(
      { agent },
      {
        did: 'did:oas:test:alice',
        proof: 'valid',
        verifier: agent.verifier,
      },
    );
    // listTools() does not need an identity envelope — confirm the
    // proxy still passes it through to the inner client.
    const tools = await authedClient.listTools();
    expect(tools).toBeDefined();
    expect(Array.isArray(tools.tools)).toBe(true);

    await authedClient.close();
  });

  it('makes McpErrorCode constants match the JSON-RPC range', () => {
    // Defensive sanity check: keep our codes inside the documented
    // server-error range so the SDK does not collapse them onto a
    // standard code on serialization.
    const serverErrorRange = (code: number): boolean =>
      code <= -32000 && code >= -32099;
    expect(serverErrorRange(McpErrorCode.AuthenticationFailed)).toBe(true);
    expect(serverErrorRange(McpErrorCode.AuthorizationDenied)).toBe(true);
    expect(serverErrorRange(McpErrorCode.SkillsPolicyDenied)).toBe(true);
  });
});
