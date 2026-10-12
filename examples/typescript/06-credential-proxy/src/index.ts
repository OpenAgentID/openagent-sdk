import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { createServer, type Server, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AgentCapabilityToken, AgentIdentity, ArsenalClient, KeyFingerprint,
  ScopeSet, TenantId, buildTokenClaims } from '@openagentid/arsenal-sdk';
import { createArsenalCapabilityFetch } from '@openagentid/sdk/integrations/arsenal';

async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

// Two actual local services and disposable credentials. This single-process
// demonstration is a broker protocol example, not production secret custody.
const upstreamSecret = randomBytes(32).toString('base64url');
const upstream = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${upstreamSecret}`) { res.writeHead(401).end(); return; }
  const payload = await body(req);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(payload);
});
const upstreamOrigin = await listen(upstream);
const target = `${upstreamOrigin}/echo`;
const issuer = generateKeyPairSync('ed25519');
const registrationToken = randomBytes(32).toString('base64url');
const identity = AgentIdentity.create(TenantId.generate(), 'local-proxy-agent', KeyFingerprint.fromBytes(randomBytes(32)));
const broker = createServer(async (req, res) => {
  const reply = (status: number, value: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  try {
    if (req.headers.authorization !== `Bearer ${registrationToken}`) { reply(401, { message: 'Unknown local registration' }); return; }
    const payload = JSON.parse((await body(req)).toString());
    if (req.url === '/v1/capabilities') {
      if (payload.audience !== upstreamOrigin || JSON.stringify(payload.scopes) !== JSON.stringify(['echo:message:write'])) {
        reply(403, { message: 'Scope or audience denied' }); return;
      }
      const claims = buildTokenClaims({ subject: identity.id.toString(), issuer: 'local-example-broker',
        tenant_id: identity.tenantId.toString(), audience: upstreamOrigin,
        scopes: ScopeSet.fromStrings(payload.scopes), ttl_seconds: 60 });
      const unsigned = AgentCapabilityToken.fromClaims(claims);
      const token = AgentCapabilityToken.fromClaimsAndSignature(claims, {
        algorithm: 'ED25519', bytes: sign(null, unsigned.claimsToCbor(), issuer.privateKey), key_id: 'local-example-issuer',
      });
      reply(200, { token_id: token.id, token: token.toBase64Url(), expires_at: token.claims.exp, granted_scopes: token.claims.scope });
      return;
    }
    if (req.url !== '/v1/proxy') { reply(404, { message: 'Unknown route' }); return; }
    const token = AgentCapabilityToken.fromBase64Url(payload.capability_token);
    if (!token.signature || !verify(null, token.claimsToCbor(), issuer.publicKey, token.signature.bytes) ||
        !token.isTimeValid() || token.subject !== identity.id.toString() || token.audience !== upstreamOrigin ||
        token.claims.tenant_id !== identity.tenantId.toString() ||
        req.headers['x-arsenal-fingerprint'] !== identity.publicKeyFingerprint.toHex() ||
        payload.url !== target || payload.method !== 'POST' ||
        !token.claims.scope.includes('echo:message:write')) {
      reply(403, { message: 'Capability, fingerprint or destination denied' }); return;
    }
    // The target is pinned above; callers cannot redirect the broker elsewhere.
    const response = await fetch(target, { method: 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${upstreamSecret}`, 'content-type': 'application/json' },
      body: Buffer.from(payload.body ?? '', 'base64url') });
    reply(200, { status: response.status, headers: { 'content-type': 'application/json' },
      body: Buffer.from(await response.arrayBuffer()).toString('base64url'),
      proxy_metadata: { variables_resolved: ['LOCAL_UPSTREAM_TOKEN'], destination_verified: true,
        fingerprint_verified: true, consent_status: 'not_required', latency_ms: 0, request_id: crypto.randomUUID() } });
  } catch { reply(400, { message: 'Invalid local broker request' }); }
});
const brokerOrigin = await listen(broker);
const client = ArsenalClient.create({ identity, autoRenew: false, defaultAudience: upstreamOrigin,
  broker: { baseUrl: brokerOrigin, defaultHeaders: { authorization: `Bearer ${registrationToken}` } } });
try {
  await client.startSession();
  const capability = await client.requestCapabilityForScopes(['echo:message:write'], 60);
  const binding = { did: 'did:oas:example:agent:proxy', agentId: identity.id.toString(),
    tenantId: identity.tenantId.toString(), audience: upstreamOrigin };
  const proxyFetch = createArsenalCapabilityFetch({ client, capability, binding,
    authorizeBinding: async candidate => candidate.did === binding.did && candidate.agentId === binding.agentId &&
      candidate.tenantId === binding.tenantId && candidate.audience === binding.audience,
    allowedOrigins: [upstreamOrigin] });
  const payload = { hello: 'Through an actual signed capability and HTTP proxy' };
  const response = await proxyFetch(new Request(target, { method: 'POST', body: JSON.stringify(payload) }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), payload);
  assert.equal((await fetch(target, { method: 'POST' })).status, 401);
  await assert.rejects(proxyFetch('https://example.com/not-allowed'));
  console.log('Verified: capability signature, tenant and DID binding, actual proxy request, destination policy, upstream authentication.');
} finally {
  await client.endSession();
  await close(broker);
  await close(upstream);
}
