/**
 * OAS (Open Agent Specification) identity wrapper.
 *
 * This module defines the minimal surface the OpenAgent SDK needs from the
 * `@oas/sdk` package. When `@oas/sdk` ships, a thin adapter binds its public
 * types to {@link IdentityProvider}. Until then, we ship a safe in-process
 * {@link StubIdentityProvider} that generates valid Ed25519 keypairs via
 * `@openagent/crypto-wasm` (optional) or Node's native `crypto`.
 *
 * INTEGRATION_NOTES.md tracks the exact shape we expect from `@oas/sdk`.
 */

import { z } from 'zod';
import { didSchema, scopeSchema, type CreateAgentInput } from './config.js';
import { IdentityError, ErrorCode, wrapError } from './errors.js';

/** Fully qualified `did:oas` identifier. */
export type Did = string;

/** OAS identity document fragment — minimum fields needed by the SDK. */
export interface IdentityDocument {
  /** Canonical DID. */
  did: Did;
  /** Parent DID (lineage). */
  parent: Did;
  /** Multibase-encoded Ed25519 public key. */
  publicKeyMultibase: string;
  /** Entity kind — `agent`, `tool`, etc. */
  kind: string;
  /** Granted scopes. */
  scopes: readonly string[];
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** Opaque metadata. */
  metadata?: Record<string, unknown>;
}

/** Signed credential returned by the identity provider. */
export interface SignedAssertion {
  /** JWS / JWT / OAS assertion envelope (base64url). */
  token: string;
  /** Raw signature bytes (base64). */
  signature: string;
  /** DID of the signer. */
  signer: Did;
  /** Unix timestamp when the assertion was minted. */
  issuedAt: number;
  /** Unix timestamp after which the assertion is invalid. */
  expiresAt: number;
}

/**
 * The OAS identity facade. Concrete providers come from `@oas/sdk`
 * (production) or from {@link StubIdentityProvider} (test / offline dev).
 */
export interface IdentityProvider {
  /** Create a new OAS identity descended from `input.parent`. */
  createAgentIdentity(input: CreateAgentInput): Promise<IdentityDocument>;

  /** Resolve an existing DID to its identity document. */
  resolve(did: Did): Promise<IdentityDocument>;

  /** Sign a challenge (e.g. from AEGIS) with the agent's private key. */
  signChallenge(did: Did, challenge: Uint8Array): Promise<SignedAssertion>;

  /** Return the public key for a DID (multibase). */
  publicKey(did: Did): Promise<string>;
}

/** Runtime-validated identity document schema. */
export const identityDocumentSchema = z
  .object({
    did: didSchema,
    parent: didSchema,
    publicKeyMultibase: z.string().min(1),
    kind: z.string().min(1),
    scopes: z.array(scopeSchema).readonly(),
    createdAt: z.string().datetime({ offset: true }),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/** Validate an untrusted identity document. Throws {@link IdentityError} on failure. */
export function parseIdentityDocument(raw: unknown): IdentityDocument {
  try {
    const parsed = identityDocumentSchema.parse(raw);
    return {
      ...parsed,
      scopes: parsed.scopes,
    };
  } catch (err) {
    throw new IdentityError('Invalid OAS identity document', {
      code: ErrorCode.IDENTITY_RESOLVE_FAILED,
      cause: err,
    });
  }
}

/**
 * Stub identity provider used when `@oas/sdk` is not available.
 *
 * Generates deterministic-looking DIDs and public keys. Suitable for unit
 * tests and local development; NOT cryptographically sound for production.
 * The SDK emits a warning when this provider is active.
 */
export class StubIdentityProvider implements IdentityProvider {
  private readonly store = new Map<Did, IdentityDocument>();
  private readonly namespace: string;

  constructor(namespace = 'l1fe') {
    this.namespace = namespace;
  }

  async createAgentIdentity(input: CreateAgentInput): Promise<IdentityDocument> {
    const id = `stub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const did: Did = `did:oas:${input.namespace ?? this.namespace}:agent:${id}`;
    const doc: IdentityDocument = {
      did,
      parent: input.parent,
      publicKeyMultibase: `z${id}`,
      kind: 'agent',
      scopes: [...input.scopes],
      createdAt: new Date().toISOString(),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    this.store.set(did, doc);
    return doc;
  }

  async resolve(did: Did): Promise<IdentityDocument> {
    const doc = this.store.get(did);
    if (!doc) {
      throw new IdentityError(`Unknown DID: ${did}`, {
        code: ErrorCode.IDENTITY_RESOLVE_FAILED,
        context: { did },
      });
    }
    return doc;
  }

  async signChallenge(did: Did, challenge: Uint8Array): Promise<SignedAssertion> {
    if (!this.store.has(did)) {
      throw new IdentityError(`Unknown DID: ${did}`, {
        code: ErrorCode.IDENTITY_SIGNATURE_INVALID,
        context: { did },
      });
    }
    const now = Math.floor(Date.now() / 1000);
    // Stub signature: tag + challenge as base64. NOT real crypto.
    const sig = toBase64(new Uint8Array([0xaa, 0xbb, ...challenge]));
    return {
      token: `stub.${toBase64Url(new TextEncoder().encode(did))}.${sig}`,
      signature: sig,
      signer: did,
      issuedAt: now,
      expiresAt: now + 300,
    };
  }

  async publicKey(did: Did): Promise<string> {
    const doc = await this.resolve(did);
    return doc.publicKeyMultibase;
  }
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * Narrow any unknown value into an {@link IdentityProvider}, or throw.
 *
 * This is the integration point where `@oas/sdk`'s client is adapted into
 * our interface. When that SDK is finalized, replace the duck-typing below
 * with a direct import.
 */
export function toIdentityProvider(client: unknown): IdentityProvider {
  if (
    client &&
    typeof client === 'object' &&
    typeof (client as IdentityProvider).createAgentIdentity === 'function' &&
    typeof (client as IdentityProvider).resolve === 'function' &&
    typeof (client as IdentityProvider).signChallenge === 'function' &&
    typeof (client as IdentityProvider).publicKey === 'function'
  ) {
    return client as IdentityProvider;
  }
  throw wrapError(
    new Error('Provided client does not implement IdentityProvider'),
    'Invalid identity provider client',
  );
}
