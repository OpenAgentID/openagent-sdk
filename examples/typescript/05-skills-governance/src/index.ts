import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Did, InvocationContext, SkillsPolicy } from '@openagentid/skills-policy';
import { createSkillsPolicyInvoker } from '@openagentid/sdk/integrations/skills-policy';

const policy = await SkillsPolicy.fromFile(fileURLToPath(new URL('../policy.yaml', import.meta.url)));
const did = policy.agent().toString();
const invoker = createSkillsPolicyInvoker({ policy, agentDid: did,
  context: ({ arguments: args }) => new InvocationContext({
    agentDid: Did.parse(did), sessionId: 'local-example', arguments: args,
  }),
});
let executed = 0;
await assert.rejects(invoker.invoke('delete-file', { path: 'README.md' }, () => ++executed));
await assert.rejects(invoker.invoke('read-file', { path: 42 }, () => ++executed));
const { result, receipt } = await invoker.invoke('read-file', { path: 'README.md' }, () => ++executed);
assert.equal(result, 1);
await assert.rejects(invoker.invoke('read-file', { path: 'README.md' }, () => ++executed));
assert.equal(executed, 1);
assert.equal(policy.auditChain().verify(), true);
console.log({ executed, receiptHash: receipt.receiptHash, deniedUnknownSkill: true, enforcedArgumentsAndRate: true });
