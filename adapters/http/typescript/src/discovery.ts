/**
 * Well-known discovery for OAAP endpoints.
 *
 * Servers expose `GET /.well-known/openagent` returning a JSON document
 * so clients can discover auth endpoints, supported protocol versions,
 * and required conformance levels.
 */

import { z } from 'zod';
import { TransportError } from './transport.js';

/** Conformance level enum values. */
export type ConformanceLevel = 'L0' | 'L1' | 'L2';

/** Discovery document returned by the server. */
export interface DiscoveryDocument {
  auth_endpoint: string;
  supported_versions: number[];
  server_did: string;
  required_conformance_level: ConformanceLevel;
}

/** Zod schema for DiscoveryDocument. */
export const discoveryDocumentSchema = z.object({
  auth_endpoint: z.string().min(1),
  supported_versions: z.array(z.number()),
  server_did: z.string().min(1),
  required_conformance_level: z.enum(['L0', 'L1', 'L2']),
});

/** Default well-known path. */
export const WELL_KNOWN_PATH = '/.well-known/openagent';

/** Default auth endpoint path. */
export const AUTH_ENDPOINT_PATH = '/.well-known/openagent/auth';

/** Default prove endpoint path. */
export const PROVE_ENDPOINT_PATH = '/.well-known/openagent/auth/prove';

/**
 * Fetch the discovery document from a server.
 *
 * @param baseUrl - Server base URL (e.g. `https://api.example.com`)
 * @param timeoutMs - Request timeout (default: 10000)
 */
export async function fetchDiscovery(
  baseUrl: string,
  timeoutMs = 10_000,
): Promise<DiscoveryDocument> {
  const url = `${baseUrl.replace(/\/$/, '')}${WELL_KNOWN_PATH}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
      redirect: 'error',
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '<unreadable>');
      throw new TransportError(
        `Discovery returned HTTP ${resp.status}: ${text}`,
        resp.status,
        text,
      );
    }

    const body: unknown = await resp.json();
    return discoveryDocumentSchema.parse(body);
  } finally {
    clearTimeout(timeout);
  }
}

/** Resolve the full auth endpoint URL from a base URL and discovery document. */
export function resolveAuthEndpoint(baseUrl: string, doc: DiscoveryDocument): string {
  const base = baseUrl.replace(/\/$/, '');
  const path = doc.auth_endpoint.replace(/^\//, '');
  return `${base}/${path}`;
}

/** Resolve the prove endpoint URL (auth endpoint + `/prove`). */
export function resolveProveEndpoint(baseUrl: string, doc: DiscoveryDocument): string {
  return `${resolveAuthEndpoint(baseUrl, doc)}/prove`;
}
