import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as oas from '@openagentid/oas-sdk';
import { AegisClient, ApiKeyProvider, PluginRegistry } from '@openagentid/aegis-sdk';
import { AgentCapabilityToken, AgentIdentity, ArsenalClient, CapabilityHandle, KeyFingerprint,
  ScopeSet, TenantId, buildTokenClaims } from '@openagentid/arsenal-sdk';
import { Did, InvocationContext, SkillsPolicy } from '@openagentid/skills-policy';
import { OpenAgentRuntime } from '../src/agent.js';
import { createOasIdentityProvider, createAegisRequestAuthenticator, createArsenalCapabilityFetch,
  createSkillsPolicyInvoker, type OasIdentityRegistration, type OasIdentityStore } from '../src/integrations.js';

function identityStore(): OasIdentityStore & { entries: Map<string, OasIdentityRegistration> } {
  const entries = new Map<string, OasIdentityRegistration>();
  return { entries,
    get: async did => entries.get(did), resolve: async did => entries.get(did)?.document,
    put: async entry => {
      if (entries.has(entry.document.id)) throw new Error('Identity already registered');
      entries.set(entry.document.id, entry);
    },
  };
}

it('adapts real OAS derivation, verifies signatures and rejects scope amplification/key substitution', async () => {
  const root = await oas.createHmr('example', 'component-test', new Date().toISOString());
  const store = identityStore();
  await store.put({ ...root, scopes: ['repo:read'] });
  const provider = createOasIdentityProvider({ oas, store, audience: 'component-tests',
    authorizeCreation: async (request, parent) => {
      if (request.scopes.some(scope => !parent.scopes.includes(scope))) throw new Error('Scope amplification');
      return request.scopes;
    } });
  const runtime = new OpenAgentRuntime({ namespace: 'example', clients: { identity: provider } });
  const agent = await runtime.createAgent({ parent: root.document.id, name: 'Child', scopes: ['repo:read'] });
  const grandchild = await runtime.createAgent({ parent: agent.did, name: 'Grandchild', scopes: ['repo:read'] });
  expect(grandchild.document.parent).toBe(agent.did);
  expect((await runtime.loadAgent(agent.did)).did).toBe(agent.did);
  const proof = await provider.signChallenge(agent.did, randomBytes(32));
  const [header, payload, signature] = proof.token.split('.');
  const registration = store.entries.get(agent.did)!;
  expect(await oas.OasKeyPair.verifyWithKey(registration.keypair!.verifyingKeyBytes,
    Buffer.from(`${header}.${payload}`), Buffer.from(signature!, 'base64url'))).toBe(true);
  expect(JSON.parse(Buffer.from(payload!, 'base64url').toString()).aud).toBe('component-tests');
  await expect(runtime.createAgent({ parent: agent.did, name: 'Bad', scopes: ['repo:write'] })).rejects.toThrow();
  store.entries.set(agent.did, { ...registration, keypair: (await oas.OasKeyPair.generate()) });
  await expect(provider.signChallenge(agent.did, randomBytes(32))).rejects.toThrow(/signer/);
  store.entries.set(agent.did, { ...registration, document: { ...registration.document, revoked: true } });
  await expect(provider.resolve(agent.did)).rejects.toThrow(/revoked/);
});

it('uses actual AEGIS credential validation and rejects mismatched authorization/required scopes', async () => {
  const did = 'did:oas:example:agent:service';
  const apiKey = randomBytes(32).toString('base64url');
  const registry = new PluginRegistry();
  registry.registerAuthProvider(new ApiKeyProvider({ [apiKey]: did }));
  const client = AegisClient.withDefaults(registry);
  let mappedDid = did;
  const authenticate = createAegisRequestAuthenticator({ client,
    readCredential: async request => ({ type: 'api_key', key: request.headers.get('x-api-key') ?? '' }),
    authorizeSession: async () => ({ did: mappedDid, root: mappedDid, lineage: [mappedDid], scopes: ['repo:read'],
      expiresAt: Math.floor(Date.now() / 1000) + 60 }),
  });
  const request = new Request('https://example.com/read', { headers: { 'x-api-key': apiKey } });
  expect((await authenticate(request, { requiredScopes: ['repo:read'] })).did).toBe(did);
  await expect(authenticate(new Request(request.url))).rejects.toThrow();
  await expect(authenticate(request, { requiredScopes: ['repo:write'] })).rejects.toThrow();
  mappedDid = 'did:oas:example:agent:attacker';
  await expect(authenticate(request)).rejects.toThrow(/binding/);
  expect(client.sessions.sessionCount()).toBe(0);
});

it('enforces real contextual skills policy, argument validation, quotas and auditable invocation', async () => {
  const did = 'did:oas:example:agent:skills';
  const policy = SkillsPolicy.fromYaml(`version: 1
agent: ${did}
skills:
  read-file:
    allow: true
    rate_limit: { window: 1h, max: 1 }
    arg_constraints:
      type: object
      required: [path]
      properties: { path: { type: string } }
      additionalProperties: false
default: { allow: false }
`);
  const invoker = createSkillsPolicyInvoker({ policy, agentDid: did,
    context: ({ arguments: args }) => new InvocationContext({ agentDid: Did.parse(did), sessionId: 'actual-test-session', arguments: args }),
  });
  let calls = 0;
  await expect(invoker.invoke('delete-file', {}, () => ++calls)).rejects.toThrow();
  const result = await invoker.invoke('read-file', { path: 'README.md' }, () => ++calls);
  expect(result.result).toBe(1);
  await expect(invoker.invoke('read-file', { path: 'README.md' }, () => ++calls)).rejects.toThrow();
  expect(calls).toBe(1);
  expect(policy.auditChain().verify()).toBe(true);
  expect(result.receipt.agent).toBe(did);
  expect(() => createSkillsPolicyInvoker({ policy, agentDid: 'did:oas:example:agent:other',
    context: () => new InvocationContext({ agentDid: Did.parse(did), sessionId: 'session', arguments: {} }),
  })).toThrow(/another agent/);
});

describe('actual Arsenal client and broker wire protocol', () => {
  it('checks signed capability, fingerprint, tenant and HTTP bytes over TCP', async () => {
    const key = generateKeyPairSync('ed25519');
    const identity = AgentIdentity.create(TenantId.generate(), 'compatibility', KeyFingerprint.fromBytes(randomBytes(32)));
    const claims = buildTokenClaims({ subject: identity.id.toString(), tenant_id: identity.tenantId.toString(),
      issuer: 'local-test-broker', audience: 'component-tests', scopes: ScopeSet.fromStrings(['echo:message:write']), ttl_seconds: 300 });
    const unsigned = AgentCapabilityToken.fromClaims(claims);
    const token = AgentCapabilityToken.fromClaimsAndSignature(claims, {
      algorithm: 'ED25519', bytes: sign(null, unsigned.claimsToCbor(), key.privateKey), key_id: 'test-issuer',
    });
    let requests = 0;
    const server = createServer(async (req, res) => {
      try {
        expect(req.url).toBe('/v1/proxy');
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const received = AgentCapabilityToken.fromBase64Url(body.capability_token);
        if (!received.signature || !verify(null, received.claimsToCbor(), key.publicKey, received.signature.bytes) ||
            received.subject !== identity.id.toString() || received.claims.tenant_id !== identity.tenantId.toString() ||
            req.headers['x-arsenal-fingerprint'] !== identity.publicKeyFingerprint.toHex() || body.url !== 'https://echo.example.com/echo') {
          res.writeHead(401).end(); return;
        }
        requests++;
        expect(body.method).toBe('POST');
        const echoed = Buffer.from(body.body, 'base64url');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 200, headers: { 'content-type': 'application/json' }, body: echoed.toString('base64url'),
          proxy_metadata: { variables_resolved: [], destination_verified: true, fingerprint_verified: true,
            consent_status: 'not_required', latency_ms: 1, request_id: 'local-receipt' } }));
      } catch (error) { res.writeHead(500).end(String(error)); }
    });
    server.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const client = ArsenalClient.create({ identity, autoRenew: false,
      broker: { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` } });
    await client.startSession();
    try {
      let authorized = true;
      const proxy = createArsenalCapabilityFetch({ client, capability: new CapabilityHandle(token),
        binding: { did: 'did:oas:example:agent:proxy', agentId: identity.id.toString(), tenantId: identity.tenantId.toString(), audience: 'component-tests' },
        authorizeBinding: async () => authorized, allowedOrigins: ['https://echo.example.com'],
      });
      const request = new Request('https://echo.example.com/echo', { method: 'POST', body: JSON.stringify({ hello: 'actual bytes' }) });
      expect(await (await proxy(request)).json()).toEqual({ hello: 'actual bytes' });
      await expect(proxy('https://other.example.com')).rejects.toThrow(/destination/);
      authorized = false;
      await expect(proxy('https://echo.example.com/echo')).rejects.toThrow(/authority/);
      expect(requests).toBe(1);
    } finally {
      await client.endSession();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
