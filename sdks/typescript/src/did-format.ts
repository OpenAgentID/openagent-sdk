/**
 * DID syntax shared by the validators. Plain regular expressions with no schema library, so display-only
 * modules (avatars and the One family's light entry) can classify DIDs without loading zod.
 */

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

/** At most 512 characters of OAS or legacy DID syntax; the same rule as `didSchema`. */
export function isDidSyntax(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 512 && (DID_REGEX.test(value) || LEGACY_DID_REGEX.test(value));
}
