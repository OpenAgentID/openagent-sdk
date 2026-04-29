/**
 * HTTP client for initiating the OAAP handshake.
 *
 * Performs the full 4-step handshake and returns an `AuthenticatedSession`.
 */

import { fetchDiscovery, resolveAuthEndpoint } from './discovery.js';
import { AuthenticatedSession } from './session.js';
import { HttpTransport, type PresentMessage, type ProveMessage, TransportError } from './transport.js';

/** Current protocol version. */
const PROTOCOL_VERSION = 1;

/** Client configuration. */
export interface ClientConfig {
  /** The agent's DID. */
  did: string;
  /** Serialized DID document (JSON string). */
  didDocument: string;
  /** Optional serialized lineage proof. */
  lineageProof?: string;
  /** Optional conformance level claim. */
  conformanceLevel?: string;
  /** Request timeout in milliseconds. Default: 30000. */
  timeoutMs?: number;
}

/**
 * Function that signs a payload and returns a base64-encoded signature.
 *
 * The caller provides this — it may use crypto-wasm, Web Crypto, or
 * any Ed25519 implementation.
 */
export type SignFn = (payload: Uint8Array) => Promise<string>;

/**
 * HTTP client that performs the OAAP 4-step handshake.
 *
 * Usage:
 * ```ts
 * const client = new HttpAuthClient({
 *   config: { did: 'did:oas:l1fe:agent:my-bot', didDocument: '...' },
 *   sign: async (payload) => base64Encode(ed25519Sign(privateKey, payload)),
 * });
 * const session = await client.authenticate('https://api.example.com');
 * const resp = await session.get('/api/tools');
 * ```
 */
export class HttpAuthClient {
  private readonly config: ClientConfig;
  private readonly sign: SignFn;
  private readonly transport: HttpTransport;

  constructor(params: {
    config: ClientConfig;
    sign: SignFn;
    transport?: HttpTransport;
  }) {
    this.config = params.config;
    this.sign = params.sign;
    this.transport = params.transport ?? new HttpTransport({ timeoutMs: params.config.timeoutMs });
  }

  /**
   * Perform the full OAAP handshake against the given base URL.
   *
   * 1. Discovers the auth endpoint via `GET /.well-known/openagent`
   * 2. Sends PRESENT, receives CHALLENGE
   * 3. Signs the challenge, sends PROVE, receives ESTABLISHED
   * 4. Returns an `AuthenticatedSession`
   */
  async authenticate(baseUrl: string): Promise<AuthenticatedSession> {
    // Step 0: Discover endpoints.
    const doc = await fetchDiscovery(baseUrl, this.config.timeoutMs);
    const authEndpoint = resolveAuthEndpoint(baseUrl, doc);

    // Generate ephemeral key placeholder.
    // In production, this would use X25519 via crypto-wasm.
    const ephemeralBytes = new Uint8Array(32);
    crypto.getRandomValues(ephemeralBytes);
    const ephemeralPubkey = btoa(String.fromCharCode(...ephemeralBytes));

    // Step 1: PRESENT
    const present: PresentMessage = {
      version: PROTOCOL_VERSION,
      did: this.config.did,
      did_document: this.config.didDocument,
      lineage_proof: this.config.lineageProof,
      ephemeral_public_key: ephemeralPubkey,
      conformance_level: this.config.conformanceLevel,
    };

    // Step 2: CHALLENGE (returned as response to PRESENT)
    const challenge = await this.transport.present(authEndpoint, present);

    // Step 3: PROVE -- sign the challenge payload.
    // Build the canonical payload: SHA-256(session_id || nonce || did || responder_did)
    const payloadStr = `${challenge.session_id}${challenge.nonce}${this.config.did}${challenge.responder_did}`;
    const payloadBytes = new TextEncoder().encode(payloadStr);
    const hashBuffer = await crypto.subtle.digest('SHA-256', payloadBytes);
    const payload = new Uint8Array(hashBuffer);

    const signatureBase64 = await this.sign(payload);

    const prove: ProveMessage = {
      session_id: challenge.session_id,
      signature: signatureBase64,
      did: this.config.did,
    };

    // Step 4: ESTABLISHED (returned as response to PROVE)
    const established = await this.transport.prove(authEndpoint, prove);

    return new AuthenticatedSession({
      baseUrl,
      sessionId: established.session_id,
      peerDid: this.config.did,
      sessionToken: established.session_id,
      expiresAt: established.expires_at,
    });
  }
}
