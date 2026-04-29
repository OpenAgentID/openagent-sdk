/**
 * RFC 8693 Token Exchange implementation.
 *
 * Enables a human JWT to be exchanged for an Arsenal ACT through
 * the OIDC bridge.
 */

import { z } from 'zod';
import { OidcBridgeError } from './errors.js';

/** Standard grant type for RFC 8693 Token Exchange. */
export const GRANT_TYPE_TOKEN_EXCHANGE =
  'urn:ietf:params:oauth:grant-type:token-exchange' as const;

/** Standard token type for JWT subject tokens. */
export const TOKEN_TYPE_JWT = 'urn:ietf:params:oauth:token-type:jwt' as const;

/** Custom token type for OpenAgent ACTs. */
export const TOKEN_TYPE_ACT = 'urn:openagent:token-type:act' as const;

/** Standard token type for access tokens. */
export const TOKEN_TYPE_ACCESS =
  'urn:ietf:params:oauth:token-type:access_token' as const;

const VALID_SUBJECT_TYPES = [TOKEN_TYPE_JWT, TOKEN_TYPE_ACCESS] as const;
const VALID_REQUESTED_TYPES = [TOKEN_TYPE_ACT, TOKEN_TYPE_JWT, TOKEN_TYPE_ACCESS] as const;

/** Token exchange request (RFC 8693 Section 2.1). */
export const tokenExchangeRequestSchema = z.object({
  grantType: z.literal(GRANT_TYPE_TOKEN_EXCHANGE),
  subjectToken: z.string().min(1, 'subject_token cannot be empty'),
  subjectTokenType: z.enum(VALID_SUBJECT_TYPES),
  requestedTokenType: z.enum(VALID_REQUESTED_TYPES).optional(),
  scope: z.string().optional(),
  audience: z.string().optional(),
  resource: z.string().optional(),
  actorToken: z.string().optional(),
  actorTokenType: z.string().optional(),
});

export type TokenExchangeRequest = z.infer<typeof tokenExchangeRequestSchema>;

/** Token exchange response (RFC 8693 Section 2.2). */
export interface TokenExchangeResponse {
  readonly accessToken: string;
  readonly issuedTokenType: string;
  readonly tokenType: 'Bearer';
  readonly expiresIn: number;
  readonly scope?: string;
}

/** RFC 8693 error response. */
export interface TokenExchangeError {
  readonly error: string;
  readonly errorDescription?: string;
}

/** Create a token exchange request for JWT -> ACT exchange. */
export function createJwtToActRequest(
  subjectToken: string,
  scopes?: readonly string[],
): TokenExchangeRequest {
  return {
    grantType: GRANT_TYPE_TOKEN_EXCHANGE,
    subjectToken,
    subjectTokenType: TOKEN_TYPE_JWT,
    requestedTokenType: TOKEN_TYPE_ACT,
    scope: scopes?.length ? scopes.join(' ') : undefined,
  };
}

/** Validate a token exchange request. */
export function validateExchangeRequest(request: TokenExchangeRequest): void {
  const result = tokenExchangeRequestSchema.safeParse(request);
  if (!result.success) {
    throw OidcBridgeError.exchange(
      `Invalid token exchange request: ${result.error.message}`,
    );
  }
}

/** Parse scopes from a space-delimited string. */
export function parseScopes(scope: string | undefined): string[] {
  if (!scope) return [];
  return scope.split(/\s+/).filter(Boolean);
}

/** Build a successful token exchange response. */
export function successResponse(
  accessToken: string,
  issuedTokenType: string,
  expiresIn: number,
  scope?: string,
): TokenExchangeResponse {
  return {
    accessToken,
    issuedTokenType,
    tokenType: 'Bearer',
    expiresIn,
    scope,
  };
}

/** Create standard OAuth2 error responses. */
export const exchangeErrors = {
  invalidRequest: (desc: string): TokenExchangeError => ({
    error: 'invalid_request',
    errorDescription: desc,
  }),
  invalidGrant: (desc: string): TokenExchangeError => ({
    error: 'invalid_grant',
    errorDescription: desc,
  }),
  unsupportedTokenType: (desc: string): TokenExchangeError => ({
    error: 'unsupported_token_type',
    errorDescription: desc,
  }),
  invalidTarget: (desc: string): TokenExchangeError => ({
    error: 'invalid_target',
    errorDescription: desc,
  }),
} as const;
