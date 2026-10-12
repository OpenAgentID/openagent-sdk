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
  type KeyType,
} from './transport.js';
import { HEADER_OPENAGENT_DID, HEADER_OPENAGENT_SESSION, extractOpenAgentToken } from './headers.js';

/** Default session TTL in seconds. */
export const DEFAULT_SESSION_TTL_SECS = 300;

/** Default challenge TTL in seconds (Section 7: default 30s, max 300s). */
export const DEFAULT_CHALLENGE_TTL_SECS = 60;

/** Server configuration for the HTTP endpoints. */
export interface ServerConfig {
  /** The server's origin per RFC 6454 (`scheme://host[:port]`). Bound into every challenge. */
  origin: string;
  /** Optional server identity, distinct from the HTTP origin. */
  serverDid?: string;
  /** Authoritatively resolve the current authentication key for the claimed DID. */
  resolveIdentityKey: ResolveIdentityKeyFn;
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
export function createServerConfig(origin: string, overrides: Pick<ServerConfig, 'resolveIdentityKey'> & Partial<ServerConfig>): Required<Pick<ServerConfig, 'origin' | 'trustTier' | 'sessionTtlSecs' | 'challengeTtlSecs' | 'requiredConformance'>> & ServerConfig {
  const parsed = new URL(origin);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin ||
      parsed.username || parsed.password || typeof overrides.resolveIdentityKey !== 'function') {
    throw new TypeError('HTTP authentication requires a canonical HTTP origin and authoritative DID key resolver');
  }
  for (const ttl of [overrides.sessionTtlSecs ?? DEFAULT_SESSION_TTL_SECS,
    overrides.challengeTtlSecs ?? DEFAULT_CHALLENGE_TTL_SECS]) {
    if (!Number.isSafeInteger(ttl) || ttl <= 0) throw new TypeError('Session and challenge TTLs must be positive integer seconds');
  }
  return {
    trustTier: 'anonymous',
    sessionTtlSecs: DEFAULT_SESSION_TTL_SECS,
    challengeTtlSecs: DEFAULT_CHALLENGE_TTL_SECS,
    requiredConformance: 'L2',
    ...overrides,
    origin,
  };
}

/** Session states. */
export type SessionState = 'awaiting_proof' | 'established' | 'closed';

/** A stored session. */
export interface StoredSession {
  id: string;
  state: SessionState;
  initiatorDid: string;
  publicKeyBase64Url?: string;
  keyType?: KeyType;
  responderDid: string;
  nonce: string;
  /** The exact realm bound into the issued challenge. */
  realm?: string;
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
  /** Atomically retrieve and delete one record. Across all workers exactly one
   * caller may receive it (for example Redis GETDEL or SQL DELETE RETURNING). */
  take(sessionId: string): Promise<StoredSession | undefined>;
}

/** In-memory session store for development and testing. */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, StoredSession>();

  async put(session: StoredSession): Promise<void> {
    this.sessions.set(session.id, structuredClone(session));
  }

  async get(sessionId: string): Promise<StoredSession | undefined> {
    const value = this.sessions.get(sessionId);
    return value ? structuredClone(value) : undefined;
  }

  async take(sessionId: string): Promise<StoredSession | undefined> {
    const value = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    return value ? structuredClone(value) : undefined;
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
  did: z.string().max(512).regex(/^did:(?:oas|l1fe):[A-Za-z0-9._:-]+$/),
  signature: z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/),
  public_key: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  key_type: z.enum(['ed25519', 'secp256k1']),
  nonce: z.string().regex(/^[0-9a-f]{64}$/),
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
    server_did: config.serverDid ?? config.origin,
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
    realm: challenge.realm,
    createdAt: Math.floor(now.getTime() / 1000),
    expiresAt: Math.floor(now.getTime() / 1000) + (config.challengeTtlSecs ?? DEFAULT_CHALLENGE_TTL_SECS),
    capabilities: [],
  };
  await store.put(session);

  return challenge;
}

/** Return the current, trusted authentication key for this DID/algorithm.
 * Null denies unknown, revoked or unauthorized identities. */
export type ResolveIdentityKeyFn = (did: string, keyType: KeyType) => Promise<string | null>;

/** Verify exactly the selected algorithm; a positive result proves possession. */
export type VerifySignatureFn = (params: {
  /** Select exactly this algorithm; never infer one from untrusted key bytes. */
  keyType: KeyType;
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
  // Claim a syntactically valid correlation nonce before processing the rest
  // of the answer, including malformed or unsupported proof fields.
  const { nonce } = z.object({ nonce: z.string().regex(/^[0-9a-f]{64}$/) }).parse(body);
  const session = await store.take(nonce);
  if (!session || session.state !== 'awaiting_proof') {
    throw new CoreAuthError(`replay detected: nonce ${nonce} has no pending challenge`, 401);
  }

  const proof = identityProofSchema.parse(body);
  if (session.responderDid !== config.origin) throw new CoreAuthError('challenge origin mismatch', 401);
  const now = Math.floor(Date.now() / 1000);
  if (now >= session.expiresAt) {
    throw new CoreAuthError('challenge expired', 401);
  }

  // 2. Reconstruct the exact signed payload.
  const challenge: IdentityChallenge = {
    type: CHALLENGE_TYPE,
    nonce: session.nonce,
    timestamp: session.challengeTimestamp,
    origin: session.responderDid,
    ...(session.realm !== undefined ? { realm: session.realm } : {}),
  };
  const payload = canonicalChallengeBytes(challenge);

  // The request's public key is never an authority. Resolve and bind the DID
  // before verifying possession; unavailable/rotated/revoked keys fail closed.
  const authorizedKey = await config.resolveIdentityKey(proof.did, proof.key_type).catch(() => null);
  if (!authorizedKey || authorizedKey !== proof.public_key) {
    throw new CoreAuthError('DID authentication key is unavailable or mismatched', 401);
  }
  const valid = await verifySignature({
    keyType: proof.key_type,
    publicKeyBase64Url: authorizedKey,
    payload,
    signatureBase64Url: proof.signature,
  }).catch(() => false);
  if (valid !== true) throw new CoreAuthError('signature verification failed', 401);
  const verifiedAt = Math.floor(Date.now() / 1000);
  if (verifiedAt >= session.expiresAt) throw new CoreAuthError('challenge expired during verification', 401);

  // 5. Establish: mint an opaque session token and store the session.
  const sessionToken = generateHex(32);
  const expiresAt = verifiedAt + (config.sessionTtlSecs ?? DEFAULT_SESSION_TTL_SECS);
  const established: StoredSession = {
    ...session,
    id: sessionToken,
    state: 'established',
    initiatorDid: proof.did,
    publicKeyBase64Url: authorizedKey,
    keyType: proof.key_type,
    createdAt: verifiedAt,
    expiresAt,
  };
  await store.put(established);

  return {
    did: proof.did,
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
  resolveIdentityKey?: ResolveIdentityKeyFn,
): Promise<AuthResult> {
  const header = request.headers.get('authorization');
  const token = header ? extractOpenAgentToken(header) : undefined;
  const sessionToken = token ?? request.headers.get(HEADER_OPENAGENT_SESSION) ?? undefined;
  if (header && !token) return { authenticated: false, error: 'invalid authorization scheme' };
  if (token && request.headers.has(HEADER_OPENAGENT_SESSION) && request.headers.get(HEADER_OPENAGENT_SESSION) !== token) {
    return { authenticated: false, error: 'conflicting session credentials' };
  }
  if (!sessionToken) {
    return { authenticated: false, error: 'missing credentials' };
  }

  const session = await store.get(sessionToken);
  if (!session || session.state !== 'established' || !session.initiatorDid) {
    return { authenticated: false, error: 'unknown session' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now >= session.expiresAt) {
    await store.remove(sessionToken);
    return { authenticated: false, error: 'session expired' };
  }

  if (resolveIdentityKey) {
    const current = session.keyType && await resolveIdentityKey(session.initiatorDid, session.keyType).catch(() => null);
    if (!current || current !== session.publicKeyBase64Url) {
      await store.remove(sessionToken);
      return { authenticated: false, error: 'identity revoked, rotated or unavailable' };
    }
  }
  if (Math.floor(Date.now() / 1000) >= session.expiresAt) {
    await store.remove(sessionToken);
    return { authenticated: false, error: 'session expired during authority check' };
  }
  const claimedDid = request.headers.get(HEADER_OPENAGENT_DID);
  if (claimedDid !== null && claimedDid !== session.initiatorDid) {
    return { authenticated: false, error: 'DID does not match authenticated session' };
  }
  return {
    authenticated: true,
    peerDid: session.initiatorDid,
    sessionToken: session.id,
  };
}
