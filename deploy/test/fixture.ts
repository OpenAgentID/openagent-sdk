import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { encode } from 'cborg';
import type { ReceiverEnvironment } from '../shared/receiver.js';

export function signingFixture() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const did = 'did:oas:example:agent:receiver-test';
  const env: ReceiverEnvironment = {
    OPENAGENT_ISSUER: 'urn:openagent:test:broker', OPENAGENT_AUDIENCE: 'urn:openagent:test:receiver',
    OPENAGENT_TENANT: 'test-tenant', OPENAGENT_REQUIRED_SCOPE: 'profile:agent:read',
    OPENAGENT_PUBLIC_KEYS: JSON.stringify([publicKey.export({ format: 'jwk' }).x]),
    OPENAGENT_REVOKED_TOKEN_IDS: '[]', OPENAGENT_REVOKED_SUBJECTS: '[]',
  };
  const mint = (overrides: Record<string, unknown> = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const claims = encode({ jti: randomUUID(), sub: did, iss: env.OPENAGENT_ISSUER,
      aud: env.OPENAGENT_AUDIENCE, iat: now, nbf: now, exp: now + 60,
      tenant_id: env.OPENAGENT_TENANT, scope: [env.OPENAGENT_REQUIRED_SCOPE], ...overrides });
    return Buffer.from(encode({ v: 1, alg: 'Ed25519', claims,
      sig: new Uint8Array(sign(null, claims, privateKey)) })).toString('base64url');
  };
  return { env, did, mint };
}
