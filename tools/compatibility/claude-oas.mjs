// Copy into a clean consumer directory and run there. Every application import
// below resolves to an installed archive, never a repository source file.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import * as oas from '@openagentid/oas-sdk';
import { OpenAgentRuntime } from '@openagentid/sdk';
import { createOasIdentityProvider } from '@openagentid/sdk/integrations/oas';
import { createSdkAgentIdentity, createOpenAgentHooks, sdkToolScope,
  StaticCapabilityChecker, InMemoryAuditSink, verifyChain } from '@openagentid/claude-agent';

const root = await oas.createHmr('example', 'packed-consumer-owner', new Date().toISOString());
const registrations = new Map([[root.document.id, { ...root, scopes: [sdkToolScope('Read')] }]]);
const store = {
  get: async did => registrations.get(did),
  resolve: async did => registrations.get(did)?.document,
  put: async entry => {
    if (registrations.has(entry.document.id)) throw new Error('Duplicate DID');
    registrations.set(entry.document.id, entry);
  },
};
const provider = createOasIdentityProvider({ oas, store, audience: 'packed-claude-consumer',
  authorizeCreation: async (request, parent) => {
    if (request.scopes.some(scope => !parent.scopes.includes(scope))) throw new Error('Scope amplification');
    return request.scopes;
  },
});
const runtime = new OpenAgentRuntime({ namespace: 'example', clients: { identity: provider } });
const agent = await runtime.createAgent({ parent: root.document.id, name: 'Packed Claude consumer',
  scopes: [sdkToolScope('Read')] });
assert.equal(createSdkAgentIdentity(agent).sign, undefined, 'Envelope signing must not masquerade as raw signing');
assert.throws(() => createSdkAgentIdentity(agent, {
  publicKey: root.keypair.publicKeyMultibase(), sign: payload => root.keypair.sign(payload),
}), /public key/);
const identity = createSdkAgentIdentity(agent, { publicKey: agent.document.publicKeyMultibase,
  sign: payload => provider.signBytes(agent.did, payload) });
const message = new TextEncoder().encode('installed OAS → SDK → Claude');
const signature = await identity.sign(message);
const publicKey = oas.multibaseDecode(identity.publicKey);
assert.equal(await oas.OasKeyPair.verifyWithKey(publicKey, message, signature), true);
assert.equal(await oas.OasKeyPair.verifyWithKey(publicKey, new Uint8Array([0]), signature), false);
const assertion = await provider.signChallenge(agent.did, message);
assert.equal(await oas.OasKeyPair.verifyWithKey(publicKey, message,
  Buffer.from(assertion.signature, 'base64')), false, 'Challenge JWT signs its envelope, not raw bytes');

const audit = new InMemoryAuditSink();
const hooks = createOpenAgentHooks({ agent: identity, audit,
  capabilities: new StaticCapabilityChecker([sdkToolScope('Read')]) }).hooks;
const base = { session_id: 'packed-consumer-session', transcript_path: '/dev/null', cwd: '.' };
const run = input => hooks[input.hook_event_name][0].hooks[0](input, 'packed-call', {
  signal: new AbortController().signal,
});
const read = { ...base, hook_event_name: 'PreToolUse', tool_name: 'Read',
  tool_input: { file_path: 'README.md' }, tool_use_id: 'packed-call' };
assert.equal((await run(read)).hookSpecificOutput.permissionDecision, 'deny');
await run({ ...base, hook_event_name: 'SessionStart', source: 'startup' });
assert.deepEqual(await run(read), {});
assert.equal((await run({ ...read, tool_name: 'Bash', tool_input: { command: 'false' } }))
  .hookSpecificOutput.permissionDecision, 'deny');
await run({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: read.tool_input,
  tool_response: 'actual hook completion', tool_use_id: 'packed-call' });
await run({ ...base, hook_event_name: 'SessionEnd', reason: 'other' });
assert.equal((await run(read)).hookSpecificOutput.permissionDecision, 'deny');
assert.deepEqual(verifyChain(audit.records), { valid: true });
assert.ok(audit.records.length > 0);

const registration = registrations.get(agent.did);
registrations.set(agent.did, { ...registration, document: { ...registration.document, revoked: true } });
await assert.rejects(identity.sign(message), /revoked/);

const versions = {};
for (const name of ['@openagentid/sdk', '@openagentid/oas-sdk', '@openagentid/claude-agent']) {
  versions[name] = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8')).version;
}
await writeFile('claude-oas-result.json', JSON.stringify({ passed: true, versions,
  checks: ['installed subpath imports', 'OAS document creation', 'raw-byte signing', 'key mismatch denial',
    'tamper denial', 'JWT/raw-signature distinction', 'Claude lifecycle and permission hooks',
    'audit hash chain', 'revoked signer denial'] }, null, 2));
console.log('PASS: installed OAS → SDK → Claude signing, permission hooks, audit and revocation');
