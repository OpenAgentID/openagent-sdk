/**
 * JWKS fetching, caching, and key selection.
 *
 * Uses the `jose` library for runtime-agnostic JWK operations (works in
 * Node.js, Bun, Deno, browsers, and Cloudflare Workers).
 */

import * as jose from 'jose';
import { OidcBridgeError } from './errors.js';

interface CachedJwks {
  readonly jwks: jose.JSONWebKeySet;
  readonly fetchedAt: number;
}

/** JWKS client with per-URI caching and rotation-aware refresh. */
export class JwksClient {
  private readonly cache = new Map<string, CachedJwks>();
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

  /** Fetch (or return cached) the JWKS for the given URI. */
  async fetchJwks(jwksUri: string): Promise<jose.JSONWebKeySet> {
    const cached = this.cache.get(jwksUri);
    if (cached && Date.now() - cached.fetchedAt < this.cacheTtlMs) {
      return cached.jwks;
    }

    return this.fetchAndCache(jwksUri);
  }

  /** Force-refresh the JWKS (key rotation scenario). */
  async refresh(jwksUri: string): Promise<jose.JSONWebKeySet> {
    return this.fetchAndCache(jwksUri);
  }

  /** Select a key from the JWKS matching the JWT header's kid or alg. */
  static selectKey(
    jwks: jose.JSONWebKeySet,
    kid: string | undefined,
    alg: string | undefined,
  ): jose.JWK {
    if (kid) {
      const key = jwks.keys.find((k) => k.kid === kid);
      if (!key) {
        throw OidcBridgeError.jwks(`No JWK found with kid '${kid}'`);
      }
      return key;
    }

    if (alg) {
      const candidates = jwks.keys.filter((k) => k.alg === alg);
      if (candidates.length === 0) {
        throw OidcBridgeError.jwks(`No JWK found for algorithm ${alg}`);
      }
      if (candidates.length > 1) {
        throw OidcBridgeError.jwks(
          `Ambiguous: ${candidates.length} JWKs match algorithm ${alg} but JWT has no kid`,
        );
      }
      return candidates[0];
    }

    if (jwks.keys.length === 1) {
      return jwks.keys[0];
    }

    throw OidcBridgeError.jwks('Cannot select key: no kid, no alg, and multiple keys in JWKS');
  }

  /** Invalidate a specific cache entry. */
  invalidate(jwksUri: string): void {
    this.cache.delete(jwksUri);
  }

  private async fetchAndCache(jwksUri: string): Promise<jose.JSONWebKeySet> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(jwksUri, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'openagent-oidc/0.1.0' },
      });
    } catch (err) {
      throw OidcBridgeError.jwks(
        `Failed to fetch JWKS from ${jwksUri}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw OidcBridgeError.jwks(
        `JWKS endpoint returned HTTP ${response.status}: ${jwksUri}`,
      );
    }

    const raw = (await response.json()) as jose.JSONWebKeySet;

    if (!raw.keys || raw.keys.length === 0) {
      throw OidcBridgeError.jwks(`JWKS at ${jwksUri} contains no keys`);
    }

    this.cache.set(jwksUri, { jwks: raw, fetchedAt: Date.now() });
    return raw;
  }
}
