/**
 * Framework-agnostic server-side handlers for the OAAP handshake.
 *
 * These functions handle the core logic for each endpoint. Framework-specific
 * middleware (Express, Hono, etc.) calls these with parsed request bodies.
 */

import { z } from 'zod';
import type { ConformanceLevel, DiscoveryDocument } from './discovery.js';
import { AUTH_ENDPOINT_PATH, PROVE_ENDPOINT_PATH } from './discovery.js';
import type { ChallengeMessage, EstablishedMessage, PresentMessage, ProveMessage } from './transport.js';
import { extractOasToken, HEADER_OPENAGENT_SESSION } from './headers.js';

/** OAAP protocol version. */
export const PROTOCOL_VERSION = 1;

/** Default session TTL in seconds. */
export const DEFAULT_SESSION_TTL_SECS = 300;

/** Default challenge expiry in seconds. */
export const DEFAULT_CHALLENGE_EXPIRY_SECS = 60;

/** Server configuration for OAAP HTTP endpoints. */
export interface ServerConfig {
  serverDid: string;
  requiredConformance: ConformanceLevel;
  sessionTtlSecs: number;
  challengeExpirySecs: number;
}

/** Create a server config with sensible defaults. */
export function createServerConfig(serverDid: string, overrides?: Partial<ServerConfig>): ServerConfig {
  return {
    serverDid,
    requiredConformance: overrides?.requiredConformance ?? 'L2',
    sessionTtlSecs: overrides?.sessionTtlSecs ?? DEFAULT_SESSION_TTL_SECS,
    challengeExpirySecs: overrides?.challengeExpirySecs ?? DEFAULT_CHALLENGE_EXPIRY_SECS,
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

/** Zod schema for PresentMessage validation. */
const presentMessageSchema = z.object({
  version: z.number(),
  did: z.string().min(1),
  did_document: z.string().min(1),
  lineage_proof: z.string().optional(),
  ephemeral_public_key: z.string().min(1),
  conformance_level: z.string().optional(),
});

/** Zod schema for ProveMessage validation. */
const proveMessageSchema = z.object({
  session_id: z.string().min(1),
  signature: z.string().min(1),
  did: z.string().min(1),
});

/** Generate a cryptographic random string (base64). */
function generateRandom(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** Error returned by server handlers. */
export class OaapServerError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'OaapServerError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Handle `GET /.well-known/openagent` - returns the discovery document. */
export function handleDiscovery(config: ServerConfig): DiscoveryDocument {
  return {
    auth_endpoint: AUTH_ENDPOINT_PATH,
    supported_versions: [PROTOCOL_VERSION],
    server_did: config.serverDid,
    required_conformance_level: config.requiredConformance,
  };
}

/** Handle `POST /.well-known/openagent/auth` - PRESENT -> CHALLENGE. */
export async function handlePresent(
  config: ServerConfig,
  store: SessionStore,
  body: unknown,
): Promise<ChallengeMessage> {
  const msg = presentMessageSchema.parse(body);

  if (msg.version !== PROTOCOL_VERSION) {
    throw new OaapServerError(`Unsupported protocol version: ${msg.version}`, 400);
  }
  if (!msg.did.startsWith('did:')) {
    throw new OaapServerError(`Invalid DID: ${msg.did}`, 400);
  }

  const sessionId = generateRandom(24);
  const nonce = generateRandom(32);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + config.challengeExpirySecs;

  const session: StoredSession = {
    id: sessionId,
    state: 'awaiting_proof',
    initiatorDid: msg.did,
    responderDid: config.serverDid,
    nonce,
    createdAt: now,
    expiresAt,
    capabilities: [],
  };
  await store.put(session);

  return {
    session_id: sessionId,
    nonce,
    responder_did: config.serverDid,
    responder_ephemeral_public_key: msg.ephemeral_public_key,
    required_conformance_level: config.requiredConformance,
    expires_at: expiresAt,
  };
}

/** Signature verifier function type. */
export type VerifySignatureFn = (
  did: string,
  payload: Uint8Array,
  signatureBase64: string,
) => Promise<boolean>;

/** Handle `POST /.well-known/openagent/auth/prove` - PROVE -> ESTABLISHED. */
export async function handleProve(
  config: ServerConfig,
  store: SessionStore,
  body: unknown,
  verifySignature: VerifySignatureFn,
): Promise<EstablishedMessage> {
  const msg = proveMessageSchema.parse(body);

  const session = await store.get(msg.session_id);
  if (!session) {
    throw new OaapServerError(`Unknown session: ${msg.session_id}`, 401);
  }
  if (session.state !== 'awaiting_proof') {
    throw new OaapServerError(`Session not awaiting proof: ${msg.session_id}`, 401);
  }

  const now = Math.floor(Date.now() / 1000);
  if (now >= session.expiresAt) {
    await store.remove(msg.session_id);
    throw new OaapServerError(`Session expired: ${msg.session_id}`, 401);
  }

  if (session.initiatorDid !== msg.did) {
    throw new OaapServerError(
      `DID mismatch: session has ${session.initiatorDid}, prove has ${msg.did}`,
      401,
    );
  }

  // Build the expected challenge payload (BLAKE3 equivalent using SHA-256 for TS).
  const payloadStr = `${session.id}${session.nonce}${session.initiatorDid}${session.responderDid}`;
  const payloadBytes = new TextEncoder().encode(payloadStr);
  const hashBuffer = await crypto.subtle.digest('SHA-256', payloadBytes);
  const payload = new Uint8Array(hashBuffer);

  // Verify signature.
  const valid = await verifySignature(msg.did, payload, msg.signature);
  if (!valid) {
    throw new OaapServerError('Signature verification failed', 401);
  }

  // Transition to established.
  const sessionExpiresAt = now + config.sessionTtlSecs;
  const established: StoredSession = {
    ...session,
    state: 'established',
    expiresAt: sessionExpiresAt,
  };
  await store.put(established);

  return {
    session_id: session.id,
    expires_at: sessionExpiresAt,
    capabilities: session.capabilities.length > 0 ? session.capabilities : undefined,
  };
}

/** Result of authenticating an incoming request. */
export interface AuthResult {
  authenticated: boolean;
  peerDid?: string;
  sessionId?: string;
  conformanceLevel?: ConformanceLevel;
  error?: string;
}

/** Authenticate an incoming request by checking session headers. */
export async function authenticateRequest(
  request: Request,
  store: SessionStore,
): Promise<AuthResult> {
  const sessionId = request.headers.get(HEADER_OPENAGENT_SESSION);
  if (!sessionId) {
    return { authenticated: false, error: 'Missing X-OpenAgent-Session header' };
  }

  const session = await store.get(sessionId);
  if (!session) {
    return { authenticated: false, error: 'Unknown session' };
  }

  if (session.state !== 'established') {
    return { authenticated: false, error: 'Session not established' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now >= session.expiresAt) {
    await store.remove(sessionId);
    return { authenticated: false, error: 'Session expired' };
  }

  return {
    authenticated: true,
    peerDid: session.initiatorDid,
    sessionId: session.id,
  };
}
