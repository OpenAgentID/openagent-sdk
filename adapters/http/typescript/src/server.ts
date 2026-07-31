/**
 * Framework-agnostic server-side handlers for the Core Protocol identity
 * flow over HTTP.
 *
 * These functions implement the server half of the Section 15 identity flow:
 * issue an IdentityChallenge, validate and verify an IdentityProof, and
 * return an IdentityVerified session. Framework middleware (Express, Hono,
 * Next) calls these with parsed request bodies.
 *
 * Session tokens minted here are opaque 32-byte hex strings validated
 * through the session store. JWT minting per Core Protocol Section 12 is
 * openagent-server's role; this adapter's tokens are for deployments that
 * keep session state in the store.
 */

import { z } from 'zod';
import type { ConformanceLevel, DiscoveryDocument } from './discovery.js';
import { AUTH_ENDPOINT_PATH } from './discovery.js';
import {
  canonicalChallengeBytes,
  CHALLENGE_TYPE,
  type IdentityChallenge,
  type IdentityVerified,
  type TrustTier,
} from './transport.js';
import { HEADER_OPENAGENT_SESSION, extractOpenAgentToken } from './headers.js';

/** Default session TTL in seconds. */
export const DEFAULT_SESSION_TTL_SECS = 300;

/** Default challenge TTL in seconds (Section 7: default 30s, max 300s). */
export const DEFAULT_CHALLENGE_TTL_SECS = 60;

/** Server configuration for the HTTP endpoints. */
export interface ServerConfig {
  /** The server's origin per RFC 6454 (`scheme://host[:port]`). Bound into every challenge. */
  origin: string;
  /** Optional protection-space identifier. */
  realm?: string;
  /** The trust tier assigned to verified agents. Default: anonymous. */
  trustTier?: TrustTier;
  /** Session TTL in seconds. */
  sessionTtlSecs?: number;
  /** Challenge TTL in seconds. */
  challengeTtlSecs?: number;
  /** Conformance level advertised in discovery. */
  requiredConformance?: ConformanceLevel;
}

/** Create a server config with sensible defaults. */
export function createServerConfig(origin: string, overrides?: Partial<ServerConfig>): Required<Pick<ServerConfig, 'origin' | 'trustTier' | 'sessionTtlSecs' | 'challengeTtlSecs' | 'requiredConformance'>> & ServerConfig {
  return {
    origin,
    trustTier: 'anonymous',
    sessionTtlSecs: DEFAULT_SESSION_TTL_SECS,
    challengeTtlSecs: DEFAULT_CHALLENGE_TTL_SECS,
    requiredConformance: 'L2',
    ...overrides,
  };
}

/** Session states. */
export type SessionState = 'awaiting_proof' | 'established' | 'closed';

/** A stored session. */
export interface StoredSession {
  id: string;
  state: SessionState;
  initiatorDid: string;
  responderDid: string;
  nonce: string;
  /** The exact challenge timestamp (spec format); needed to reconstruct the signed payload. */
  challengeTimestamp: string;
  createdAt: number;
  expiresAt: number;
  capabilities: string[];
}

/** Session store interface. */
export interface SessionStore {
  put(session: StoredSession): Promise<void>;
  get(sessionId: string): Promise<StoredSession | undefined>;
  remove(sessionId: string): Promise<void>;
}

/** In-memory session store for development and testing. */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, StoredSession>();

  async put(session: StoredSession): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async get(sessionId: string): Promise<StoredSession | undefined> {
    return this.sessions.get(sessionId);
  }

  async remove(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}

/** Error returned by server handlers, carrying the HTTP status to render. */
export class CoreAuthError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'CoreAuthError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Zod schema for an inbound proof. */
const identityProofSchema = z.object({
  signature: z.string().min(1),
  public_key: z.string().min(1),
  key_type: z.enum(['ed25519', 'secp256k1']),
  nonce: z.string().min(1),
});

function generateHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function specTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Handle `GET /.well-known/openagent` - returns the discovery document. */
export function handleDiscovery(config: ServerConfig & { requiredConformance?: ConformanceLevel }): DiscoveryDocument {
  return {
    auth_endpoint: AUTH_ENDPOINT_PATH,
    supported_versions: [1],
    server_did: config.origin,
    required_conformance_level: config.requiredConformance ?? 'L2',
  };
}

/**
 * Handle the challenge step - issue an IdentityChallenge.
 *
 * Records a pending session keyed by the nonce: the proof carries exactly
 * that correlation, and single-use-ness is enforced by removal.
 */
export async function handleChallenge(
  config: ServerConfig & { requiredConformance?: ConformanceLevel },
  store: SessionStore,
): Promise<IdentityChallenge> {
  const nonce = generateHex(32);
  // One instant drives both the challenge timestamp and the session record:
  // the prove step reconstructs the signed challenge from the session, so
  // the two must agree to the second or a valid proof fails to verify.
  const now = new Date();
  const challenge: IdentityChallenge = {
    type: CHALLENGE_TYPE,
    nonce,
    timestamp: specTimestamp(now),
    origin: config.origin,
    ...(config.realm !== undefined ? { realm: config.realm } : {}),
  };

  const session: StoredSession = {
    id: nonce,
    state: 'awaiting_proof',
    initiatorDid: '',
    responderDid: config.origin,
    nonce,
    challengeTimestamp: challenge.timestamp,
    createdAt: Math.floor(now.getTime() / 1000),
    expiresAt: Math.floor(now.getTime() / 1000) + (config.challengeTtlSecs ?? DEFAULT_CHALLENGE_TTL_SECS),
    capabilities: [],
  };
  await store.put(session);

  return challenge;
}

/**
 * Signature verifier function. The caller provides this (crypto-wasm,
 * libsodium, noble-ed25519, a KMS call) since Ed25519 verification is not in
 * every runtime's Web Crypto.
 */
export type VerifySignatureFn = (params: {
  publicKeyBase64Url: string;
  payload: Uint8Array;
  signatureBase64Url: string;
}) => Promise<boolean>;

/**
 * Handle the prove step - verify an IdentityProof and issue a session.
 *
 * Verification is normative-ordered: pending challenge first (present,
 * unexpired), then shape checks (nonce echo), then the signature over the
 * JCS-canonical challenge bytes. The nonce is consumed on success *and* on
 * failure - a failed answer must not be retryable, or a verifier becomes an
 * oracle.
 */
export async function handleProve(
  config: ServerConfig & { requiredConformance?: ConformanceLevel },
  store: SessionStore,
  body: unknown,
  verifySignature: VerifySignatureFn,
): Promise<IdentityVerified> {
  const proof = identityProofSchema.parse(body);

  // 1. Load the pending challenge by the echoed nonce.
  const session = await store.get(proof.nonce);
  if (!session) {
    throw new CoreAuthError(`replay detected: nonce ${proof.nonce} has no pending challenge`, 401);
  }

  const now = Math.floor(Date.now() / 1000);
  if (now >= session.expiresAt) {
    await store.remove(proof.nonce);
    throw new CoreAuthError('challenge expired', 401);
  }

  // 2. Reconstruct the exact signed payload.
  const challenge: IdentityChallenge = {
    type: CHALLENGE_TYPE,
    nonce: session.nonce,
    timestamp: session.challengeTimestamp,
    origin: session.responderDid,
    ...(config.realm !== undefined ? { realm: config.realm } : {}),
  };
  const payload = canonicalChallengeBytes(challenge);

  // 3. This server verifies Ed25519 only; a secp256k1 proof is refused with
  //    a named reason rather than misinterpreted.
  if (proof.key_type !== 'ed25519') {
    await store.remove(proof.nonce);
    throw new CoreAuthError(`this server verifies ed25519 only; got ${proof.key_type}`, 401);
  }

  // 4. Verify; consume the nonce on success and failure alike.
  const valid = await verifySignature({
    publicKeyBase64Url: proof.public_key,
    payload,
    signatureBase64Url: proof.signature,
  }).catch(async () => {
    await store.remove(proof.nonce);
    return false;
  });
  if (!valid) {
    await store.remove(proof.nonce);
    throw new CoreAuthError('signature verification failed', 401);
  }
  await store.remove(proof.nonce);

  // 5. Establish: mint an opaque session token and store the session.
  const sessionToken = generateHex(32);
  const expiresAt = now + (config.sessionTtlSecs ?? DEFAULT_SESSION_TTL_SECS);
  const established: StoredSession = {
    ...session,
    id: sessionToken,
    state: 'established',
    createdAt: now,
    expiresAt,
  };
  await store.put(established);

  return {
    did: session.initiatorDid,
    trust_tier: config.trustTier ?? 'anonymous',
    session_token: sessionToken,
    session_expires: specTimestamp(new Date(expiresAt * 1000)),
    capabilities: session.capabilities.length > 0 ? session.capabilities : undefined,
  };
}

/** Result of authenticating an incoming request. */
export interface AuthResult {
  authenticated: boolean;
  peerDid?: string;
  sessionToken?: string;
  error?: string;
}

/** Authenticate an incoming request by checking the session token. */
export async function authenticateRequest(
  request: Request,
  store: SessionStore,
): Promise<AuthResult> {
  const header = request.headers.get('authorization');
  const token = header ? extractOpenAgentToken(header) : undefined;
  const sessionToken = token ?? request.headers.get(HEADER_OPENAGENT_SESSION) ?? undefined;
  if (!sessionToken) {
    return { authenticated: false, error: 'missing credentials' };
  }

  const session = await store.get(sessionToken);
  if (!session || session.state !== 'established') {
    return { authenticated: false, error: 'unknown session' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now >= session.expiresAt) {
    await store.remove(sessionToken);
    return { authenticated: false, error: 'session expired' };
  }

  return {
    authenticated: true,
    peerDid: session.initiatorDid,
    sessionToken: session.id,
  };
}
