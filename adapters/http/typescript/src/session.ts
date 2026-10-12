/**
 * Authenticated HTTP session with header attachment.
 *
 * After a successful handshake, the client holds an `AuthenticatedSession`
 * that transparently attaches OpenAgent headers to every request.
 */

import { buildOpenAgentHeader, HEADER_OPENAGENT_DID, HEADER_OPENAGENT_SESSION } from './headers.js';
import { TransportError } from './transport.js';

/** An authenticated HTTP session obtained after a successful Core Protocol identity flow. */
export class AuthenticatedSession {
  private readonly baseUrl: string;
  private readonly sessionId: string;
  private readonly peerDid: string;
  private readonly sessionToken: string;
  private readonly expiresAt: number;

  constructor(params: {
    baseUrl: string;
    sessionId: string;
    peerDid: string;
    sessionToken: string;
    expiresAt: number;
  }) {
    this.baseUrl = params.baseUrl.replace(/\/$/, '');
    this.sessionId = params.sessionId;
    this.peerDid = params.peerDid;
    this.sessionToken = params.sessionToken;
    this.expiresAt = params.expiresAt;
  }

  /** Returns true if the session has expired. */
  isExpired(): boolean {
    return Date.now() / 1000 >= this.expiresAt;
  }

  /** Returns the session ID. */
  getSessionId(): string {
    return this.sessionId;
  }

  /** Returns the peer DID. */
  getPeerDid(): string {
    return this.peerDid;
  }

  /** Returns the base URL. */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Send an authenticated fetch request.
   *
   * Attaches `Authorization: OpenAgent <token>`, `X-OpenAgent-DID`,
   * and `X-OpenAgent-Session` headers automatically.
   */
  async fetch(path: string, init?: RequestInit): Promise<Response> {
    if (this.isExpired()) throw new TransportError('Session expired; authenticate again');
    const url = this.resolveUrl(path);
    const headers = new Headers(init?.headers);
    headers.set('authorization', buildOpenAgentHeader(this.sessionToken));
    headers.set(HEADER_OPENAGENT_DID, this.peerDid);
    headers.set(HEADER_OPENAGENT_SESSION, this.sessionId);

    const resp = await fetch(url, { ...init, headers, redirect: 'error' }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'unknown error';
      throw new TransportError(`Fetch ${url} failed: ${message}`);
    });

    return resp;
  }

  /** Convenience: authenticated GET. */
  async get(path: string): Promise<Response> {
    return this.fetch(path, { method: 'GET' });
  }

  /** Convenience: authenticated POST with JSON body. */
  async post(path: string, body: unknown): Promise<Response> {
    return this.fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /** Convenience: authenticated PUT with JSON body. */
  async put(path: string, body: unknown): Promise<Response> {
    return this.fetch(path, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /** Convenience: authenticated DELETE. */
  async delete(path: string): Promise<Response> {
    return this.fetch(path, { method: 'DELETE' });
  }

  private resolveUrl(path: string): string {
    const cleanPath = path.replace(/^\//, '');
    return `${this.baseUrl}/${cleanPath}`;
  }
}
