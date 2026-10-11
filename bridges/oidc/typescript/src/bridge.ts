/**
 * Main OidcBridge -- the entrypoint for all three flows.
 *
 * - Flow 1: Human JWT -> Agent DID (derive agent under human lineage).
 * - Flow 2: Agent ACT -> Bearer JWT (wrap for OAuth2-only services).
 * - Flow 3: RFC 8693 Token Exchange.
 */

import type * as jose from 'jose';
import {
  type OidcConfig,
  type SingleProviderInput,
  findProvider,
  oidcConfigSchema,
  resolveFetch,
  singleProviderConfig,
} from './config.js';
import { DiscoveryClient } from './discovery.js';
import { OidcBridgeError } from './errors.js';
import {
  type TokenExchangeRequest,
  type TokenExchangeResponse,
  TOKEN_TYPE_ACT,
  createJwtToActRequest,
  parseScopes,
  successResponse,
  validateExchangeRequest,
} from './exchange.js';
import { JwksClient } from './jwks.js';
import {
  type ActJwtClaims,
  type ValidatedClaims,
  buildActClaims,
  decodeJwtHeader,
  extractUnverifiedIssuer,
  signActJwt,
  validateJwt,
} from './jwt.js';
import {
  type DerivedAgent,
  validateDerivedAgent,
  mapScopes,
} from './mapping.js';

/**
 * The OIDC bridge -- maps between human OIDC tokens and OAS agent identities.
 *
 * @example
 * ```ts
 * import { OidcBridge } from '@openagentid/oidc';
 *
 * const bridge = new OidcBridge({
 *   issuer: 'https://dev-123.okta.com/oauth2/default',
 *   audience: 'my-app',
 * });
 *
 * // Flow 1: Human JWT -> Agent DID
 * const agent = await bridge.deriveAgentFromJwt(jwtString, 'my-bot');
 *
 * // Flow 2: Agent ACT -> JWT
 * const jwt = await bridge.actToJwt(actClaims, signingKey, 'EdDSA');
 *
 * // Flow 3: Token exchange
 * const response = await bridge.exchangeToken(humanJwt, ['openai:chat:completions']);
 * ```
 */
export interface BridgeIdentityHooks {
  /** Derive an owner-authorized identity using real OAS key custody and signed lineage. */
  deriveAgent?: (namespace: string, claims: ValidatedClaims, agentName: string) => DerivedAgent | Promise<DerivedAgent>;
  /** Authorize requested scopes and mint a genuine signed capability through the broker. */
  mintCapability?: (input: {
    agent: DerivedAgent; subject: ValidatedClaims; scopes: readonly string[]; request: TokenExchangeRequest;
  }) => Promise<{ actB64: string; scopes: readonly string[]; expiresIn: number }>;
}

export class OidcBridge {
  private readonly config: OidcConfig;
  private readonly discovery: DiscoveryClient;
  private readonly jwks: JwksClient;

  /**
   * Create a new OIDC bridge.
   *
   * Accepts either a full OidcConfig or a single-provider shorthand input.
   *
   * @throws {OidcBridgeError} If the configuration is invalid.
   */
  constructor(input: OidcConfig | SingleProviderInput, private readonly hooks: BridgeIdentityHooks = {}) {
    if ('providers' in input) {
      const parsed = oidcConfigSchema.safeParse(input);
      if (!parsed.success) {
        throw OidcBridgeError.config(
          `Invalid OIDC config: ${parsed.error.message}`,
        );
      }
      this.config = parsed.data;
    } else {
      this.config = singleProviderConfig(input);
    }

    const fetchImpl = resolveFetch(this.config);
    this.discovery = new DiscoveryClient(
      fetchImpl,
      this.config.httpTimeoutMs,
    );
    this.jwks = new JwksClient(fetchImpl, this.config.httpTimeoutMs);
  }

  /** Access the resolved configuration. */
  getConfig(): Readonly<OidcConfig> {
    return this.config;
  }

  // -- Flow 1: Human JWT -> Agent DID --

  /**
   * Derive an agent DID from a human's OIDC JWT.
   *
   * 1. Decodes the JWT header to find the algorithm and key ID.
   * 2. Identifies the OIDC provider from the `iss` claim.
   * 3. Fetches the provider's JWKS (cached, with rotation-aware refresh).
   * 4. Validates the JWT (signature, issuer, audience, expiry).
   * 5. Maps the JWT subject to an HMR DID.
   * 6. Derives a child agent DID under that HMR.
   */
  async deriveAgentFromJwt(
    token: string,
    agentName: string,
  ): Promise<DerivedAgent> {
    const claims = await this.validateJwt(token);
    return this.deriveIdentity(claims, agentName);
  }

  // -- Flow 2: Agent ACT -> JWT --

  /**
   * Wrap an Arsenal ACT into a standard JWT for OAuth2-only services.
   */
  async actToJwt(
    claims: ActJwtClaims,
    signingKey: jose.KeyLike | Uint8Array,
    algorithm: string,
    kid?: string,
  ): Promise<string> {
    return signActJwt(claims, signingKey, algorithm, kid);
  }

  /**
   * Convenience: build ACT claims and sign in one step.
   */
  async wrapActAsJwt(opts: {
    agentDid: string;
    bridgeIssuer: string;
    audience?: string;
    scopes: readonly string[];
    lineageDepth: number;
    parentHmr: string;
    actB64: string;
    signingKey: jose.KeyLike | Uint8Array;
    algorithm: string;
    kid?: string;
  }): Promise<string> {
    const claims = buildActClaims({
      agentDid: opts.agentDid,
      bridgeIssuer: opts.bridgeIssuer,
      audience: opts.audience,
      scopes: opts.scopes,
      lineageDepth: opts.lineageDepth,
      parentHmr: opts.parentHmr,
      actB64: opts.actB64,
      ttlSeconds: this.config.jwtTtlSeconds,
    });
    return signActJwt(claims, opts.signingKey, opts.algorithm, opts.kid);
  }

  // -- Flow 3: Token Exchange (RFC 8693) --

  /**
   * Execute an RFC 8693 token exchange.
   *
   * Validates the subject token (human JWT), derives an agent, and returns
   * an ACT-wrapped JWT as the exchanged token.
   */
  async exchangeToken(
    humanJwt: string,
    requestedScopes: readonly string[],
    signingKey?: jose.KeyLike | Uint8Array,
    algorithm?: string,
    bridgeIssuer?: string,
  ): Promise<TokenExchangeResponse> {
    const request = createJwtToActRequest(humanJwt, requestedScopes);
    return this.executeExchange(
      request,
      signingKey,
      algorithm ?? 'EdDSA',
      bridgeIssuer ?? 'https://bridge.openagent.id',
    );
  }

  /**
   * Execute a full token exchange from a pre-built request.
   */
  async executeExchange(
    request: TokenExchangeRequest,
    signingKey: jose.KeyLike | Uint8Array | undefined,
    algorithm: string,
    bridgeIssuer: string,
  ): Promise<TokenExchangeResponse> {
    validateExchangeRequest(request);

    const claims = await this.validateJwt(request.subjectToken);
    const agent = await this.deriveIdentity(claims, 'exchange-agent');

    const issuer = extractUnverifiedIssuer(request.subjectToken);
    const provider = findProvider(this.config, issuer);
    if (!provider) {
      throw OidcBridgeError.unknownIssuer(issuer);
    }

    const requestedScopes = parseScopes(request.scope);
    const arsenalScopes = mapScopes(
      requestedScopes.length > 0 ? requestedScopes : claims.scopes, provider.scopeMapping,
    );

    if (!this.hooks.mintCapability) {
      throw OidcBridgeError.exchange('Configure a real authorized capability broker callback');
    }
    const minted = await this.hooks.mintCapability({ agent, subject: claims, scopes: arsenalScopes, request });
    if (!minted.actB64 || !Number.isSafeInteger(minted.expiresIn) || minted.expiresIn < 1
      || minted.expiresIn > this.config.jwtTtlSeconds
      || minted.scopes.some((scope) => !arsenalScopes.includes(scope))) {
      throw OidcBridgeError.exchange('Capability broker returned invalid expiry or unauthorized scopes');
    }
    if ((request.requestedTokenType ?? TOKEN_TYPE_ACT) === TOKEN_TYPE_ACT) {
      return successResponse(minted.actB64, TOKEN_TYPE_ACT, minted.expiresIn, minted.scopes.join(' '));
    }
    if (!signingKey || !request.audience) {
      throw OidcBridgeError.exchange('JWT exchange requires an explicit signing key and audience');
    }
    const actClaims = buildActClaims({
      agentDid: agent.agentDid, bridgeIssuer, audience: request.audience,
      scopes: minted.scopes, lineageDepth: agent.lineageDepth, parentHmr: agent.parentHmrDid,
      actB64: minted.actB64, ttlSeconds: minted.expiresIn,
    });
    const jwt = await signActJwt(actClaims, signingKey, algorithm);
    return successResponse(jwt, 'urn:ietf:params:oauth:token-type:jwt', minted.expiresIn, minted.scopes.join(' '));
  }

  private async deriveIdentity(claims: ValidatedClaims, name: string): Promise<DerivedAgent> {
    if (!this.hooks.deriveAgent) {
      throw OidcBridgeError.mapping('Configure an identity derivation callback backed by real key custody');
    }
    return validateDerivedAgent(await this.hooks.deriveAgent(this.config.namespace, claims, name));
  }

  // -- Validation helpers (public) --

  /**
   * Validate a JWT and return its claims without deriving an agent.
   */
  async validateJwt(token: string): Promise<ValidatedClaims> {
    const header = decodeJwtHeader(token);
    const issuer = extractUnverifiedIssuer(token);

    const provider = findProvider(this.config, issuer);
    if (!provider) {
      throw OidcBridgeError.unknownIssuer(issuer);
    }

    const jwksUri = await this.resolveJwksUri(provider);
    const jwks = await this.jwks.fetchJwks(jwksUri);

    let jwk: jose.JWK;
    try {
      jwk = JwksClient.selectKey(jwks, header.kid, header.alg);
    } catch {
      // Key not found -- try refreshing (IdP may have rotated keys).
      const refreshed = await this.jwks.refresh(jwksUri);
      jwk = JwksClient.selectKey(refreshed, header.kid, header.alg);
    }

    return validateJwt(token, jwk, provider);
  }

  /** Force-refresh the JWKS cache for all providers. */
  async refreshAllJwks(): Promise<void> {
    for (const provider of this.config.providers) {
      try {
        const uri = await this.resolveJwksUri(provider);
        await this.jwks.refresh(uri);
      } catch {
        // Best effort -- log and continue.
      }
    }
  }

  // -- Internal --

  private async resolveJwksUri(
    provider: { issuer: string; jwksUrl?: string },
  ): Promise<string> {
    if (provider.jwksUrl) {
      return provider.jwksUrl;
    }
    const doc = await this.discovery.discover(provider.issuer);
    return doc.jwks_uri;
  }
}
