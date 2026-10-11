import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';
import { LifeIdFederation, ownerFromLifeIdClaims } from '../src/federation.js';

let server: Server, issuer: string, ownerKey: KeyLike, wrongKey: KeyLike;
const subject = randomBytes(16).toString('hex'), organizationId = randomBytes(16).toString('hex');
beforeAll(async () => {
  const keys = await generateKeyPair('RS256'); ownerKey = keys.privateKey;
  wrongKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'human-rsa', alg: 'RS256', use: 'sig' };
  server = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Federation test server did not bind');
  issuer = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }); });

function token(claims: Record<string, unknown> = {}, key = ownerKey, expiry = '5m') {
  return new SignJWT({ organization_id: organizationId, kind: 'human', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'human-rsa' }).setIssuer(issuer).setSubject(subject)
    .setAudience('federation-client').setIssuedAt().setExpirationTime(expiry).sign(key);
}
const federation = () => new LifeIdFederation({ issuer, audience: 'federation-client', jwksUri: `${issuer}/jwks`, test: true });

describe('LifeID federation with real fetched signing keys', () => {
  it('verifies human signature and matches issuer, subject and organization', async () => {
    const owner = { issuer, subject, organizationId };
    expect(await federation().verifyHumanToken(await token(), owner)).toEqual(owner);
  });
  it('rejects forged, expired and agent assertions', async () => {
    const owner = { issuer, subject, organizationId };
    await expect(federation().verifyHumanToken(await token({}, wrongKey), owner)).rejects.toThrow();
    await expect(federation().verifyHumanToken(await token({}, ownerKey, '-1s'), owner)).rejects.toThrow();
    await expect(federation().verifyHumanToken(await token({ kind: 'agent' }), owner)).rejects.toThrow('human');
  });
  it('rejects different owners and organization claims', async () => {
    await expect(federation().verifyHumanToken(await token(), { issuer, subject, organizationId: 'different-org' })).rejects.toThrow('own');
    await expect(federation().verifyHumanToken(await token({ oid: 'different-org' }), { issuer, subject, organizationId })).rejects.toThrow('conflicting');
  });
  it('never infers an agent from an arbitrary sub or normalizes a legacy DID into one', () => {
    expect(() => ownerFromLifeIdClaims({ iss: 'https://auth.life.one', sub: 'did:l1fe:agent:existing' })).toThrow('human');
    expect(ownerFromLifeIdClaims({ iss: 'https://auth.life.one', sub: subject, oid: organizationId })).toEqual({ issuer: 'https://auth.life.one', subject, organizationId });
  });
});
