/**
 * @openagentid/http — HTTP binding for the OpenAgent Core Protocol identity
 * flow.
 *
 * Carries the Section 15 identity flow (challenge → proof → verified
 * session) over HTTP per the specification's Section 16 HTTP binding:
 * middleware, client, discovery, and session management.
 */

// Headers
export {
  OPENAGENT_AUTH_SCHEME,
  HEADER_OPENAGENT_DID,
  HEADER_OPENAGENT_SESSION,
  CONTENT_TYPE_JSON,
  extractOpenAgentToken,
  buildOpenAgentHeader,
} from './headers.js';

// Transport
export {
  HttpTransport,
  TransportError,
  CHALLENGE_TYPE,
  canonicalChallengeBytes,
  identityChallengeSchema,
  identityVerifiedSchema,
  type IdentityChallenge,
  type IdentityProof,
  type IdentityVerified,
  type KeyType,
  type TrustTier,
  type HttpTransportConfig,
} from './transport.js';

// Discovery
export {
  type ConformanceLevel,
  type DiscoveryDocument,
  discoveryDocumentSchema,
  WELL_KNOWN_PATH,
  AUTH_ENDPOINT_PATH,
  PROVE_ENDPOINT_PATH,
  fetchDiscovery,
  resolveAuthEndpoint,
  resolveProveEndpoint,
} from './discovery.js';

// Server
export {
  DEFAULT_SESSION_TTL_SECS,
  DEFAULT_CHALLENGE_TTL_SECS,
  type ServerConfig,
  type SessionState,
  type StoredSession,
  type SessionStore,
  type VerifySignatureFn,
  type AuthResult,
  InMemorySessionStore,
  CoreAuthError,
  createServerConfig,
  handleDiscovery,
  handleChallenge,
  handleProve,
  authenticateRequest,
} from './server.js';

// Middleware
export {
  type MiddlewareOptions,
  createOpenAgentHandler,
  createOpenAgentMiddleware,
} from './middleware.js';

// Client
export {
  type ClientConfig,
  type SignFn,
  HttpAuthClient,
} from './client.js';

// Session
export { AuthenticatedSession } from './session.js';

/** SDK version — kept in sync with `package.json`. */
export const VERSION = '0.1.1';
