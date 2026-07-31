/**
 * HTTP header constants and parsing utilities for the Core Protocol binding.
 */

/** The canonical authorization scheme for OpenAgent-authenticated requests. */
export const OPENAGENT_AUTH_SCHEME = 'OpenAgent';

/** Header carrying the authenticated agent's DID. */
export const HEADER_OPENAGENT_DID = 'x-openagent-did';

/** Header carrying the session token (alternative to Authorization). */
export const HEADER_OPENAGENT_SESSION = 'x-openagent-session';

/** Content-Type for all Core Protocol JSON payloads. */
export const CONTENT_TYPE_JSON = 'application/json';

/**
 * Extract the session token from an `Authorization: OpenAgent <token>`
 * header. Returns `undefined` if the header is missing, malformed, or uses a
 * different scheme.
 */
export function extractOpenAgentToken(authorization: string): string | undefined {
  const trimmed = authorization.trim();
  const [scheme, ...rest] = trimmed.split(' ');
  if (!scheme || scheme.toLowerCase() !== OPENAGENT_AUTH_SCHEME.toLowerCase()) return undefined;
  const token = rest.join(' ').trim();
  return token.length > 0 ? token : undefined;
}

/** Build an `Authorization: OpenAgent <token>` header value. */
export function buildOpenAgentHeader(token: string): string {
  return `${OPENAGENT_AUTH_SCHEME} ${token}`;
}
