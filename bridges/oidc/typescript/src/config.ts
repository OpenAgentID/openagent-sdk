/**
 * Configuration types for the OIDC bridge.
 *
 * Supports single-provider and multi-provider setups. The bridge auto-detects
 * the correct provider from the JWT `iss` claim at validation time.
 */

import { z } from 'zod';

/** Configuration for a single OIDC provider. */
export const providerConfigSchema = z.object({
  /** Human-readable provider name (e.g. "okta", "azure"). */
  name: z.string().min(1, 'Provider name cannot be empty'),
  /** OIDC issuer URL (must match the `iss` claim in JWTs). */
  issuer: z.string().url('Issuer must be a valid URL'),
  /** Expected `aud` claim. Omit to skip audience validation (not recommended). */
  audience: z.string().optional(),
  /** Override for the JWKS URI. Auto-discovered if omitted. */
  jwksUrl: z.string().url().optional(),
  /** Which JWT claim maps to the human identity (default: "sub"). */
  hmrClaim: z.string().min(1).default('sub'),
  /** Mapping from OIDC scopes/roles to Arsenal-style scopes. */
  scopeMapping: z.record(z.string(), z.array(z.string())).default({}),
});

export type ProviderConfig = z.infer<typeof providerConfigSchema>;

/** Top-level OIDC bridge configuration. */
export const oidcConfigSchema = z.object({
  /** List of OIDC providers. At least one is required. */
  providers: z.array(providerConfigSchema).min(1, 'At least one provider is required'),
  /** OAS namespace for minted DIDs (default: "openagent"). */
  namespace: z.string().min(1).default('openagent'),
  /** Default TTL in seconds for emitted JWTs (Flow 2). Default: 3600. */
  jwtTtlSeconds: z.number().int().positive().default(3600),
  /** HTTP timeout in milliseconds for discovery/JWKS fetches. Default: 10000. */
  httpTimeoutMs: z.number().int().positive().default(10_000),
  /** Custom fetch implementation. Defaults to globalThis.fetch. */
  fetch: z.function().optional(),
});

export type OidcConfig = z.infer<typeof oidcConfigSchema>;

/** Shorthand input for single-provider setup. */
export interface SingleProviderInput {
  /** Provider name. */
  name?: string;
  /** OIDC issuer URL. */
  issuer: string;
  /** Expected audience. */
  audience?: string;
  /** JWKS URL override. */
  jwksUrl?: string;
  /** HMR claim name. */
  hmrClaim?: string;
  /** Scope mapping. */
  scopeMapping?: Record<string, string[]>;
  /** OAS namespace. */
  namespace?: string;
  /** JWT TTL seconds. */
  jwtTtlSeconds?: number;
  /** HTTP timeout ms. */
  httpTimeoutMs?: number;
  /** Custom fetch. */
  fetch?: typeof globalThis.fetch;
}

/** Build an OidcConfig from a single-provider shorthand input. */
export function singleProviderConfig(input: SingleProviderInput): OidcConfig {
  return oidcConfigSchema.parse({
    providers: [
      {
        name: input.name ?? 'default',
        issuer: input.issuer,
        audience: input.audience,
        jwksUrl: input.jwksUrl,
        hmrClaim: input.hmrClaim ?? 'sub',
        scopeMapping: input.scopeMapping ?? {},
      },
    ],
    namespace: input.namespace ?? 'openagent',
    jwtTtlSeconds: input.jwtTtlSeconds ?? 3600,
    httpTimeoutMs: input.httpTimeoutMs ?? 10_000,
    fetch: input.fetch,
  });
}

/** Find the provider config whose issuer matches the given string. */
export function findProvider(
  config: OidcConfig,
  issuer: string,
): ProviderConfig | undefined {
  return config.providers.find((p) => p.issuer === issuer);
}

/** Resolve the fetch implementation from config or globalThis. */
export function resolveFetch(config: OidcConfig): typeof globalThis.fetch {
  const fetchImpl = (config.fetch as typeof globalThis.fetch | undefined) ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error(
      'No fetch implementation found. Pass `fetch` in OidcConfig or use Node 20+/Bun/Deno.',
    );
  }
  return fetchImpl;
}
