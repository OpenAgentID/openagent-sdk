import { generateKeyPairSync, sign, verify, createHash, randomUUID, type KeyObject } from 'node:crypto';
import { OpenAgentRuntime, type IdentityDocument, type IdentityProvider } from '@openagentid/sdk';

/** Test authority using actual Ed25519 keys and signatures. No production fallback. */
export function signingAuthority(options: { uniqueDids?: boolean } = {}) {
  const keys = new Map<string, { publicKey: KeyObject; privateKey: KeyObject; document: IdentityDocument }>();
  const revoked = new Set<string>();
  const provider: IdentityProvider = {
    async createAgentIdentity(input) {
      const pair = generateKeyPairSync('ed25519');
      const did = `did:oas:${input.namespace}:agent:${options.uniqueDids ? randomUUID() : input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      const document: IdentityDocument = { did, parent: input.parent, kind: 'agent', scopes: input.scopes,
        publicKeyMultibase: `u${pair.publicKey.export({ format: 'jwk' }).x}`,
        createdAt: new Date().toISOString() };
      keys.set(did, { ...pair, document });
      return document;
    },
    async resolve(did) {
      if (revoked.has(did)) throw new Error('Revoked identity');
      const value = keys.get(did);
      if (!value) throw new Error('Unknown identity');
      return value.document;
    },
    async publicKey(did) { return (await this.resolve(did)).publicKeyMultibase; },
    async signChallenge(did, bytes) {
      await this.resolve(did);
      const signature = sign(null, bytes, keys.get(did)!.privateKey).toString('base64');
      const issuedAt = Math.floor(Date.now() / 1000);
      return { signer: did, signature, token: signature, issuedAt, expiresAt: issuedAt + 60 };
    },
  };
  return {
    issuedDids: () => [...keys.keys()],
    updateScopes: async (did: string, scopes: readonly string[]) => {
      const entry = keys.get(did);
      if (!entry || revoked.has(did)) throw new Error('Unavailable identity');
      entry.document = { ...entry.document, scopes: [...scopes] };
    },
    runtime: new OpenAgentRuntime({ namespace: 'test', clients: { identity: provider } }), provider,
    revoke: async (did: string) => { revoked.add(did); },
    verify: (did: string, bytes: Uint8Array, signature: string) => !revoked.has(did) && verify(null, bytes, keys.get(did)!.publicKey, Buffer.from(signature, 'base64')),
    fingerprint: (did: string) => createHash('sha256').update(keys.get(did)!.publicKey.export({ format: 'der', type: 'spki' })).digest('hex'),
  };
}
