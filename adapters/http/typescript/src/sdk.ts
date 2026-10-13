import type { IdentityVerifier, IdentityVerifierConfig } from '@openagentid/sdk';
import type { ResolveIdentityKeyFn } from './server.js';

/** Bind HTTP sessions to the SDK's current owner/self-root authorization,
 * signed lineage and revocation checks. Use the SAME authoritative resolveDid
 * callback as IdentityVerifier; never resolve keys from request-supplied URLs. */
export function createSdkIdentityKeyResolver(options: {
  verifier: Pick<IdentityVerifier, 'resolve'>;
  resolveDid: IdentityVerifierConfig['resolveDid'];
  audience: string;
}): ResolveIdentityKeyFn {
  if (!options.audience || typeof options.verifier?.resolve !== 'function' ||
      typeof options.resolveDid !== 'function') throw new TypeError('SDK identity authorities and audience are required');
  return async (did, keyType) => {
    // SDK identity verification currently authorizes Ed25519 and RSA. This
    // protocol's raw-key format supports Ed25519 and secp256k1, so Ed25519 is
    // their intersection. Custom secp256k1 authorities use ResolveIdentityKeyFn.
    if (keyType !== 'ed25519') return null;
    const identity = await options.verifier.resolve(did, { audience: options.audience });
    if (identity.did !== did || identity.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    const document = await options.resolveDid(did);
    if (!document || document.did !== did) return null;
    const keys = document.verificationMethods.filter(method =>
      method.id.startsWith(`${did}#`) && method.id.length > did.length + 1 &&
      method.purposes.includes('authentication') && method.publicKeyJwk.kty === 'OKP' &&
      method.publicKeyJwk.crv === 'Ed25519' &&
      (method.publicKeyJwk.alg === undefined || method.publicKeyJwk.alg === 'EdDSA') &&
      (method.publicKeyJwk.use === undefined || method.publicKeyJwk.use === 'sig') &&
      (method.publicKeyJwk.key_ops === undefined || method.publicKeyJwk.key_ops.includes('verify')) &&
      !('d' in method.publicKeyJwk));
    // The HTTP v1 proof has no key id. Ambiguous rotation states fail closed;
    // choose a single authorized authentication key in the resolver view.
    if (keys.length !== 1 || document.verificationMethods.filter(method => method.id === keys[0]!.id).length !== 1) return null;
    const key = keys[0]!.publicKeyJwk.x;
    return typeof key === 'string' && /^[A-Za-z0-9_-]{43}$/.test(key) ? key : null;
  };
}
