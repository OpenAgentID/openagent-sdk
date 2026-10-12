import assert from 'node:assert/strict';
import * as oas from '@openagentid/oas-sdk';
import { OpenAgentRuntime } from '@openagentid/sdk';
import { createOasIdentityProvider, type OasIdentityRegistration, type OasIdentityStore } from '@openagentid/sdk/integrations/oas';

// Explicit local signer custody and registration. Persist these through your
// own durable store in production; never log or serialize keypair private bytes.
const registrations = new Map<string, OasIdentityRegistration>();
const store: OasIdentityStore = {
  get: async did => registrations.get(did),
  resolve: async did => registrations.get(did)?.document,
  put: async identity => {
    if (registrations.has(identity.document.id)) throw new Error('DID already exists');
    registrations.set(identity.document.id, identity);
  },
};
const root = await oas.createHmr('example', 'local-owner', new Date().toISOString());
await store.put({ ...root, scopes: ['github:pulls:read', 'github:pulls:write'] });
const identity = createOasIdentityProvider({ oas, store, audience: 'local-example',
  authorizeCreation: async (input, parent) => {
    if (input.scopes.some(scope => !parent.scopes.includes(scope))) throw new Error('Requested scopes exceed this local parent grant');
    return input.scopes;
  },
});
const runtime = new OpenAgentRuntime({ namespace: 'example', clients: { identity } });
const child = await runtime.createAgent({ parent: root.document.id, name: 'Worker', scopes: ['github:pulls:read'] });
const grandchild = await runtime.createAgent({ parent: child.did, name: 'Reader', scopes: ['github:pulls:read'] });
assert.equal(grandchild.document.parent, child.did);
await assert.rejects(runtime.createAgent({ parent: child.did, name: 'Denied', scopes: ['github:pulls:write'] }));
const chain = await oas.verifyChain(registrations.get(grandchild.did)!.document, store);
assert.equal(chain.humanRootDid, root.document.id);
console.log({ child: child.did, grandchild: grandchild.did, verifiedRoot: chain.humanRootDid, amplificationDenied: true });
// Portable signed lineage + an explicit local scope policy. A production root
// needs its own owner authority; this does not create a LifeID account or ACT.
