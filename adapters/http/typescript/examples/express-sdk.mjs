import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import express from 'express';
import { IdentityVerifier } from '@openagentid/sdk';
import { createOpenAgentMiddleware, createSdkIdentityKeyResolver, HttpAuthClient } from '@openagentid/http';
import { verifyNodeSignature } from '@openagentid/http/node';

// Deliberate local trust registration: the receiver owns this pin. Production
// services use their authoritative DID resolver, root grants and revocations.
const did = 'did:oas:example:agent:hello';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicKeyJwk = publicKey.export({ format: 'jwk' });
const issuedAt = Math.floor(Date.now() / 1000) - 1;
let revoked = false;
const resolveDid = async requested => requested === did ? {
  did, verificationMethods: [{ id: `${did}#signing`, publicKeyJwk, purposes: ['authentication'] }],
} : null;
const verifier = new IdentityVerifier({
  resolveDid,
  authorizeOwner: async () => null,
  authorizeSelfRoot: async (requested, { audience }) => requested === did ? {
    did, audience, authorizationId: 'local-example-registration', revision: '1', issuedAt,
    notBefore: issuedAt, expiresAt: issuedAt + 300, checkedAt: Math.floor(Date.now() / 1000),
  } : null,
  resolveDelegations: async () => [],
  checkRevocation: async () => ({ revoked, checkedAt: Math.floor(Date.now() / 1000) }),
  // resolve() checks lineage, not possession. HTTP separately verifies the
  // canonical challenge signature and consumes its nonce atomically.
  replay: { consume: async () => { throw new Error('Use HTTP challenge consumption for this flow'); } },
});

const app = express();
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
app.use(express.json());
app.use(createOpenAgentMiddleware({
  origin, verifySignature: verifyNodeSignature,
  resolveIdentityKey: createSdkIdentityKeyResolver({ verifier, resolveDid, audience: origin }),
}));
app.post('/hello', (req, res) => res.json({ did: req.openAgent.peerDid, message: req.body.message }));

try {
  const client = new HttpAuthClient({
    config: { did },
    sign: async payload => sign(null, payload, privateKey).toString('base64url'),
    publicKey: async () => publicKeyJwk.x,
  });
  const session = await client.authenticate(origin);
  const response = await session.post('/hello', { message: 'Hello from my actual agent' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { did, message: 'Hello from my actual agent' });
  revoked = true;
  assert.equal((await session.post('/hello', { message: 'Must be denied' })).status, 401);
  console.log('Verified: real Ed25519 + SDK trust + Express body + immediate revocation.');
} finally {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
