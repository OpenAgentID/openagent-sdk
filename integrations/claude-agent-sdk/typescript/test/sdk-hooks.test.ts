import * as oas from '@openagentid/oas-sdk';
import type { HookInput, Options } from '@anthropic-ai/claude-agent-sdk';
import { parseIdentityDocument, scopeSchema } from '@openagentid/sdk';
import { expect, it } from 'vitest';
import { createOpenAgentHooks, createSdkAgentIdentity, sdkToolScope, sdkSkillScope, InMemoryAuditSink, StaticCapabilityChecker, verifyChain } from '../src/index.js';

it('encodes native tool and dotted skill names into SDK scopes without case/name collisions', () => {
  const names = ['Read', 'read', 'read-notes', 'web.search', 'encoded-52656164'];
  expect(new Set(names.map(sdkToolScope)).size).toBe(names.length);
  for (const name of names) {
    expect(scopeSchema.safeParse(sdkToolScope(name)).success).toBe(true);
    expect(scopeSchema.safeParse(sdkSkillScope(name)).success).toBe(true);
  }
});

it('adapts current SDK custody and actual Claude hooks with real Ed25519 and explicit denials', async () => {
  const root = await oas.createHmr('example', 'hooks-owner', new Date().toISOString());
  const child = await oas.deriveChild(root.keypair, root.document, 'example', oas.EntityKind.Agent,
    'claude-hooks', '/claude-hooks', new Date().toISOString());
  // The signer seam consumes the same identity projection in SDK 0.7.2 and
  // 0.7.3. The mandatory installed-archive consumer separately tests the full
  // OAS adapter → OpenAgentRuntime → Claude composition, with no source import.
  const agent = { did: child.document.id, document: parseIdentityDocument({
    did: child.document.id, parent: root.document.id,
    publicKeyMultibase: child.keypair.publicKeyMultibase(), kind: 'agent',
    scopes: [sdkToolScope('Read')], createdAt: child.document.proof!.created,
  }) };
  expect(createSdkAgentIdentity(agent).sign).toBeUndefined();
  expect(() => createSdkAgentIdentity(agent, { publicKey: root.keypair.publicKeyMultibase(), sign: bytes => root.keypair.sign(bytes) })).toThrow(/public key/);
  const identity = createSdkAgentIdentity(agent, { publicKey: agent.document.publicKeyMultibase,
    sign: payload => child.keypair.sign(payload) });
  const message = new TextEncoder().encode('actual OAS → SDK → Claude signing custody');
  const signature = await identity.sign!(message);
  const publicKey = oas.multibaseDecode(agent.document.publicKeyMultibase);
  expect(await oas.OasKeyPair.verifyWithKey(publicKey, message, signature)).toBe(true);
  expect(await oas.OasKeyPair.verifyWithKey(publicKey, new Uint8Array([1]), signature)).toBe(false);
  const sink = new InMemoryAuditSink();
  const adapter = createOpenAgentHooks({ agent: identity, audit: sink,
    capabilities: new StaticCapabilityChecker([sdkToolScope('Read'), sdkToolScope('Skill'), sdkSkillScope('read-notes')]) });
  // A real compile-time Options assignment prevents invented plugin/hook contracts.
  const options: Pick<Options, 'hooks'> = { hooks: adapter.hooks };
  const base = { session_id: 'actual-session', transcript_path: '/dev/null', cwd: '.' };
  const run = async (input: HookInput) => options.hooks![input.hook_event_name]![0]!.hooks[0]!(input, 'call-1', { signal: new AbortController().signal });
  const tool = (tool_name: string, tool_input: unknown): HookInput => ({ ...base, hook_event_name: 'PreToolUse', tool_name, tool_input, tool_use_id: 'call-1' });
  expect(await run(tool('Read', {}))).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
  await run({ ...base, hook_event_name: 'SessionStart', source: 'startup' });
  expect(await run(tool('Read', { file_path: 'README.md' }))).toEqual({});
  expect(await run(tool('Bash', { command: 'rm' }))).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
  expect(await run(tool('Skill', { skill: 'read-notes' }))).toEqual({});
  expect(await run(tool('Skill', { skill: 'deploy' }))).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
  await run({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: 'README.md' }, tool_response: 'contents', tool_use_id: 'call-1' });
  await run({ ...base, hook_event_name: 'PostToolUseFailure', tool_name: 'Read', tool_input: {}, error: 'not found', tool_use_id: 'call-2' });
  await run({ ...base, hook_event_name: 'SessionEnd', reason: 'other' });
  expect(verifyChain(sink.records)).toEqual({ valid: true });
  expect(sink.records.some(record => record.kind === 'tool.complete' && record.outcome === 'error')).toBe(true);
  expect(await run(tool('Read', {}))).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
});
