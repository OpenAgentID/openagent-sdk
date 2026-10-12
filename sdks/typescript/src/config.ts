/**
 * Configuration types for the OpenAgent SDK.
 *
 * The SDK is framework-agnostic: no Node, Express, Next, or Workers globals
 * are imported. Transports are injected via {@link OpenAgentConfig} so the
 * same code runs in Node 20+, Bun, Deno, browsers, and Cloudflare Workers.
 */

import { z } from 'zod';

/**
 * DID regex for `did:oas:<namespace>:<kind>:<identifier>`.
 *
 * Mirrors the OAS v1.1.0 specification. We keep it deliberately permissive
 * here — strict validation belongs in the OAS SDK itself.
 */
export const DID_REGEX =
  /^did:oas:[a-z0-9][a-z0-9-]{0,63}:(hmr|mhr|ao|enr|agent|tool|skill|workflow|model|dataset|service|agent:instance):[A-Za-z0-9._-]+$/;

/** Read existing legacy identities without rewriting their signed identifiers. */
export const LEGACY_DID_REGEX =
  /^did:l1fe:(hmr|mhr|ao|enr|agent|tool|skill|workflow|model|dataset|service|agent:instance):[A-Za-z0-9._-]+$/;

export const didSchema = z.string().max(512).refine(
  value => DID_REGEX.test(value) || LEGACY_DID_REGEX.test(value),
  'Invalid OAS or legacy DID identifier',
);

/** A parsed OAS scope string such as `openai:chat:completions`. */
export const scopeSchema = z
  .string()
  .min(1, 'Scope cannot be empty')
  .regex(
    /^[a-z0-9][a-z0-9_-]*(?::[a-z0-9*][a-z0-9_*-]*){1,4}$/,
    'Scope must be in the form provider:resource[:action[:qualifier]]',
  );

/** Provider identifier (e.g. `openai`, `github`, `stripe`). */
export const providerSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Provider must be lower-kebab-case');

/**
 * Parameters accepted by {@link OpenAgent.createAgent}.
 */
export const createAgentInputSchema = z
  .object({
    /** Parent DID — typically an HMR (human) or MHR (multi-human) root. */
    parent: didSchema,
    /** Human-readable agent name (not cryptographically significant). */
    name: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,127}$/, 'Invalid agent name'),
    /** Requested capability scopes. Must be non-empty. */
    scopes: z.array(scopeSchema).min(1, 'At least one scope is required'),
    /** Optional namespace override (defaults to `openagent`). */
    namespace: z.string().optional(),
    /** Optional skills the agent is allowed to invoke. */
    skills: z.array(z.string().min(1)).optional(),
    /** Optional free-form metadata. Persisted verbatim to the OAS document. */
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type CreateAgentInput = z.infer<typeof createAgentInputSchema>;

/** Logger interface — structured, dependency-free. */
export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

/** No-op logger used by default. */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Forward-declared clients for the three wrapped subsystems.
 *
 * Concrete interfaces live in the per-module files so that this config file
 * does not depend on internal implementation details.
 */
export interface OpenAgentClients {
  readonly identity?: unknown;
  readonly credentials?: unknown;
  readonly verification?: unknown;
}

/**
 * Global SDK configuration.
 *
 * All fields are optional at construction. Identity, credentials and request
 * verification each require their configured client when used. For a complete
 * file-backed Node identity authority, use the separate SDK `./local` export.
 */
export interface OpenAgentConfig {
  /** Override the default namespace (`openagent`). */
  namespace?: string;
  /**
   * Endpoint metadata retained on the resolved config. These values do not
   * instantiate clients. Configure the appropriate clients with their transport
   * endpoints before supplying them below.
   */
  endpoints?: {
    oasResolver?: string;
    arsenalBroker?: string;
    aegisVerifier?: string;
  };
  /**
   * Inject a custom `fetch`. Defaults to globalThis.fetch (native on Node 20+,
   * Bun, Deno, browsers, Workers).
   */
  fetch?: typeof fetch;
  /** Optional structured logger. */
  logger?: Logger;
  /** Override the abort timeout (ms) for HTTP calls. Default: 30000. */
  requestTimeoutMs?: number;
  /**
   * Pre-constructed subsystem clients. Each subsystem is required at use;
   * the facade does not construct clients from endpoint strings.
   */
  clients?: OpenAgentClients;
}

/** Resolved configuration with all defaults applied. */
export interface ResolvedOpenAgentConfig {
  namespace: string;
  endpoints: {
    oasResolver?: string;
    arsenalBroker?: string;
    aegisVerifier?: string;
  };
  fetch: typeof fetch;
  logger: Logger;
  requestTimeoutMs: number;
  clients: OpenAgentClients;
}

export const DEFAULT_NAMESPACE = 'openagent';
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** Merge user config with defaults. Pure function — does not mutate input. */
export function resolveConfig(config: OpenAgentConfig = {}): ResolvedOpenAgentConfig {
  const fetchImpl: typeof fetch | undefined =
    config.fetch ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined);

  if (!fetchImpl) {
    throw new Error(
      'OpenAgentConfig.fetch is required: no global fetch was found. ' +
        'Provide a fetch implementation explicitly (e.g. undici, node-fetch, or a polyfill).',
    );
  }

  return {
    namespace: config.namespace ?? DEFAULT_NAMESPACE,
    endpoints: {
      oasResolver: config.endpoints?.oasResolver,
      arsenalBroker: config.endpoints?.arsenalBroker,
      aegisVerifier: config.endpoints?.aegisVerifier,
    },
    fetch: fetchImpl,
    logger: config.logger ?? silentLogger,
    requestTimeoutMs: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    clients: config.clients ?? {},
  };
}
