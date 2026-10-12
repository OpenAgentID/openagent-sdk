import { createPublicKey, verify } from 'node:crypto';
import type { VerifySignatureFn } from './server.js';

/** Real Node.js verification of the protocol's raw public keys. secp256k1
 * uses a compressed SEC1 key and SHA-256 with a 64-byte IEEE-P1363 signature. */
export const verifyNodeSignature: VerifySignatureFn = async ({ keyType, publicKeyBase64Url, payload, signatureBase64Url }) => {
  try {
    const publicKey = Buffer.from(publicKeyBase64Url, 'base64url');
    const signature = Buffer.from(signatureBase64Url, 'base64url');
    if (publicKey.toString('base64url') !== publicKeyBase64Url ||
        signature.toString('base64url') !== signatureBase64Url || signature.length !== 64) return false;
    if (keyType === 'ed25519') {
      if (publicKey.length !== 32) return false;
      const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKeyBase64Url }, format: 'jwk' });
      return verify(null, payload, key, signature);
    }
    if (keyType === 'secp256k1') {
      if (publicKey.length !== 33 || (publicKey[0] !== 2 && publicKey[0] !== 3)) return false;
      const key = createPublicKey({ key: Buffer.concat([
        Buffer.from('3036301006072a8648ce3d020106052b8104000a032200', 'hex'), publicKey,
      ]), format: 'der', type: 'spki' });
      return verify('sha256', payload, { key, dsaEncoding: 'ieee-p1363' }, signature);
    }
    return false;
  } catch {
    return false;
  }
};
