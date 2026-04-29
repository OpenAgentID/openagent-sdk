/**
 * HTTP implementation of the OAAP AuthTransport interface.
 *
 * Carries the 4-step handshake over REST using native `fetch`.
 */

import { z } from 'zod';
import { CONTENT_TYPE_JSON } from './headers.js';

/** Step 1 — Initiator presents its identity. */
export interface PresentMessage {
  version: number;
  did: string;
  did_document: string;
  lineage_proof?: string;
  ephemeral_public_key: string;
  conformance_level?: string;
}

/** Step 2 — Responder issues a challenge. */
export interface ChallengeMessage {
  session_id: string;
  nonce: string;
  responder_did: string;
  responder_ephemeral_public_key: string;
  required_conformance_level?: string;
  expires_at: number;
}

/** Step 3 — Initiator proves ownership. */
export interface ProveMessage {
  session_id: string;
  signature: string;
  did: string;
}

/** Step 4 — Session established. */
export interface EstablishedMessage {
  session_id: string;
  expires_at: number;
  capabilities?: string[];
}

/** Zod schema for ChallengeMessage validation. */
export const challengeMessageSchema = z.object({
  session_id: z.string().min(1),
  nonce: z.string().min(1),
  responder_did: z.string().min(1),
  responder_ephemeral_public_key: z.string().min(1),
  required_conformance_level: z.string().optional(),
  expires_at: z.number(),
});

/** Zod schema for EstablishedMessage validation. */
export const establishedMessageSchema = z.object({
  session_id: z.string().min(1),
  expires_at: z.number(),
  capabilities: z.array(z.string()).optional(),
});

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

/**
 * HTTP transport for carrying the OAAP 4-step handshake.
 *
 * Uses native `fetch` — works in Node.js 20+, Deno, Bun, and Cloudflare Workers.
 */
export class HttpTransport {
  private readonly config: Required<Pick<HttpTransportConfig, 'timeoutMs'>> & HttpTransportConfig;

  constructor(config: HttpTransportConfig = {}) {
    this.config = {
      ...config,
      timeoutMs: config.timeoutMs ?? 30_000,
    };
  }

  /** Send PRESENT, receive CHALLENGE. */
  async present(endpoint: string, message: PresentMessage): Promise<ChallengeMessage> {
    const resp = await this.jsonPost(endpoint, message);
    const body: unknown = await resp.json();
    return challengeMessageSchema.parse(body);
  }

  /** Send PROVE, receive ESTABLISHED. */
  async prove(endpoint: string, message: ProveMessage): Promise<EstablishedMessage> {
    const proveUrl = `${endpoint.replace(/\/$/, '')}/prove`;
    const resp = await this.jsonPost(proveUrl, message);
    const body: unknown = await resp.json();
    return establishedMessageSchema.parse(body);
  }

  private async jsonPost(url: string, body: unknown): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': CONTENT_TYPE_JSON,
          accept: CONTENT_TYPE_JSON,
          ...this.config.headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '<unreadable>');
        throw new TransportError(
          `HTTP ${resp.status}: ${text}`,
          resp.status,
          text,
        );
      }

      return resp;
    } finally {
      clearTimeout(timeout);
    }
  }
}
