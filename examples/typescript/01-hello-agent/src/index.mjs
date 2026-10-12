import { lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { OpenAgentWorkspace } from '@openagentid/sdk/local';

async function openOrInitialize(path) {
  try { await lstat(path); }
  catch (error) {
    if (error.code === 'ENOENT') return OpenAgentWorkspace.initialize(path, { audience: `urn:openagent:hello-agent:${randomUUID()}` });
    throw error;
  }
  return OpenAgentWorkspace.open(path);
}

const signer = await openOrInitialize('./.openagentid-signer');
const receiver = await openOrInitialize('./.openagentid-receiver');
const existing = (await signer.listAgents()).find(agent => agent.name === 'hello-agent' && agent.hasPrivateKey);
const agent = existing ?? await signer.createAgent('hello-agent');

// Running this operator-owned example deliberately trusts the public identity.
// No private key is sent to the receiving authority, and a previously revoked
// trust pin is never restored implicitly.
await receiver.trustIdentity(await signer.exportIdentity(agent.did));
const challenge = await receiver.issueChallenge(agent.did);
const proof = await signer.prove(agent.did, challenge);
const identity = await receiver.verify(proof, { nonce: challenge.nonce });
console.log(JSON.stringify({ verifiedDid: identity.did, root: identity.root.kind,
  owner: identity.owner, hostedServiceRequired: false }, null, 2));

try {
  await receiver.verify(proof, { nonce: challenge.nonce });
  throw new Error('Replay was incorrectly accepted');
} catch (error) {
  if (error.code !== 'replayed') throw error;
  console.log('The same proof was refused on replay.');
}
