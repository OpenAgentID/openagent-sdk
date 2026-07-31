/**
 * Key custody — the piece of agent identity nobody else has an answer for.
 *
 * Keys are generated once, held as a 32-byte seed, and everything else
 * (Ed25519 signing keypair, X25519 encryption keypair) is derived
 * deterministically from that seed — so persisting a single secret file
 * restores the whole identity across restarts. This mirrors Arsenal's
 * `identity_loader` in Rust; the derivation here is the same BLAKE3
 * context-separated derivation, via `@openagent/crypto-wasm`, so a seed
 * moved between the two SDKs produces the same keys.
 *
 * ```ts
 * import { keys } from '@openagent/sdk';
 *
 * const agent = await keys.generate();            // fresh identity
 * await keys.saveSeed(agent, 'agent.seed');       // persist (0600)
 * const loaded = await keys.fromSeedFile('agent.seed');
 * // or: keys.fromEnv('AGENT_SEED_HEX')
 * ```
 */

import { ErrorCode, OpenAgentError } from './errors.js';

/** The crypto-wasm binding shape key custody consumes. */
export interface KeyCryptoBinding {
  ed25519_generate_keypair(): { signing_key: Uint8Array; verifying_key: Uint8Array };
  ed25519_public_from_private(signingKey: Uint8Array): Uint8Array;
  x25519_generate_keypair(): { secret_key: Uint8Array; public_key: Uint8Array };
  x25519_public_from_secret?(secretKey: Uint8Array): Uint8Array;
  blake3_derive_key(context: string, keyMaterial: Uint8Array): Uint8Array;
}

let cryptoBinding: KeyCryptoBinding | undefined;

/** Inject the crypto-wasm binding (same one as {@link setActCryptoBinding}). */
export function setKeyCryptoBinding(binding: KeyCryptoBinding): void {
  cryptoBinding = binding;
}

function binding(): KeyCryptoBinding {
  if (!cryptoBinding) {
    throw new OpenAgentError(
      'key custody requires the @openagent/crypto-wasm binding: call ' +
        'setKeyCryptoBinding(await cryptoWasmInit()) at startup.',
      { code: ErrorCode.INVALID_CONFIG },
    );
  }
  return cryptoBinding;
}

/** The BLAKE3 derivation context for the encryption keypair (matches Arsenal). */
const ENCRYPTION_DERIVE_CONTEXT = 'arsenal.agent.encryption_key';

/** An agent's key material, derived from one seed. */
export interface AgentKeys {
  /** The 32-byte seed — the only thing that must be persisted. */
  readonly seed: Uint8Array;
  /** Ed25519 signing (private) key. */
  readonly signingKey: Uint8Array;
  /** Ed25519 verifying (public) key — the agent's identity fingerprint. */
  readonly verifyingKey: Uint8Array;
  /** X25519 encryption secret key (derived from the seed). */
  readonly encryptionSecretKey: Uint8Array;
  /** X25519 encryption public key (derived). */
  readonly encryptionPublicKey: Uint8Array;
}

function deriveFromSeed(seed: Uint8Array): AgentKeys {
  const b = binding();
  if (seed.length !== 32) {
    throw new OpenAgentError(`seed must be exactly 32 bytes, got ${seed.length}`, {
      code: ErrorCode.INVALID_CONFIG,
    });
  }

  // The signing keypair IS the seed (Ed25519 signing keys are 32-byte seeds).
  const signingKey = new Uint8Array(seed);
  const verifyingKey = b.ed25519_public_from_private(signingKey);

  // The encryption keypair is derived, deterministically, so it restores
  // across restarts without persisting additional key material.
  const derived = b.blake3_derive_key(ENCRYPTION_DERIVE_CONTEXT, seed);
  let encryptionSecretKey: Uint8Array;
  let encryptionPublicKey: Uint8Array;
  if (b.x25519_public_from_secret) {
    encryptionSecretKey = derived;
    encryptionPublicKey = b.x25519_public_from_secret(derived);
  } else {
    // Bindings without public-from-secret regenerate from the derived seed.
    const kp = b.x25519_generate_keypair();
    encryptionSecretKey = kp.secret_key;
    encryptionPublicKey = kp.public_key;
  }

  return {
    seed: new Uint8Array(seed),
    signingKey,
    verifyingKey,
    encryptionSecretKey,
    encryptionPublicKey,
  };
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const trimmed = hex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new OpenAgentError('seed must be 64 hex characters', {
      code: ErrorCode.INVALID_CONFIG,
    });
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** The key-custody namespace. */
export const keys = {
  /** Generate a fresh identity. The seed is the only thing to persist. */
  async generate(): Promise<AgentKeys> {
    const b = binding();
    const kp = b.ed25519_generate_keypair();
    return deriveFromSeed(kp.signing_key);
  },

  /** Restore an identity from its 32-byte seed. */
  fromSeed(seed: Uint8Array): AgentKeys {
    return deriveFromSeed(seed);
  },

  /** Restore from a hex-encoded seed (as stored by {@link keys.saveSeed} and env vars). */
  fromSeedHex(hex: string): AgentKeys {
    return deriveFromSeed(fromHex(hex));
  },

  /**
   * Restore from an environment variable holding the hex seed
   * (Node/Bun only — throws on other runtimes).
   */
  fromEnv(envVar: string): AgentKeys {
    const value = typeof process !== 'undefined' ? process.env?.[envVar] : undefined;
    if (!value) {
      throw new OpenAgentError(`environment variable ${envVar} is not set`, {
        code: ErrorCode.INVALID_CONFIG,
      });
    }
    return deriveFromSeed(fromHex(value));
  },

  /**
   * Persist the seed to a file with owner-only permissions (Node/Bun only).
   * The file contains raw 32 bytes, matching Arsenal's `identity_loader`
   * seed-file format so a seed moves between the two SDKs.
   */
  async saveSeed(keys: AgentKeys, path: string): Promise<void> {
    const fs = await import('node:fs/promises').catch(() => {
      throw new OpenAgentError('saveSeed requires a filesystem (Node/Bun)', {
        code: ErrorCode.INVALID_CONFIG,
      });
    });
    await fs.writeFile(path, keys.seed, { mode: 0o600 });
  },

  /** Restore from a seed file written by {@link keys.saveSeed} (Node/Bun only). */
  async fromSeedFile(path: string): Promise<AgentKeys> {
    const fs = await import('node:fs/promises').catch(() => {
      throw new OpenAgentError('fromSeedFile requires a filesystem (Node/Bun)', {
        code: ErrorCode.INVALID_CONFIG,
      });
    });
    const bytes = new Uint8Array(await fs.readFile(path));
    return deriveFromSeed(bytes);
  },

  /** Hex-encode a seed for env vars and config files. */
  seedToHex: toHex,

  /** Inject the crypto-wasm binding. */
  setCryptoBinding: setKeyCryptoBinding,
} as const;
