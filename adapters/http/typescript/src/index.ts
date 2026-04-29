/**
 * @openagent/http — HTTP adapter for the OpenAgent Auth Protocol (OAAP).
 *
 * Maps the OAAP 4-step mutual authentication handshake to HTTP, providing
 * middleware, client, discovery, and session management.
 */

// Headers
export {
  OAS_AUTH_SCHEME,
  HEADER_OPENAGENT_DID,
  HEADER_OPENAGENT_SESSION,
  CONTENT_TYPE_JSON,
  extractOasToken,
  buildOasHeader,
} from './headers.js';

// Transport
export {
  HttpTransport,
  TransportError,
  type PresentMessage,
  type ChallengeMessage,
  type ProveMessage,
  type EstablishedMessage,
  type HttpTransportConfig,
  challengeMessageSchema,
  establishedMessageSchema,
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
  PROTOCOL_VERSION,
  DEFAULT_SESSION_TTL_SECS,
  DEFAULT_CHALLENGE_EXPIRY_SECS,
  type ServerConfig,
  type SessionState,
  type StoredSession,
  type SessionStore,
  type VerifySignatureFn,
  type AuthResult,
  InMemorySessionStore,
  OaapServerError,
  createServerConfig,
  handleDiscovery,
  handlePresent,
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
export const VERSION = '0.1.0';
