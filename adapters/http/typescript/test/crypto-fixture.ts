import { generateKeyPairSync, sign } from 'node:crypto';
import { canonicalChallengeBytes, type IdentityChallenge, type IdentityProof, type KeyType } from '../src/transport.js';

export function makeIdentity(keyType: KeyType = 'ed25519', did = 'did:oas:example:agent:alice') {
  const pair = keyType === 'ed25519' ? generateKeyPairSync('ed25519') :
    generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const publicKeyBase64Url = keyType === 'ed25519' ? jwk.x! : Buffer.concat([
    Buffer.from([2 + (Buffer.from(jwk.y!, 'base64url').at(-1)! & 1)]),
    Buffer.from(jwk.x!, 'base64url'),
  ]).toString('base64url');
  const signBytes = async (payload: Uint8Array) => (keyType === 'ed25519' ?
    sign(null, payload, pair.privateKey) :
    sign('sha256', payload, { key: pair.privateKey, dsaEncoding: 'ieee-p1363' })).toString('base64url');
  return {
    did, jwk, publicKeyBase64Url, sign: signBytes,
    resolve: async (requestedDid: string, requestedType: KeyType) =>
      requestedDid === did && requestedType === keyType ? publicKeyBase64Url : null,
    proof: async (challenge: IdentityChallenge): Promise<IdentityProof> => ({
      did, key_type: keyType, public_key: publicKeyBase64Url,
      nonce: challenge.nonce, signature: await signBytes(canonicalChallengeBytes(challenge)),
    }),
  };
}
