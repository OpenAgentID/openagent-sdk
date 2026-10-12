import { describe, expect, it } from 'vitest';
import { openAgentPlugin } from '../src/plugin.js';
import { ConfigError, SkillDeniedError, ToolDeniedError } from '../src/errors.js';
import {
  AllowAllChecker,
  CaptureSink,
  DenyAllChecker,
  MockClaudeAgentSession,
  checker,
  makeIdentity,
} from './fixtures.js';

describe('openAgentPlugin', () => {
  describe('factory validation', () => {
    it('throws ConfigError when agent.did is missing', () => {
      expect(() =>
        openAgentPlugin({
          // @ts-expect-error - intentionally bad
          agent: { kind: 'agent', publicKey: 'x', sign: () => new Uint8Array() },
          capabilities: new AllowAllChecker(),
        }),
      ).toThrow(ConfigError);
    });

    it('throws ConfigError when capabilities is missing', () => {
      expect(() =>
        openAgentPlugin({
          agent: makeIdentity(),
          // @ts-expect-error - intentionally bad
          capabilities: undefined,
        }),
      ).toThrow(ConfigError);
    });

    it('returns a plugin with the expected name and version', () => {
      const p = openAgentPlugin({
        agent: makeIdentity(),
        capabilities: new AllowAllChecker(),
      });
      expect(p.name).toBe('@openagentid/claude-agent');
      expect(p.version).toBe('0.2.0');
      expect(typeof p.hooks.onSessionStart).toBe('function');
      expect(typeof p.hooks.preToolUse).toBe('function');
      expect(typeof p.hooks.postToolUse).toBe('function');
      expect(typeof p.hooks.onMessage).toBe('function');
      expect(typeof p.hooks.onSkillInvoke).toBe('function');
      expect(typeof p.hooks.onSessionEnd).toBe('function');
    });
  });

  describe('session lifecycle', () => {
    it('emits session.start and session.stop records', async () => {
      const plugin = openAgentPlugin({
        agent: makeIdentity(),
        capabilities: new AllowAllChecker(),
        audit: true,
      });
      const sess = new MockClaudeAgentSession(plugin);
      await sess.start();
      await sess.stop();
      const records = plugin.inspectAudit();
      expect(records).toHaveLength(2);
      expect(records[0]?.kind).toBe('session.start');
      expect(records[1]?.kind).toBe('session.stop');
      expect(records[0]?.agentDid).toBe('did:oas:test:agent:refactor-bot');
    });

    it('errors clearly when a hook fires before session start', async () => {
      const plugin = openAgentPlugin({
        agent: makeIdentity(),
        capabilities: new AllowAllChecker(),
        audit: true,
      });
      await expect(
        plugin.hooks.preToolUse({ toolName: 'bash', args: { cmd: 'ls' } }),
      ).rejects.toThrow(ConfigError);
    });
  });

  describe('preToolUse', () => {
    it('allows tools when scope is held', async () => {
      const plugin = openAgentPlugin({
        agent: makeIdentity(),
        capabilities: checker(['tools:invoke:bash']),
        audit: true,
      });
      const sess = new MockClaudeAgentSession(plugin);
      await sess.start();
      const result = await sess.runTool('bash', { cmd: 'echo hi' }, 'hi');
      expect(result).toBe('hi');
      const records = plugin.inspectAudit();
      const preflight = records.find((r) => r.kind === 'tool.preflight');
      expect(preflight?.outcome).toBe('allow');
      expect(preflight?.name).toBe('bash');
    });

    it('throws ToolDeniedError when scope is missing', async () => {
      const plugin = openAgentPlugin({
        agent: makeIdentity(),
        capabilities: new DenyAllChecker(),
        audit: true,
      });
      const sess = new MockClaudeAgentSession(plugin);
      await sess.start();
      await expect(sess.runTool('bash', { cmd: 'ls' }, 'ok')).rejects.toThrow(
        ToolDeniedError,
      );
      const denyRec = plugin
        .inspectAudit()
        .find((r) => r.kind === 'tool.preflight' && r.outcome === 'deny');
      expect(denyRec).toBeDefined();
    });

    it('honours wildcard scopes', async () => {
      const plugin = openAgentPlugin({
        agent: makeIdentity(),
        capabilities: checker(['tools:invoke:*']),
        audit: true,
      });
      const sess = new MockClaudeAgentSession(plugin);
      await sess.start();
      await expect(sess.runTool('bash', {}, 'ok')).resolves.toBe('ok');
      await expect(sess.runTool('read_file', {}, 'ok')).resolves.toBe('ok');
      await expect(sess.runTool('write_file', {}, 'ok')).resolves.toBe('ok');
    });

    it('returns blocking decision when denyMode is "block"', async () => {
      const plugin = openAgentPlugin({
        agent: makeIdentity(),
        capabilities: new DenyAllChecker(),
        audit: true,
        denyMode: 'block',
      });
      await plugin.hooks.onSessionStart({ sessionId: 's' });
      const decision = await plugin.hooks.preToolUse({ toolName: 'bash', args: {} });
      expect(decision.allow).toBe(false);
      expect(decision.reason).toContain('deny-all');
    });
  });

  describe('postToolUse', () => {
    it('emits a tool.complete record with input + output hashes', async () => {
      const plugin = openAgentPlugin({
        agent: makeIdentity(),
        capabilities: new AllowAllChecker(),
        audit: true,
      });
      const sess = new MockClaudeAgentSession(plugin);
      await sess.start();
      await sess.runTool('bash', { cmd: 'pwd' }, '/tmp');
      const complete = plugin
        .inspectAudit()
        .find((r) => r.kind === 'tool.complete');
      expect(complete).toBeDefined();
      expect(complete?.outcome).toBe('ok');
      expect(complete?.inputHash).toMatch(/^[0-9a-f]+$/);
      expect(complete?.outputHash).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe('onSkillInvoke', () => {
    it('denies skills by default (deny-unless-scoped)', async () => {
      const plugin = openAgentPlugin({
        agent: makeIdentity(),
        capabilities: checker([]),
        audit: true,
      });
      await plugin.hooks.onSessionStart({ sessionId: 's' });
      await expect(
        plugin.hooks.onSkillInvoke({ skillName: 'web.search' }),
      ).rejects.toThrow(SkillDeniedError);
    });

    it('allows scoped skills', async () => {
      const plugin = openAgentPlugin({
        agent: makeIdentity(),
        capabilities: checker(['skills:invoke:web.search']),
        audit: true,
      });
      await plugin.hooks.onSessionStart({ sessionId: 's' });
      const r = await plugin.hooks.onSkillInvoke({ skillName: 'web.search' });
      expect(r.allow).toBe(true);
    });

    it('honours skills wildcard scope', async () => {
      const plugin = openAgentPlugin({
        agent: makeIdentity(),
        capabilities: checker(['skills:invoke:web.*']),
        audit: true,
      });
      await plugin.hooks.onSessionStart({ sessionId: 's' });
      await expect(
        plugin.hooks.onSkillInvoke({ skillName: 'web.search' }),
      ).resolves.toEqual({ allow: true });
      await expect(
        plugin.hooks.onSkillInvoke({ skillName: 'web.fetch' }),
      ).resolves.toEqual({ allow: true });
      await expect(
        plugin.hooks.onSkillInvoke({ skillName: 'fs.read' }),
      ).rejects.toThrow(SkillDeniedError);
    });
  });

  describe('onMessage', () => {
    it('signs outbound messages when signMessages is enabled', async () => {
      const plugin = openAgentPlugin({
        agent: makeIdentity(),
        capabilities: new AllowAllChecker(),
        audit: true,
        signMessages: true,
      });
      await plugin.hooks.onSessionStart({ sessionId: 's' });
      const r = await plugin.hooks.onMessage({ body: 'hello world', direction: 'out' });
      expect(r.allow).toBe(true);
      expect(r.signature).toMatch(/^[0-9a-f]{128}$/);
    });

    it('does not sign inbound messages', async () => {
      const plugin = openAgentPlugin({
        agent: makeIdentity(),
        capabilities: new AllowAllChecker(),
        audit: true,
        signMessages: true,
      });
      await plugin.hooks.onSessionStart({ sessionId: 's' });
      const r = await plugin.hooks.onMessage({ body: 'hi', direction: 'in' });
      expect(r.signature).toBeUndefined();
    });

    it('skips signing when signMessages is false (default)', async () => {
      const plugin = openAgentPlugin({
        agent: makeIdentity(),
        capabilities: new AllowAllChecker(),
        audit: true,
      });
      await plugin.hooks.onSessionStart({ sessionId: 's' });
      const r = await plugin.hooks.onMessage({ body: 'hi', direction: 'out' });
      expect(r.signature).toBeUndefined();
    });
  });

  describe('audit chain', () => {
    it('produces a verifiable hash chain', async () => {
      const sink = new CaptureSink();
      const plugin = openAgentPlugin({
        agent: makeIdentity(),
        capabilities: checker(['tools:invoke:bash', 'skills:invoke:web.search']),
        audit: sink,
      });
      const sess = new MockClaudeAgentSession(plugin);
      await sess.start();
      await sess.runTool('bash', { cmd: 'ls' }, 'a\nb\nc');
      await plugin.hooks.onSkillInvoke({ skillName: 'web.search' });
      await sess.stop();

      const { verifyChain } = await import('../src/audit.js');
      const result = verifyChain(sink.records);
      expect(result.valid).toBe(true);
      expect(sink.records.length).toBeGreaterThanOrEqual(4);
    });

    it('detects tampering', async () => {
      const sink = new CaptureSink();
      const plugin = openAgentPlugin({
        agent: makeIdentity(),
        capabilities: new AllowAllChecker(),
        audit: sink,
      });
      const sess = new MockClaudeAgentSession(plugin);
      await sess.start();
      await sess.runTool('bash', {}, 'ok');
      await sess.stop();

      // Tamper with one record
      const target = sink.records[2];
      if (target) {
        target.outcome = 'deny';
      }
      const { verifyChain } = await import('../src/audit.js');
      const result = verifyChain(sink.records);
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(2);
    });
  });
});
