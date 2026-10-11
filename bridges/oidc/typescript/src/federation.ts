import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload } from 'jose';
import { sameOwner, type AgentOwner } from './identity-types.js';

export interface LifeIdFederationOptions {
  /** Exact trusted LifeID/AuthKit issuer, never read from an unverified JWT. */
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUri: string;
  readonly algorithms?: readonly ('RS256' | 'EdDSA')[];
  readonly organizationClaim?: string;
  readonly fetch?: typeof globalThis.fetch;
  /** HTTP is permitted only for an explicit loopback test issuer. */
  readonly test?: boolean;
}

/** Normalize known human owner aliases without inventing an agent principal. */
export function ownerFromLifeIdClaims(claims: JWTPayload, organizationClaim = 'organization_id'): AgentOwner {
  if (typeof claims.iss !== 'string' || typeof claims.sub !== 'string' || !claims.sub
    || (claims.kind !== undefined && claims.kind !== 'human')
    || claims.sub.startsWith('did:')) {
    throw new Error('LifeID federation requires a human owner assertion');
  }
  const aliases = [...new Set([organizationClaim, 'organization_id', 'org_id', 'oid'])];
  const organizations = aliases.map((key) => claims[key]).filter((value) => value !== undefined);
  if (organizations.some((value) => typeof value !== 'string' || !value)
    || new Set(organizations).size > 1) {
    throw new Error('LifeID organization claims are invalid or conflicting');
  }
  return {
    issuer: claims.iss,
    subject: claims.sub,
    ...(organizations.length ? { organizationId: organizations[0] as string } : {}),
  };
}

export class LifeIdFederation {
  private readonly fetchImpl: typeof globalThis.fetch;
  private keys?: JSONWebKeySet;
  private fetchedAt = 0;

  constructor(private readonly options: LifeIdFederationOptions) {
    for (const input of [options.issuer, options.jwksUri]) {
      const url = new URL(input);
      if (url.username || url.password || url.hash
        || (url.protocol !== 'https:' && !(options.test && process.env.NODE_ENV === 'test'
          && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
        throw new Error('LifeID issuer and JWKS must use trusted HTTPS URLs');
      }
    }
    if (!options.audience) throw new Error('LifeID audience is required');
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  private async fetchKeys(): Promise<JSONWebKeySet> {
    const response = await this.fetchImpl(this.options.jwksUri, {
      signal: AbortSignal.timeout(10_000), redirect: 'error',
    });
    if (!response.ok) throw new Error('LifeID signing keys are unavailable');
    const text = await response.text();
    if (text.length > 128 * 1024) throw new Error('LifeID JWKS exceeds size limit');
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || !('keys' in value) || !Array.isArray(value.keys)
      || value.keys.some((key) => !key || typeof key !== 'object'
        || ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some(field => Object.hasOwn(key, field)))) {
      throw new Error('LifeID JWKS must contain public asymmetric signing keys');
    }
    this.keys = value as JSONWebKeySet;
    this.fetchedAt = Date.now();
    return this.keys;
  }

  async verifyHumanToken(token: string, expectedOwner: AgentOwner): Promise<AgentOwner> {
    if (!this.keys || Date.now() - this.fetchedAt >= 60_000) await this.fetchKeys();
    const validate = () => jwtVerify(token, createLocalJWKSet(this.keys!), {
      issuer: this.options.issuer,
      audience: this.options.audience,
      algorithms: [...(this.options.algorithms ?? ['RS256', 'EdDSA'])],
      requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat'],
      clockTolerance: 0,
    });
    let verified;
    try {
      verified = await validate();
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error)
        || error.code !== 'ERR_JWKS_NO_MATCHING_KEY') throw error;
      await this.fetchKeys();
      verified = await validate();
    }
    if (typeof verified.payload.iat !== 'number' || verified.payload.iat > Date.now() / 1000 + 30) {
      throw new Error('LifeID assertion was issued in the future');
    }
    if (Array.isArray(verified.payload.aud) && verified.payload.aud.length > 1
      && verified.payload.azp !== this.options.audience) {
      throw new Error('LifeID authorized party does not match the federation client');
    }
    const owner = ownerFromLifeIdClaims(verified.payload, this.options.organizationClaim);
    if (!sameOwner(owner, expectedOwner)) throw new Error('LifeID assertion does not own this agent');
    return owner;
  }
}
