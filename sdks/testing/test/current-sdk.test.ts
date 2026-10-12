import { expect, it } from 'vitest';
import { OpenAgentRuntime, parseIdentityDocument } from '@openagentid/sdk';
import { createTestingConfig, StubVerificationClient } from '../src/index.js';

it('opts in explicitly and returns documents and authorization contexts accepted by the current SDK', async () => {
  const runtime = new OpenAgentRuntime(createTestingConfig({ namespace: 'testing' }));
  const agent = await runtime.createAgent({ name: 'fixture', parent: 'did:oas:testing:hmr:owner', scopes: ['tools:read'] });
  expect(parseIdentityDocument(agent.document).did).toBe(agent.did);
  expect((await runtime.loadAgent(agent.did)).did).toBe(agent.did);
  const verifier = new StubVerificationClient();
  const request = new Request('https://fixture.invalid', { headers: { authorization: `Bearer stub:${agent.did}` } });
  expect((await verifier.verifyRequest(request)).did).toBe(agent.did);
  await expect(verifier.verifyRequest(request, { requiredScopes: ['tools:write'] })).rejects.toThrow();
  await expect(verifier.verifyRequest(new Request('https://fixture.invalid', { headers: { authorization: 'Bearer real-looking' } }))).rejects.toThrow('only accepts stub:');
});
