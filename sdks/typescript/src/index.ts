/**
 * @openagentid/sdk — Clerk for autonomous agents.
 *
 * Three-line happy path:
 *
 * ```ts
 * import { OpenAgent } from '@openagentid/sdk';
 *
 * const agent = await OpenAgent.createAgent({
 *   parent: 'did:oas:l1fe:hmr:alice',
 *   name: 'my-bot',
 *   scopes: ['openai:chat:completions', 'github:repo:read'],
 * });
 *
 * const creds = await agent.credentialsFor('openai');
 * const res   = await creds.fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body });
 * ```
 *
 * See the module re-exports below for every escape hatch and for direct
 * access to the underlying OAS / Arsenal / AEGIS facades.
 */

// Top-level façade
export { OpenAgent, OpenAgentRuntime, type OpenAgentInstance } from './agent.js';

// Config
export {
  type OpenAgentConfig,
  type OpenAgentClients,
  type ResolvedOpenAgentConfig,
  type CreateAgentInput,
  type Logger,
  resolveConfig,
  silentLogger,
  createAgentInputSchema,
  didSchema,
  scopeSchema,
  providerSchema,
  DEFAULT_NAMESPACE,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DID_REGEX,
} from './config.js';

// Identity (OAS)
export {
  type Did,
  type IdentityDocument,
  type IdentityProvider,
  type SignedAssertion,
  parseIdentityDocument,
  toIdentityProvider,
  identityDocumentSchema,
} from './identity.js';

// Credentials (Arsenal)
export {
  type ArsenalClient,
  type CredentialHandle,
  type IssuedCredential,
  createCredentialHandle,
} from './credentials.js';

// Verification (AEGIS)
export {
  type AuthContext,
  type LineageAuthorityContext,
  type PrivilegedAuthorityVerifier,
  type VerificationClient,
  type VerifyRequestOptions,
  PrivilegedAuthorityVerificationClient,
  extractBearerToken,
  assertScopes,
  assertAncestor,
  toVerificationClient,
} from './verification.js';

// Skills
export {
  type SkillId,
  type SkillsPolicy,
  InMemorySkillsPolicy,
  denyAllSkills,
  allowAllSkills,
} from './skills.js';

// ACT verification (verify-first)
export {
  act,
  ActVerifierBuilder,
  setActCryptoBinding,
  type ActClaims,
  type ActVerifyOptions,
} from './act.js';

// Verification middleware
export {
  withAct,
  requireActExpress,
  type RequireActConfig,
} from './middleware.js';

// Key custody
export {
  keys,
  setKeyCryptoBinding,
  type AgentKeys,
  type KeyCryptoBinding,
} from './keys.js';

// Errors
export {
  OpenAgentError,
  ConfigError,
  InputValidationError,
  IdentityError,
  CredentialError,
  VerificationError,
  SkillDeniedError,
  ErrorCode,
  type ErrorCodeValue,
  type ErrorDetails,
  wrapError,
  getErrorMessage,
} from './errors.js';

/** SDK version — kept in sync with `package.json`. */
export const VERSION = '0.1.0';
