/**
 * HTTP header constants and parsing utilities for OAAP.
 */

/** Authorization scheme for OAAP-authenticated requests. */
export const OAS_AUTH_SCHEME = 'OAS';

/** Header carrying the authenticated agent's DID. */
export const HEADER_OPENAGENT_DID = 'x-openagent-did';

/** Header carrying the session identifier. */
export const HEADER_OPENAGENT_SESSION = 'x-openagent-session';

/** Content-Type for all OAAP JSON payloads. */
export const CONTENT_TYPE_JSON = 'application/json';

/**
 * Extract the session token from an `Authorization: OAS <token>` header.
 * Returns `undefined` if the header is missing, malformed, or uses a different scheme.
 */
export function extractOasToken(authorization: string): string | undefined {
  const trimmed = authorization.trim();
  if (trimmed.length < 5) return undefined;
  const scheme = trimmed.slice(0, 4);
  if (scheme.toLowerCase() !== 'oas ') return undefined;
  const token = trimmed.slice(4).trim();
  return token.length > 0 ? token : undefined;
}

/** Build an `Authorization: OAS <token>` header value. */
export function buildOasHeader(token: string): string {
  return `${OAS_AUTH_SCHEME} ${token}`;
}
