import { describe, it, expect, beforeEach } from 'vitest';
import { keys, setKeyCryptoBinding, type KeyCryptoBinding } from '../src/keys.js';
import { OpenAgentError } from '../src/errors.js';

const seedBytes = (fill: number) => new Uint8Array(32).fill(fill);

function mockBinding(): KeyCryptoBinding {
  return {
    ed25519_generate_keypair() {
      return { signing_key: seedBytes(7), verifying_key: seedBytes(8) };
    },
    ed25519_public_from_private(sk) {
      // Deterministic stand-in for the public derivation.
      return new Uint8Array(sk.map((b) => b ^ 0xff));
    },
    x25519_generate_keypair() {
      return { secret_key: seedBytes(9), public_key: seedBytes(10) };
    },
    x25519_public_from_secret(sk) {
      return new Uint8Array(sk.map((b) => b ^ 0x55));
    },
    blake3_derive_key(_context, material) {
      // Deterministic stand-in: context-separated derivation marker.
      return new Uint8Array(material.map((b) => b ^ 0x3c));
    },
  };
}

describe('keys (key custody)', () => {
  beforeEach(() => {
    setKeyCryptoBinding(mockBinding());
  });

  it('generate produces a full key set from one seed', async () => {
    const k = await keys.generate();
    expect(k.seed.length).toBe(32);
    expect(k.signingKey.length).toBe(32);
    expect(k.verifyingKey.length).toBe(32);
    expect(k.encryptionSecretKey.length).toBe(32);
    expect(k.encryptionPublicKey.length).toBe(32);
  });

  it('fromSeed restores the same identity deterministically', () => {
    const seed = seedBytes(42);
    const a = keys.fromSeed(seed);
    const b = keys.fromSeed(seed);
    expect(a.signingKey).toEqual(b.signingKey);
    expect(a.verifyingKey).toEqual(b.verifyingKey);
    expect(a.encryptionSecretKey).toEqual(b.encryptionSecretKey);
    expect(a.encryptionPublicKey).toEqual(b.encryptionPublicKey);
  });

  it('encryption keys differ from signing keys (context separation)', () => {
    const k = keys.fromSeed(seedBytes(7));
    expect(k.encryptionSecretKey).not.toEqual(k.signingKey);
  });

  it('rejects a seed of the wrong length', () => {
    expect(() => keys.fromSeed(new Uint8Array(16))).toThrow(OpenAgentError);
  });

  it('hex round trip', () => {
    const k = keys.fromSeed(seedBytes(3));
    const hex = keys.seedToHex(k.seed);
    expect(hex.length).toBe(64);
    const restored = keys.fromSeedHex(hex);
    expect(restored.signingKey).toEqual(k.signingKey);
  });

  it('rejects malformed hex', () => {
    expect(() => keys.fromSeedHex('not-hex')).toThrow(OpenAgentError);
    expect(() => keys.fromSeedHex('abcd')).toThrow(OpenAgentError);
  });

  it('fromEnv reads the hex seed', () => {
    const hex = keys.seedToHex(seedBytes(11));
    process.env.TEST_AGENT_SEED = hex;
    const k = keys.fromEnv('TEST_AGENT_SEED');
    expect(k.seed).toEqual(seedBytes(11));
    delete process.env.TEST_AGENT_SEED;
  });

  it('fromEnv fails closed when the variable is unset', () => {
    expect(() => keys.fromEnv('DEFINITELY_UNSET_VAR')).toThrow(OpenAgentError);
  });

  it('saveSeed and fromSeedFile round trip on disk', async () => {
    const k = keys.fromSeed(seedBytes(21));
    const path = `/tmp/openagent-test-seed-${Date.now()}`;
    await keys.saveSeed(k, path);
    const restored = await keys.fromSeedFile(path);
    expect(restored.signingKey).toEqual(k.signingKey);
    const fs = await import('node:fs/promises');
    await fs.unlink(path);
  });
});
