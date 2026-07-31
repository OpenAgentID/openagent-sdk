/**
 * @openagentid/oidc -- OIDC/OAuth2 bridge for the OpenAgent SDK.
 *
 * Maps between human OIDC tokens (Okta, Auth0, Keycloak, Azure AD, Google)
 * and OAS agent DIDs + Arsenal capability tokens.
 *
 * Three flows:
 * - Flow 1: Human JWT -> Agent DID (derive agent under human lineage)
 * - Flow 2: Agent ACT -> Bearer JWT (wrap for OAuth2-only services)
 * - Flow 3: RFC 8693 Token Exchange
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
 * // Flow 1
 * const agent = await bridge.deriveAgentFromJwt(jwtString, 'my-bot');
 *
 * // Flow 2
 * const jwt = await bridge.actToJwt(actClaims, signingKey, 'EdDSA');
 *
 * // Flow 3
 * const response = await bridge.exchangeToken(humanJwt, ['openai:chat:completions']);
 * ```
 */

// Bridge
export { OidcBridge } from './bridge.js';

// Config
export {
  type ProviderConfig,
  type OidcConfig,
  type SingleProviderInput,
  providerConfigSchema,
  oidcConfigSchema,
  singleProviderConfig,
  findProvider,
  resolveFetch,
} from './config.js';

// Discovery
export {
  type DiscoveryDocument,
  DiscoveryClient,
  discoveryDocumentSchema,
  wellKnownUrl,
} from './discovery.js';

// Errors
export { OidcBridgeError, type OidcErrorCode } from './errors.js';

// Exchange (RFC 8693)
export {
  type TokenExchangeRequest,
  type TokenExchangeResponse,
  type TokenExchangeError,
  tokenExchangeRequestSchema,
  GRANT_TYPE_TOKEN_EXCHANGE,
  TOKEN_TYPE_JWT,
  TOKEN_TYPE_ACT,
  TOKEN_TYPE_ACCESS,
  createJwtToActRequest,
  validateExchangeRequest,
  parseScopes,
  successResponse,
  exchangeErrors,
} from './exchange.js';

// JWKS
export { JwksClient } from './jwks.js';

// JWT
export {
  type ValidatedClaims,
  type ActJwtClaims,
  decodeJwtHeader,
  extractUnverifiedIssuer,
  validateJwt,
  buildActClaims,
  signActJwt,
} from './jwt.js';

// Mapping
export {
  type DerivedAgent,
  deriveAgentFromClaims,
  hmrIdentifierFromClaims,
  mapScopes,
} from './mapping.js';

/** SDK version. */
export const VERSION = '0.1.0';
