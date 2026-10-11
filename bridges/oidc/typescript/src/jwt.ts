/**
 * JWT validation, decoding, and signing for the OIDC bridge.
 *
 * Uses `jose` for runtime-agnostic JWT operations.
 */

import { randomBytes } from 'node:crypto';
import * as jose from 'jose';
import type { ProviderConfig } from './config.js';
import { OidcBridgeError } from './errors.js';

/** Claims extracted from a validated human JWT. */
export interface ValidatedClaims {
  /** Issuer (`iss` claim). */
  readonly issuer: string;
  /** Subject (`sub` claim). */
  readonly subject: string;
  /** Audience (`aud` claim). */
  readonly audience: readonly string[];
  /** Expiration (epoch seconds). */
  readonly exp: number;
  /** Issued-at (epoch seconds). */
  readonly iat: number;
  /** The claim value that maps to the HMR. */
  readonly hmrValue: string;
  /** OIDC scopes extracted from the token. */
  readonly scopes: readonly string[];
  /** All original claims. */
  readonly rawClaims: Readonly<Record<string, unknown>>;
}

/** Claims for an outbound JWT wrapping an Arsenal ACT (Flow 2). */
export interface ActJwtClaims {
  /** Subject: the agent's DID. */
  readonly sub: string;
  /** Issuer: the bridge's own issuer identifier. */
  readonly iss: string;
  /** Audience. */
  readonly aud?: string;
  /** Expiration (epoch seconds). */
  readonly exp: number;
  /** Issued-at (epoch seconds). */
  readonly iat: number;
  /** JWT ID. */
  readonly jti: string;
  /** Arsenal scope strings. */
  readonly scope: string;
  /** Lineage depth (hops from HMR root). */
  readonly lineage_depth: number;
  /** Parent HMR DID. */
  readonly parent_hmr: string;
  /** Serialized ACT (base64url). */
  readonly act: string;
}

/** Decode the JWT header without verification (to get kid/alg). */
export function decodeJwtHeader(token: string): { kid?: string; alg?: string } {
  const header = jose.decodeProtectedHeader(token);
  return { kid: header.kid, alg: header.alg };
}

/** Extract the unverified `iss` claim from a JWT. */
export function extractUnverifiedIssuer(token: string): string {
  const payload = jose.decodeJwt(token);
  if (!payload.iss) {
    throw OidcBridgeError.jwtValidation("JWT has no 'iss' claim");
  }
  return payload.iss;
}

/**
 * Validate and decode a JWT using the given JWK.
 *
 * Performs standard OIDC validation: issuer, audience, expiry, signature.
 */
export async function validateJwt(
  token: string,
  jwk: jose.JWK,
  provider: ProviderConfig,
): Promise<ValidatedClaims> {
  if (!provider.audience) throw OidcBridgeError.config('A trusted human JWT audience is required');
  const key = await jose.importJWK(jwk);

  const { payload } = await jose.jwtVerify(token, key, {
    issuer: provider.issuer,
    audience: provider.audience,
    algorithms: ['RS256', 'EdDSA'],
    requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat'],
    clockTolerance: 0,
  }).catch((err) => {
    throw OidcBridgeError.jwtValidation(
      `JWT validation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  const subject = typeof payload.sub === 'string' ? payload.sub : '';
  const issuer = typeof payload.iss === 'string' ? payload.iss : '';
  if (!subject || subject.startsWith('did:') || (payload.kind !== undefined && payload.kind !== 'human')) {
    throw OidcBridgeError.jwtValidation('A validated human owner assertion is required');
  }

  // Extract HMR value from configured claim.
  let hmrValue: string;
  if (provider.hmrClaim === 'sub') {
    hmrValue = subject;
  } else {
    const claimVal = payload[provider.hmrClaim];
    hmrValue = typeof claimVal === 'string' ? claimVal : subject;
  }

  // Extract scopes from `scope` claim (space-delimited per OAuth 2.0).
  const scopeStr = typeof payload['scope'] === 'string' ? payload['scope'] : '';
  const scopes = scopeStr ? scopeStr.split(/\s+/) : [];

  // Normalize audience to array.
  const audience: string[] = Array.isArray(payload.aud)
    ? payload.aud.filter((a): a is string => typeof a === 'string')
    : typeof payload.aud === 'string'
      ? [payload.aud]
      : [];

  return {
    issuer,
    subject,
    audience,
    exp: typeof payload.exp === 'number' ? payload.exp : 0,
    iat: typeof payload.iat === 'number' ? payload.iat : 0,
    hmrValue,
    scopes,
    rawClaims: { ...payload },
  };
}

/** Build ACT JWT claims. */
export function buildActClaims(opts: {
  agentDid: string;
  bridgeIssuer: string;
  audience?: string;
  scopes: readonly string[];
  lineageDepth: number;
  parentHmr: string;
  actB64: string;
  ttlSeconds: number;
}): ActJwtClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: opts.agentDid,
    iss: opts.bridgeIssuer,
    aud: opts.audience,
    exp: now + opts.ttlSeconds,
    iat: now,
    jti: generateJti(),
    scope: opts.scopes.join(' '),
    lineage_depth: opts.lineageDepth,
    parent_hmr: opts.parentHmr,
    act: opts.actB64,
  };
}

/** Sign a JWT wrapping an Arsenal ACT for OAuth2-only services. */
export async function signActJwt(
  claims: ActJwtClaims,
  signingKey: jose.KeyLike | Uint8Array,
  algorithm: string,
  kid?: string,
): Promise<string> {
  try {
    let builder = new jose.SignJWT({ ...claims })
      .setProtectedHeader({
        alg: algorithm,
        typ: 'JWT',
        ...(kid ? { kid } : {}),
      });

    // jose.SignJWT expects the exp/iat to be set via payload or setters.
    // Since we already have them in claims, the spread above handles it.
    return await builder.sign(signingKey);
  } catch (err) {
    throw OidcBridgeError.signing(
      `Failed to sign ACT JWT: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Generate a unique JWT ID. */
function generateJti(): string {
  return randomBytes(16).toString('base64url');
}
