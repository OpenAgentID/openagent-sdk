/**
 * Open agent identities, verified requests and living avatars.
 *
 * Configure real identity/credential/verification authorities before using
 * OpenAgentRuntime. Published component packages connect through the explicit
 * `@openagentid/sdk/integrations` entry; importing a package alone never creates
 * a trusted identity.
 * For a complete no-account local application, run:
 * `npx create-openagent my-agent-app --yes`.
 *
 * See INTEGRATION_NOTES.md and examples/typescript/04–06 for executable
 * published-component workflows and their trust/storage contracts.
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
  LEGACY_DID_REGEX,
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
  characterAppearanceSchema,
  avatarExpressionSchema,
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
export { VERSION } from './version.js';

// OpenAgentID 0.2 identity, avatars and verified trust evidence.
export * from './glyph.js';
export * from './identity-verification.js';
export * from './verification-api.js';
export * from './oats.js';
export * from './characters.js';
export * from './character-api.js';
export { isAgentAvatarDid } from './avatar-did.js';

export * from './character-animation.js';
