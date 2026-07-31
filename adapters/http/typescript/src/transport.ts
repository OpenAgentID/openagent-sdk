/**
 * HTTP transport for the OpenAgent Core Protocol identity flow.
 *
 * Message semantics are defined normatively by the Core Protocol
 * Specification Section 15; this module implements the HTTP binding
 * (Section 16) with native `fetch` — Node.js 20+, Deno, Bun, Workers.
 */

import { z } from 'zod';
import { CONTENT_TYPE_JSON } from './headers.js';

/** The literal `type` value of an identity challenge (Section 15.2). */
export const CHALLENGE_TYPE = 'openagent-challenge-v1';

/** Server → Agent: a cryptographic challenge (Section 15.2). */
export interface IdentityChallenge {
  type: string;
  /** 64-character lowercase hex string (32 CSPRNG bytes). */
  nonce: string;
  /** ISO 8601 UTC, Z suffix, seconds precision. */
  timestamp: string;
  /** `scheme://host[:port]`. */
  origin: string;
  /** Optional protection-space identifier. */
  realm?: string;
}

/** Signature scheme for a proof (Section 15.3). */
export type KeyType = 'ed25519' | 'secp256k1';

/** Agent → Server: the cryptographic proof of identity (Section 15.3). */
export interface IdentityProof {
  /** Base64url (no padding) signature over the JCS-canonical challenge bytes. */
  signature: string;
  /** Base64url (no padding) raw public key. */
  public_key: string;
  key_type: KeyType;
  /** The nonce from the challenge, echoed. */
  nonce: string;
}

/** The resolution tier the server assigns (Section 15.4). */
export type TrustTier = 'anonymous' | 'identified' | 'sovereign';

/** Server → Agent: identity confirmed; session issued (Section 15.4). */
export interface IdentityVerified {
  did: string;
  trust_tier: TrustTier;
  session_token: string;
  /** ISO 8601 UTC timestamp of session expiry. */
  session_expires: string;
  capabilities?: string[];
}

/** Zod schema for challenge validation (agents MUST validate before signing). */
export const identityChallengeSchema = z
  .object({
    type: z.literal(CHALLENGE_TYPE),
    nonce: z
      .string()
      .length(64)
      .regex(/^[0-9a-f]{64}$/, 'nonce must be 64 lowercase hex characters'),
    timestamp: z
      .string()
      .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
        'timestamp must be ISO 8601 UTC with Z suffix and seconds precision',
      ),
    origin: z.string().regex(/^https?:\/\/[^\s/]+(:[0-9]+)?$/, 'origin must be scheme://host[:port]'),
    realm: z.string().min(1).optional(),
  })
  .strict();

/** Zod schema for the verified session message. */
export const identityVerifiedSchema = z.object({
  did: z.string().min(1),
  trust_tier: z.enum(['anonymous', 'identified', 'sovereign']),
  session_token: z.string().min(1),
  session_expires: z.string().min(1),
  capabilities: z.array(z.string()).optional(),
});

/**
 * The JCS-canonical (RFC 8785) UTF-8 bytes of a challenge object.
 *
 * Scoped to the challenge shape: a flat object whose values are strings (or
 * absent). JCS for that shape is lexicographic key order, no whitespace, and
 * JSON string escaping — which is exactly what this produces. Do not reuse
 * for nested or numeric payloads; pull in a full JCS implementation there.
 */
export function canonicalChallengeBytes(challenge: IdentityChallenge): Uint8Array {
  const members: [string, string][] = [
    ['nonce', challenge.nonce],
    ['origin', challenge.origin],
    ['timestamp', challenge.timestamp],
    ['type', challenge.type],
  ];
  if (challenge.realm !== undefined) {
    members.push(['realm', challenge.realm]);
    members.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }
  const body = members.map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',');
  return new TextEncoder().encode(`{${body}}`);
}

/** Transport error with HTTP context. */
export class TransportError extends Error {
  public readonly statusCode: number | undefined;
  public readonly responseBody: string | undefined;

  constructor(message: string, statusCode?: number, responseBody?: string) {
    super(message);
    this.name = 'TransportError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Configuration for the HTTP transport. */
export interface HttpTransportConfig {
  /** Request timeout in milliseconds. Default: 30000. */
  timeoutMs?: number;
  /** Custom headers to include in all requests. */
  headers?: Record<string, string>;
}

/** HTTP transport carrying the identity flow over REST. */
export class HttpTransport {
  private readonly config: Required<Pick<HttpTransportConfig, 'timeoutMs'>> & HttpTransportConfig;

  constructor(config: HttpTransportConfig = {}) {
    this.config = {
      ...config,
      timeoutMs: config.timeoutMs ?? 30_000,
    };
  }

  /** Fetch a challenge from the auth endpoint (proactive flow). */
  async fetchChallenge(endpoint: string): Promise<IdentityChallenge> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { accept: CONTENT_TYPE_JSON, ...this.config.headers },
        signal: controller.signal,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '<unreadable>');
        throw new TransportError(`challenge endpoint returned HTTP ${resp.status}: ${text}`, resp.status, text);
      }
      const body: unknown = await resp.json();
      // An agent MUST reject a malformed challenge before signing it.
      return identityChallengeSchema.parse(body);
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Send a proof, receive the verified session. */
  async prove(endpoint: string, proof: IdentityProof): Promise<IdentityVerified> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': CONTENT_TYPE_JSON,
          accept: CONTENT_TYPE_JSON,
          ...this.config.headers,
        },
        body: JSON.stringify(proof),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '<unreadable>');
        throw new TransportError(`prove endpoint returned HTTP ${resp.status}: ${text}`, resp.status, text);
      }
      const body: unknown = await resp.json();
      return identityVerifiedSchema.parse(body);
    } finally {
      clearTimeout(timeout);
    }
  }
}
