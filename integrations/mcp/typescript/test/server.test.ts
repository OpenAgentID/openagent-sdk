/**
 * Unit tests for `withOpenAgent` server middleware.
 *
 * These tests exercise the middleware against a synthetic `McpServer`-
 * shaped object so the auth pipeline can be observed deterministically
 * without spinning up the real MCP transport. Integration tests against
 * the real `@modelcontextprotocol/sdk` McpServer live in
 * `mcp-integration.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  AuthorizationDeniedError,
  IdentityVerificationError,
  McpErrorCode,
  MissingIdentityError,
  SkillsPolicyDeniedError,
  withOpenAgent,
} from '../src/index.js';
import {
  InMemorySkillsPolicyStore,
  createSkillsPolicy,
} from '../src/skills.js';
import { buildHappyPath, FakeAgent, FakeVerifier } from './fakes.js';

interface FakeServer {
  registered: Map<string, (...args: unknown[]) => unknown>;
  registerTool: (
    name: string,
    config: Record<string, unknown>,
    cb: (...args: unknown[]) => unknown,
  ) => void;
  tool: (name: string, cb: (...args: unknown[]) => unknown) => void;
}

function makeFakeServer(): FakeServer {
  const registered = new Map<string, (...args: unknown[]) => unknown>();
  return {
    registered,
    registerTool(name, _config, cb) {
      registered.set(name, cb);
    },
    tool(name, cb) {
      registered.set(name, cb);
    },
  };
}

function makeExtraWithIdentity(
  did: string,
  proof: string,
): { _meta: { openagent: { identity: { did: string; proof: string } } } } {
  return {
    _meta: { openagent: { identity: { did, proof } } },
  };
}

describe('withOpenAgent (server middleware)', () => {
  it('verifies identity, runs the tool, and stamps audit metadata', async () => {
    const { agent, verifier } = buildHappyPath('did:oas:test:alice', [
      'mcp:search_web:invoke',
    ]);
    const server = makeFakeServer();
    const authed = withOpenAgent(server, { agent });
    const handler = vi.fn(async (args: { q: string }) => ({
      content: [{ type: 'text', text: `results for ${args.q}` }],
    }));

    authed.registerTool('search_web', { description: 'search' }, handler);
    const wrapped = server.registered.get('search_web');
    expect(wrapped).toBeDefined();

    const result = await wrapped!(
      { q: 'mcp' },
      makeExtraWithIdentity('did:oas:test:alice', 'valid'),
    );

    expect(handler).toHaveBeenCalledWith(
      { q: 'mcp' },
      expect.objectContaining({
        _meta: expect.any(Object),
      }),
    );
    expect(verifier.verifyCalls).toHaveLength(1);
    expect(verifier.verifyCalls[0]?.requiredScopes).toEqual([
      'mcp:search_web:invoke',
    ]);
    expect(result).toMatchObject({
      content: [{ type: 'text', text: 'results for mcp' }],
      _meta: {
        openagent: {
          audit_id: 'audit-1',
          verified_did: 'did:oas:test:alice',
          scopes: ['mcp:search_web:invoke'],
        },
      },
    });
  });

  it('rejects calls without an identity envelope when requireIdentity is true', async () => {
    const { agent } = buildHappyPath('did:oas:test:alice', []);
    const server = makeFakeServer();
    const authed = withOpenAgent(server, { agent });
    authed.tool('echo', async () => ({ ok: true }));

    const wrapped = server.registered.get('echo');
    await expect(wrapped!({}, { _meta: {} })).rejects.toBeInstanceOf(
      MissingIdentityError,
    );
  });

  it('passes through calls without identity in permissive mode', async () => {
    const { agent } = buildHappyPath('did:oas:test:alice', []);
    const server = makeFakeServer();
    const authed = withOpenAgent(server, { agent, requireIdentity: false });
    const handler = vi.fn(async () => ({ ok: true }));
    authed.tool('echo', handler);

    const wrapped = server.registered.get('echo');
    const result = await wrapped!({}, { _meta: {} });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      _meta: { openagent: { verified_did: 'did:oas:anonymous' } },
    });
  });

  it('rejects calls when the verifier throws', async () => {
    const verifier = new FakeVerifier([]);
    const agent = new FakeAgent({
      did: 'did:oas:test:alice',
      proof: 'invalid',
      verifier,
    });
    const server = makeFakeServer();
    const authed = withOpenAgent(server, { agent });
    authed.tool('echo', async () => ({ ok: true }));

    const wrapped = server.registered.get('echo');
    await expect(
      wrapped!({}, makeExtraWithIdentity('did:oas:test:alice', 'invalid')),
    ).rejects.toBeInstanceOf(IdentityVerificationError);
  });

  it('rejects calls when required scopes are missing', async () => {
    const { agent } = buildHappyPath('did:oas:test:alice', [
      'mcp:other:invoke',
    ]);
    const server = makeFakeServer();
    const authed = withOpenAgent(server, { agent });
    authed.tool('search_web', async () => ({ ok: true }));

    const wrapped = server.registered.get('search_web');
    const error = await wrapped!(
      {},
      makeExtraWithIdentity('did:oas:test:alice', 'valid'),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthorizationDeniedError);
    expect((error as AuthorizationDeniedError).code).toBe(
      McpErrorCode.AuthorizationDenied,
    );
  });

  it('uses a custom requireScopes deriver', async () => {
    const { agent } = buildHappyPath('did:oas:test:alice', [
      'admin:write_file:invoke',
    ]);
    const server = makeFakeServer();
    const authed = withOpenAgent(server, {
      agent,
      requireScopes: (toolName, args) => {
        if (toolName === 'write_file' && (args as { dest: string }).dest === '/etc') {
          return ['admin:write_file:invoke'];
        }
        return [`mcp:${toolName}:invoke`];
      },
    });
    authed.tool('write_file', async () => ({ ok: true }));

    const wrapped = server.registered.get('write_file');
    await expect(
      wrapped!(
        { dest: '/etc' },
        makeExtraWithIdentity('did:oas:test:alice', 'valid'),
      ),
    ).resolves.toMatchObject({ ok: true });
  });

  it('runs preCall, postCall, and onError hooks in the correct order', async () => {
    const { agent } = buildHappyPath('did:oas:test:alice', [
      'mcp:do_thing:invoke',
    ]);
    const events: string[] = [];
    const server = makeFakeServer();
    const authed = withOpenAgent(server, {
      agent,
      preCall: () => {
        events.push('pre');
      },
      postCall: ({ durationMs }) => {
        expect(durationMs).toBeGreaterThanOrEqual(0);
        events.push('post');
      },
      onError: () => {
        events.push('error');
      },
    });
    authed.tool('do_thing', async () => {
      events.push('handler');
      return { ok: true };
    });

    await server.registered.get('do_thing')!(
      {},
      makeExtraWithIdentity('did:oas:test:alice', 'valid'),
    );
    expect(events).toEqual(['pre', 'handler', 'post']);
  });

  it('runs onError when the handler throws and re-throws the original error', async () => {
    const { agent } = buildHappyPath('did:oas:test:alice', [
      'mcp:fail_tool:invoke',
    ]);
    const errors: unknown[] = [];
    const server = makeFakeServer();
    const authed = withOpenAgent(server, {
      agent,
      onError: ({ error }) => {
        errors.push(error);
      },
    });
    const failure = new Error('boom');
    authed.tool('fail_tool', async () => {
      throw failure;
    });

    await expect(
      server.registered.get('fail_tool')!(
        {},
        makeExtraWithIdentity('did:oas:test:alice', 'valid'),
      ),
    ).rejects.toBe(failure);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe(failure);
  });

  it('honours the skills policy hook', async () => {
    const { agent } = buildHappyPath('did:oas:test:alice', [
      'mcp:invoke_skill:invoke',
    ]);
    const store = new InMemorySkillsPolicyStore([
      { skillName: 'cook_dinner', dids: ['did:oas:test:bob'] },
    ]);
    const server = makeFakeServer();
    const authed = withOpenAgent(server, {
      agent,
      skillsPolicy: createSkillsPolicy({ store }),
    });
    authed.tool('invoke_skill', async () => ({ ok: true }));

    const wrapped = server.registered.get('invoke_skill');
    await expect(
      wrapped!(
        { skill: 'cook_dinner' },
        makeExtraWithIdentity('did:oas:test:alice', 'valid'),
      ),
    ).rejects.toBeInstanceOf(SkillsPolicyDeniedError);
  });

  it('allows skill calls when the policy permits the DID', async () => {
    const { agent } = buildHappyPath('did:oas:test:alice', [
      'mcp:invoke_skill:invoke',
    ]);
    const store = new InMemorySkillsPolicyStore([
      { skillName: 'cook_dinner', dids: ['did:oas:test:alice'] },
    ]);
    const server = makeFakeServer();
    const authed = withOpenAgent(server, {
      agent,
      skillsPolicy: createSkillsPolicy({ store }),
    });
    authed.tool('invoke_skill', async () => ({ ok: true }));

    const wrapped = server.registered.get('invoke_skill');
    const result = await wrapped!(
      { skill: 'cook_dinner' },
      makeExtraWithIdentity('did:oas:test:alice', 'valid'),
    );
    expect(result).toMatchObject({ ok: true });
  });

  it('throws on missing agent', () => {
    expect(() =>
      withOpenAgent(makeFakeServer(), {
        // @ts-expect-error intentionally bad config
        agent: undefined,
      }),
    ).toThrow(TypeError);
  });
});
