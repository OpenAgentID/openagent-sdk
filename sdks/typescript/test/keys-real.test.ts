import { createRequire } from 'node:module';
import { createPrivateKey, createPublicKey, diffieHellman } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { keys, setKeyCryptoBinding, type KeyCryptoBinding } from '../src/keys.js';

const wasm = createRequire(import.meta.url)('@openagentid/crypto-wasm') as KeyCryptoBinding;
const privateKey = (secret: Uint8Array) => createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), secret]),
  format: 'der', type: 'pkcs8',
});

describe('seed restoration with real published WASM and independent Node crypto', () => {
  it('restores signing and encryption identity using the published 0.1.1 binding', async () => {
    setKeyCryptoBinding(wasm);
    const original = await keys.generate();
    const restored = keys.fromSeedHex(keys.seedToHex(original.seed));
    expect(restored).toEqual(original);
    const expectedPublic = createPublicKey(privateKey(restored.encryptionSecretKey))
      .export({ format: 'der', type: 'spki' }).subarray(-32);
    expect(Buffer.from(restored.encryptionPublicKey)).toEqual(expectedPublic);
    const peer = await keys.generate();
    const fromRestored = diffieHellman({ privateKey: privateKey(restored.encryptionSecretKey),
      publicKey: createPublicKey(privateKey(peer.encryptionSecretKey)) });
    const fromPeer = diffieHellman({ privateKey: privateKey(peer.encryptionSecretKey),
      publicKey: createPublicKey(privateKey(original.encryptionSecretKey)) });
    expect(fromRestored).toEqual(fromPeer);
  });

  it('refuses a binding that cannot restore X25519 instead of inventing a new key', () => {
    setKeyCryptoBinding({ ...wasm, x25519_public_from_secret: undefined,
      x25519_diffie_hellman: undefined } as unknown as KeyCryptoBinding);
    expect(() => keys.fromSeed(new Uint8Array(32))).toThrow('deterministic X25519');
    setKeyCryptoBinding(wasm);
  });
});
