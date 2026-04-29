/**
 * Unit tests for the client interceptor.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  buildIdentityMeta,
  withOpenAgentClient,
} from '../src/index.js';
import { buildHappyPath } from './fakes.js';

interface FakeClient {
  callTool: (
    params: { name: string; arguments?: Record<string, unknown>; _meta?: Record<string, unknown> },
    ...rest: unknown[]
  ) => Promise<unknown>;
}

describe('withOpenAgentClient', () => {
  it('signs outbound calls and merges _meta.openagent.identity', async () => {
    const { agent } = buildHappyPath('did:oas:test:alice', []);
    const inner = vi.fn(async () => ({ content: [] }));
    const client: FakeClient = { callTool: inner };
    const wrapped = withOpenAgentClient(client, {
      agent,
      audience: 'did:oas:test:server',
    });

    await wrapped.callTool({ name: 'search_web', arguments: { q: 'mcp' } });

    expect(inner).toHaveBeenCalledTimes(1);
    const sentParams = inner.mock.calls[0]?.[0] as {
      name: string;
      arguments: Record<string, unknown>;
      _meta: { openagent: { identity: { did: string; proof: string } } };
    };
    expect(sentParams.name).toBe('search_web');
    expect(sentParams.arguments).toEqual({ q: 'mcp' });
    expect(sentParams._meta.openagent.identity).toMatchObject({
      did: 'did:oas:test:alice',
      proof: 'valid',
      nonce: 'nonce-1',
    });
    expect(agent.signCalls).toEqual([
      { toolName: 'search_web', audience: 'did:oas:test:server' },
    ]);
  });

  it('preserves caller-provided _meta entries', async () => {
    const { agent } = buildHappyPath('did:oas:test:alice', []);
    const inner = vi.fn(async () => ({ content: [] }));
    const wrapped = withOpenAgentClient(
      { callTool: inner } as FakeClient,
      { agent },
    );

    await wrapped.callTool({
      name: 'search_web',
      arguments: { q: 'mcp' },
      _meta: { traceparent: 'abc' },
    });

    const sent = inner.mock.calls[0]?.[0] as {
      _meta: { traceparent: string; openagent: unknown };
    };
    expect(sent._meta.traceparent).toBe('abc');
    expect(sent._meta.openagent).toBeDefined();
  });

  it('runs beforeCall hook and forwards its return value', async () => {
    const { agent } = buildHappyPath('did:oas:test:alice', []);
    const inner = vi.fn(async () => ({ content: [] }));
    const wrapped = withOpenAgentClient(
      { callTool: inner } as FakeClient,
      {
        agent,
        beforeCall: (params) => ({
          ...params,
          arguments: { ...params.arguments, augmented: true },
        }),
      },
    );

    await wrapped.callTool({ name: 'echo' });

    const sent = inner.mock.calls[0]?.[0] as {
      arguments: { augmented: boolean };
    };
    expect(sent.arguments.augmented).toBe(true);
  });

  it('forwards non-callTool methods unchanged', async () => {
    const { agent } = buildHappyPath('did:oas:test:alice', []);
    const inner = {
      callTool: vi.fn(async () => ({})),
      listTools: vi.fn(async () => ({ tools: [{ name: 'echo' }] })),
    };
    const wrapped = withOpenAgentClient(
      inner as unknown as FakeClient,
      { agent },
    );
    // Cast to access listTools (the proxy passes it through).
    const result = await (wrapped as unknown as {
      listTools: () => Promise<{ tools: Array<{ name: string }> }>;
    }).listTools();
    expect(result.tools[0]?.name).toBe('echo');
    expect(inner.listTools).toHaveBeenCalledTimes(1);
  });
});

describe('buildIdentityMeta', () => {
  it('builds an identity envelope with required fields', () => {
    const meta = buildIdentityMeta({
      did: 'did:oas:test:alice',
      proof: 'token',
    });
    expect(meta).toEqual({
      openagent: {
        identity: { did: 'did:oas:test:alice', proof: 'token' },
      },
    });
  });

  it('includes optional nonce and context when supplied', () => {
    const meta = buildIdentityMeta({
      did: 'did:oas:test:alice',
      proof: 'token',
      nonce: 'n1',
      context: { audience: 'did:oas:test:server' },
    });
    const envelope = (meta['openagent'] as { identity: Record<string, unknown> })
      .identity;
    expect(envelope['nonce']).toBe('n1');
    expect(envelope['context']).toEqual({ audience: 'did:oas:test:server' });
  });
});
