/**
 * HTTP client for the OpenAgent Core Protocol identity flow.
 *
 * Fetches a challenge, signs the JCS-canonical challenge bytes, proves, and
 * holds the resulting session in an `AuthenticatedSession`.
 */

import { fetchDiscovery, resolveAuthEndpoint, resolveProveEndpoint } from './discovery.js';
import { AuthenticatedSession } from './session.js';
import {
  canonicalChallengeBytes,
  HttpTransport,
  type IdentityProof,
  type KeyType,
} from './transport.js';

/** Client configuration. */
export interface ClientConfig {
  /**
   * The agent's DID. Reported to the server for audit and, where the
   * deployment resolves DIDs, for trust-tier assignment. The agent proves
   * possession of the key - lineage evaluation is the server's job.
   */
  did: string;
  /** The signature scheme the `sign` function implements. */
  keyType?: KeyType;
  /** Request timeout in milliseconds. Default: 30000. */
  timeoutMs?: number;
}

/**
 * Function that signs a payload and returns a base64url (no padding)
 * encoded signature.
 *
 * The caller provides this — it may use @openagent/crypto-wasm, Web Crypto,
 * or any Ed25519 implementation.
 */
export type SignFn = (payload: Uint8Array) => Promise<string>;

/**
 * HTTP client that performs the Core Protocol identity flow.
 *
 * Usage:
 * ```ts
 * const client = new HttpAuthClient({
 *   config: { did: 'did:oas:l1fe:agent:my-bot' },
 *   sign: async (payload) => base64url(ed25519Sign(privateKey, payload)),
 *   publicKey: async () => base64url(ed25519PublicKey(privateKey)),
 * });
 * const session = await client.authenticate('https://api.example.com');
 * const resp = await session.get('/api/tools');
 * ```
 */
export class HttpAuthClient {
  private readonly config: ClientConfig;
  private readonly sign: SignFn;
  private readonly publicKey: () => Promise<string>;
  private readonly transport: HttpTransport;

  constructor(params: {
    config: ClientConfig;
    sign: SignFn;
    /** Returns the agent's raw public key, base64url (no padding). */
    publicKey: () => Promise<string>;
    transport?: HttpTransport;
  }) {
    this.config = params.config;
    this.sign = params.sign;
    this.publicKey = params.publicKey;
    this.transport = params.transport ?? new HttpTransport({ timeoutMs: params.config.timeoutMs });
  }

  /**
   * Perform the full identity flow against the given base URL.
   *
   * 1. Discovers the auth endpoints (tolerating discovery failure)
   * 2. Fetches an `openagent-challenge-v1` challenge
   * 3. Signs the JCS-canonical challenge bytes and proves
   * 4. Returns an `AuthenticatedSession` carrying the session token
   */
  async authenticate(baseUrl: string): Promise<AuthenticatedSession> {
    // Step 0: discover endpoints, tolerating servers that do not publish a
    // discovery document.
    let authEndpoint: string;
    let proveEndpoint: string;
    try {
      const doc = await fetchDiscovery(baseUrl, this.config.timeoutMs);
      authEndpoint = resolveAuthEndpoint(baseUrl, doc);
      proveEndpoint = resolveProveEndpoint(baseUrl, doc);
    } catch {
      const base = baseUrl.replace(/\/$/, '');
      authEndpoint = `${base}/.well-known/openagent/auth`;
      proveEndpoint = `${authEndpoint}/prove`;
    }

    // Step 1: fetch the challenge (validated by the transport before we sign).
    const challenge = await this.transport.fetchChallenge(authEndpoint);

    // Step 2: sign the canonical challenge bytes and prove.
    const payload = canonicalChallengeBytes(challenge);
    const proof: IdentityProof = {
      signature: await this.sign(payload),
      public_key: await this.publicKey(),
      key_type: this.config.keyType ?? 'ed25519',
      nonce: challenge.nonce,
    };
    const verified = await this.transport.prove(proveEndpoint, proof);

    // Step 3: hold the session.
    return new AuthenticatedSession({
      baseUrl,
      sessionId: verified.session_token,
      peerDid: this.config.did,
      sessionToken: verified.session_token,
      expiresAt: Math.floor(Date.parse(verified.session_expires) / 1000),
    });
  }
}
