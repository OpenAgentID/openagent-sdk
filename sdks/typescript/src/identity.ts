/**
 * OAS (Open Agent Specification) identity wrapper.
 *
 * This module defines the minimal surface the OpenAgent SDK needs from the
 * `@openagentid/oas-sdk` package: the {@link IdentityProvider} interface and
 * runtime validation for identity documents. Production identity comes from
 * `@openagentid/oas-sdk` via `clients.identity`; test identity comes from
 * `@openagentid/sdk-testing` — never from a silent fallback. If no provider is
 * configured, calls that need one fail closed with a `ConfigError`.
 *
 * INTEGRATION_NOTES.md tracks the exact shape we expect from `@openagentid/oas-sdk`.
 */

import { z } from 'zod';
import { didSchema, scopeSchema, type CreateAgentInput } from './config.js';
import { IdentityError, ErrorCode, wrapError } from './errors.js';
import { parseAvatarOverride } from './glyph.js';
import { getCharacterSkins, type CharacterAppearance, type AvatarExpression } from './characters.js';

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
  /** User/agent-selected HTTPS avatar. Null or absent uses the selected skin. */
  avatarOverride?: string | null;
  /** Body/face skin. Absent defaults to Autos; null explicitly uses OAS Glyph. */
  avatarSkin?: CharacterAppearance | null;
  /** Preferred live-eye expression, independent of body/face skin. */
  avatarExpression?: AvatarExpression;
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
 * The OAS identity facade. Concrete providers come from `@openagentid/oas-sdk`
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

/** Versioned body/face selection. Runtime expression and gaze are independent. */
export const characterAppearanceSchema = z.object({
  skin: z.enum(['autos', 'spacex']),
  skinVersion: z.literal(1).optional(),
  eyeStyle: z.literal('live-v1').optional(),
  shape: z.enum(['standard', 'slender', 'wide', 'circle', 'pebble', 'squircle', 'capsule', 'triangle', 'hexagon', 'cloud', 'droplet']).optional(),
}).strict().superRefine((value, context) => {
  const skin = getCharacterSkins().find(entry => entry.id === value.skin)!;
  if (value.shape !== undefined && !skin.shapes.includes(value.shape)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['shape'], message: 'Unsupported shape for skin' });
  }
});

export const avatarExpressionSchema = z.enum(['neutral', 'attentive', 'surprised', 'excited',
  'happy', 'laughing', 'angry', 'sad', 'scared', 'suspicious', 'confused', 'curious',
  'proud', 'shy', 'unimpressed', 'sleepy', 'thoughtful', 'concerned']);

/** Runtime-validated identity document schema. */
export const identityDocumentSchema = z
  .object({
    did: didSchema,
    parent: didSchema,
    publicKeyMultibase: z.string().min(1),
    kind: z.string().min(1),
    scopes: z.array(scopeSchema).readonly(),
    createdAt: z.string().datetime({ offset: true }),
    avatarOverride: z.string().url().nullable().optional().transform(value => {
      return value === undefined ? undefined : parseAvatarOverride(value);
    }),
    avatarSkin: characterAppearanceSchema.nullable().optional(),
    avatarExpression: avatarExpressionSchema.optional(),
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
 * Narrow any unknown value into an {@link IdentityProvider}, or throw.
 *
 * This is the integration point where `@openagentid/oas-sdk`'s client is adapted into
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
