import { describe, it, expect, vi } from 'vitest';
import { OpenAgent, OpenAgentRuntime } from '../src/agent.js';
import { ConfigError, IdentityError } from '../src/errors.js';
import { StubVerificationClient, createTestingConfig } from '@openagentid/sdk-testing';

describe('OpenAgentRuntime.createAgent', () => {
  it('returns a usable agent instance from a minimal config', async () => {
    const runtime = new OpenAgentRuntime(createTestingConfig());
    const agent = await runtime.createAgent({
      parent: 'did:oas:l1fe:hmr:alice',
      name: 'bot',
      scopes: ['openai:chat:completions'],
    });
    expect(agent.did.startsWith('did:oas:l1fe:agent:')).toBe(true);
    expect(agent.document.parent).toBe('did:oas:l1fe:hmr:alice');
    expect(agent.skillsPolicy().listAllowed()).toEqual([]);
  });

  it('binds explicit skills to the new agent', async () => {
    const runtime = new OpenAgentRuntime(createTestingConfig());
    const agent = await runtime.createAgent({
      parent: 'did:oas:l1fe:hmr:alice',
      name: 'bot',
      scopes: ['openai:chat:completions'],
      skills: ['frontend-design'],
    });
    expect(agent.skillsPolicy().canInvoke('frontend-design')).toBe(true);
    expect(agent.skillsPolicy().canInvoke('backend-write')).toBe(false);
  });

  it('withSkillsPolicy returns a new instance', async () => {
    const runtime = new OpenAgentRuntime(createTestingConfig());
    const agent = await runtime.createAgent({
      parent: 'did:oas:l1fe:hmr:alice',
      name: 'bot',
      scopes: ['openai:chat:completions'],
    });
    const updated = agent.withSkillsPolicy(agent.skillsPolicy().grant('new-skill'));
    expect(updated).not.toBe(agent);
    expect(updated.skillsPolicy().canInvoke('new-skill')).toBe(true);
    expect(agent.skillsPolicy().canInvoke('new-skill')).toBe(false);
  });

  it('credentialsFor returns a working handle backed by the stub broker', async () => {
    const runtime = new OpenAgentRuntime(createTestingConfig());
    const agent = await runtime.createAgent({
      parent: 'did:oas:l1fe:hmr:alice',
      name: 'bot',
      scopes: ['openai:chat:completions'],
    });
    const creds = await agent.credentialsFor('openai');
    expect(creds.provider).toBe('openai');
    expect(creds.agentDid).toBe(agent.did);
    await creds.release();
  });

  it('throws ConfigError on invalid createAgent input', async () => {
    const runtime = new OpenAgentRuntime(createTestingConfig());
    await expect(
      runtime.createAgent({
        parent: 'not-a-did',
        name: 'bot',
        scopes: ['openai:chat:completions'],
      } as never),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it('loadAgent resolves an existing DID', async () => {
    const runtime = new OpenAgentRuntime(createTestingConfig());
    const agent = await runtime.createAgent({
      parent: 'did:oas:l1fe:hmr:alice',
      name: 'bot',
      scopes: ['openai:chat:completions'],
    });
    const loaded = await runtime.loadAgent(agent.did, ['x']);
    expect(loaded.did).toBe(agent.did);
    expect(loaded.skillsPolicy().canInvoke('x')).toBe(true);
  });

  it('loadAgent wraps unknown errors in IdentityError', async () => {
    const runtime = new OpenAgentRuntime(createTestingConfig());
    await expect(runtime.loadAgent('did:oas:l1fe:agent:unknown')).rejects.toBeInstanceOf(
      IdentityError,
    );
  });
});

describe('OpenAgentRuntime.authenticate', () => {
  it('delegates to the verification client', async () => {
    const stub = new StubVerificationClient();
    const spy = vi.spyOn(stub, 'verifyRequest');
    const runtime = new OpenAgentRuntime({ clients: { verification: stub } });
    const req = new Request('https://api.example.com/', {
      headers: { Authorization: 'Bearer stub:did:oas:l1fe:agent:bot' },
    });
    const ctx = await runtime.authenticate(req);
    expect(ctx.did).toBe('did:oas:l1fe:agent:bot');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('fail-closed behavior (no silent stubs)', () => {
  it('createAgent rejects with ConfigError when no identity client is configured', async () => {
    const runtime = new OpenAgentRuntime();
    await expect(
      runtime.createAgent({
        parent: 'did:oas:l1fe:hmr:alice',
        name: 'bot',
        scopes: ['openai:chat:completions'],
      }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it('loadAgent rejects with ConfigError when no identity client is configured', async () => {
    const runtime = new OpenAgentRuntime();
    await expect(runtime.loadAgent('did:oas:l1fe:agent:bot')).rejects.toBeInstanceOf(ConfigError);
  });

  it('authenticate rejects with ConfigError when no verification client is configured', async () => {
    const runtime = new OpenAgentRuntime();
    const req = new Request('https://api.example.com/', {
      headers: { Authorization: 'Bearer stub:did:oas:l1fe:agent:bot' },
    });
    await expect(runtime.authenticate(req)).rejects.toBeInstanceOf(ConfigError);
  });

  it('credentialsFor rejects with ConfigError when no credentials client is configured', async () => {
    const runtime = new OpenAgentRuntime(createTestingConfig({ clients: { credentials: undefined } }));
    const agent = await runtime.createAgent({
      parent: 'did:oas:l1fe:hmr:alice',
      name: 'bot',
      scopes: ['openai:chat:completions'],
    });
    await expect(agent.credentialsFor('openai')).rejects.toBeInstanceOf(ConfigError);
  });

  it('the error names the missing subsystem and the packages that provide one', async () => {
    const runtime = new OpenAgentRuntime();
    const failure = await runtime
      .createAgent({
        parent: 'did:oas:l1fe:hmr:alice',
        name: 'bot',
        scopes: ['openai:chat:completions'],
      })
      .catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(ConfigError);
    const message = (failure as Error).message;
    expect(message).toContain('identity');
    expect(message).toContain('@openagentid/oas-sdk');
    expect(message).toContain('@openagentid/sdk-testing');
  });
});

describe('OpenAgent singleton facade', () => {
  it('configure() returns a runtime that createAgent() reuses', async () => {
    const runtime = OpenAgent.configure(createTestingConfig());
    expect(runtime).toBeInstanceOf(OpenAgentRuntime);
    const agent = await OpenAgent.createAgent({
      parent: 'did:oas:l1fe:hmr:alice',
      name: 'singleton-bot',
      scopes: ['openai:chat:completions'],
    });
    expect(agent.did).toBeTruthy();
  });

  it('runtime() is lazily created', () => {
    expect(OpenAgent.runtime()).toBeInstanceOf(OpenAgentRuntime);
  });
});
