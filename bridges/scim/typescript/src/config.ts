/**
 * SCIM bridge configuration.
 *
 * Framework-agnostic — no Express, Hono, or Workers globals.
 */

import { z } from 'zod';

/** Logger interface matching the OpenAgent SDK convention. */
export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Configuration for the SCIM provisioning bridge. */
export interface ScimBridgeConfig {
  /**
   * OAS namespace for generated DIDs. Defaults to `openagent`.
   */
  readonly namespace?: string;

  /**
   * Bearer token(s) that SCIM clients must present.
   * Required unless allowUnauthenticated is explicitly enabled for local development.
   */
  readonly bearerTokens?: readonly string[];
  readonly allowUnauthenticated?: boolean;

  /**
   * Base URL for SCIM resource `meta.location` fields.
   * Example: `https://scim.example.com/scim/v2`
   */
  readonly baseUrl?: string;

  /** Maximum page size for list responses. Default: 100. */
  readonly maxPageSize?: number;

  /** Structured logger. */
  readonly logger?: Logger;
}

export const scimBridgeConfigSchema = z
  .object({
    namespace: z.string().min(1).default('openagent'),
    bearerTokens: z.array(z.string().min(1)).optional(),
    baseUrl: z.string().url().optional(),
    maxPageSize: z.number().int().min(1).max(1000).default(100),
  })
  .strict();

export interface ResolvedScimConfig {
  readonly namespace: string;
  readonly bearerTokens: readonly string[];
  readonly baseUrl: string;
  readonly maxPageSize: number;
  readonly logger: Logger;
}

export function resolveScimConfig(config: ScimBridgeConfig = {}): ResolvedScimConfig {
  if (!config.allowUnauthenticated && (!config.bearerTokens?.length || config.bearerTokens.some(token => !token))) {
    throw new TypeError('SCIM bearer tokens are required');
  }
  return {
    namespace: config.namespace ?? 'openagent',
    bearerTokens: config.bearerTokens ?? [],
    baseUrl: config.baseUrl ?? 'https://localhost/scim/v2',
    maxPageSize: config.maxPageSize ?? 100,
    logger: config.logger ?? silentLogger,
  };
}
