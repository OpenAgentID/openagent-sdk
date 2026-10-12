import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { HookInput, Options } from '@anthropic-ai/claude-agent-sdk';
import { OpenAgentWorkspace } from '@openagentid/sdk/local';
import { createOpenAgentHooks, sdkToolScope, sdkSkillScope, InMemoryAuditSink, StaticCapabilityChecker, verifyChain } from '@openagentid/claude-agent';

const directory = resolve('.openagent-example', new Date().toISOString().replaceAll(':', '-'));
await mkdir(directory, { recursive: true });
const audience = 'https://harness.example.test';
const signer = await OpenAgentWorkspace.initialize(join(directory, 'signer'), { audience: 'https://signer.example.test' });
const receiver = await OpenAgentWorkspace.initialize(join(directory, 'receiver'), { audience });
const agent = await signer.createAgent('Policy example');
const document = await signer.exportIdentity(agent.did);
await receiver.trustIdentity(document);
const policy = new StaticCapabilityChecker([sdkToolScope('Read'), sdkToolScope('Skill'), sdkSkillScope('read-notes')]);
const audit = new InMemoryAuditSink();
const adapter = createOpenAgentHooks({
  agent: { did: agent.did, kind: 'agent', publicKey: document.publicKeyJwk.x },
  audit,
  capabilities: {
    async check(scope) {
      // Recheck actual possession, receiver trust and revocation on every invocation.
      const challenge = await receiver.issueChallenge(agent.did);
      const proof = await signer.prove(agent.did, challenge);
      const verified = await receiver.verify(proof, challenge);
      assert.equal(verified.did, agent.did);
      return policy.check(scope);
    },
  },
});
// This is the actual query({ options }) contract, not a custom plugins array.
const options: Pick<Options, 'hooks'> = { hooks: adapter.hooks };
const base = { session_id: 'example', transcript_path: join(directory, 'transcript.jsonl'), cwd: process.cwd() };
const run = async (input: HookInput) => options.hooks![input.hook_event_name]![0]!.hooks[0]!(input, 'example-call', { signal: new AbortController().signal });
await run({ ...base, hook_event_name: 'SessionStart', source: 'startup' });
const read: HookInput = { ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'README.md' }, tool_use_id: 'read-1' };
assert.deepEqual(await run(read), {});
const denied = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' } };
const bash = await run({ ...read, tool_name: 'Bash', tool_input: { command: 'deploy' } });
assert.ok('hookSpecificOutput' in bash && bash.hookSpecificOutput?.hookEventName === 'PreToolUse');
assert.equal(bash.hookSpecificOutput.permissionDecision, denied.hookSpecificOutput.permissionDecision);
await receiver.revoke(agent.did);
const revoked = await run(read);
assert.ok('hookSpecificOutput' in revoked && revoked.hookSpecificOutput?.hookEventName === 'PreToolUse');
assert.equal(revoked.hookSpecificOutput.permissionDecision, 'deny');
await run({ ...base, hook_event_name: 'SessionEnd', reason: 'other' });
assert.equal(verifyChain(audit.records).valid, true);
console.log(`Verified real SDK possession, allowed Read, denied Bash and denied revoked agent ${agent.did}`);
console.log(`Use the same options.hooks with Claude Agent SDK query(). Private workspace: ${directory}`);
