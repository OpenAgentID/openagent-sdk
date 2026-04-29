/**
 * OIDC discovery -- fetches and caches `.well-known/openid-configuration`.
 *
 * Implements OpenID Connect Discovery 1.0.
 */

import { z } from 'zod';
import { OidcBridgeError } from './errors.js';

/** Subset of the OpenID Connect Discovery document we need. */
export const discoveryDocumentSchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.string().default(''),
  token_endpoint: z.string().default(''),
  jwks_uri: z.string().min(1, 'Discovery document must have jwks_uri'),
  response_types_supported: z.array(z.string()).default([]),
  subject_types_supported: z.array(z.string()).default([]),
  id_token_signing_alg_values_supported: z.array(z.string()).default([]),
  scopes_supported: z.array(z.string()).default([]),
  token_exchange_endpoint: z.string().optional(),
});

export type DiscoveryDocument = z.infer<typeof discoveryDocumentSchema>;

interface CachedDiscovery {
  readonly document: DiscoveryDocument;
  readonly fetchedAt: number;
}

/** Build the `.well-known/openid-configuration` URL from an issuer. */
export function wellKnownUrl(issuer: string): string {
  const base = issuer.replace(/\/+$/, '');
  if (!base) {
    throw OidcBridgeError.discovery('Issuer URL is empty');
  }
  return `${base}/.well-known/openid-configuration`;
}

/** OIDC discovery client with per-issuer caching. */
export class DiscoveryClient {
  private readonly cache = new Map<string, CachedDiscovery>();
  private readonly cacheTtlMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(
    fetchImpl: typeof globalThis.fetch,
    timeoutMs: number = 10_000,
    cacheTtlMs: number = 3_600_000,
  ) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.cacheTtlMs = cacheTtlMs;
  }

  /** Fetch (or return cached) the discovery document for the given issuer. */
  async discover(issuer: string): Promise<DiscoveryDocument> {
    const cached = this.cache.get(issuer);
    if (cached && Date.now() - cached.fetchedAt < this.cacheTtlMs) {
      return cached.document;
    }

    const url = wellKnownUrl(issuer);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'openagent-oidc/0.1.0' },
      });
    } catch (err) {
      throw OidcBridgeError.discovery(
        `Failed to fetch discovery for ${issuer}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw OidcBridgeError.discovery(
        `Discovery endpoint returned HTTP ${response.status}: ${url}`,
      );
    }

    const raw: unknown = await response.json();
    const parsed = discoveryDocumentSchema.safeParse(raw);

    if (!parsed.success) {
      throw OidcBridgeError.discovery(
        `Failed to parse discovery document: ${parsed.error.message}`,
      );
    }

    const doc = parsed.data;

    // Validate issuer match (OIDC spec requirement).
    if (doc.issuer !== issuer) {
      throw OidcBridgeError.discovery(
        `Issuer mismatch: config says '${issuer}', discovery says '${doc.issuer}'`,
      );
    }

    this.cache.set(issuer, { document: doc, fetchedAt: Date.now() });
    return doc;
  }

  /** Invalidate a specific cache entry. */
  invalidate(issuer: string): void {
    this.cache.delete(issuer);
  }

  /** Invalidate all cache entries. */
  invalidateAll(): void {
    this.cache.clear();
  }
}
