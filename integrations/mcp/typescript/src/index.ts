/**
 * @openagent/mcp — OpenAgent middleware for the Model Context Protocol.
 *
 * Add OAS identity verification, Arsenal capability tokens, and AEGIS
 * authorization to any MCP server in three lines.
 *
 * @example Server
 * ```ts
 * import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
 * import { withOpenAgent } from '@openagent/mcp';
 *
 * const server = new McpServer({ name: 'my-tools', version: '0.1.0' });
 * const authed = withOpenAgent(server, { agent });
 * ```
 *
 * @example Client
 * ```ts
 * import { Client } from '@modelcontextprotocol/sdk/client/index.js';
 * import { withOpenAgentClient } from '@openagent/mcp';
 *
 * const client = withOpenAgentClient(new Client({ name: 'me', version: '0.1.0' }), {
 *   agent,
 * });
 * ```
 */

export {
  withOpenAgent,
  ANONYMOUS_IDENTITY,
} from './server.js';
export type { McpServerLike } from './server.js';

export {
  withOpenAgentClient,
  buildIdentityMeta,
} from './client.js';
export type { McpClientLike, OpenAgentClientConfig } from './client.js';

export {
  OpenAgentMcpError,
  MissingIdentityError,
  IdentityVerificationError,
  AuthorizationDeniedError,
  SkillsPolicyDeniedError,
  McpErrorCode,
} from './errors.js';
export type { McpErrorCodeValue } from './errors.js';

export {
  createSkillsPolicy,
  combineSkillsPolicies,
  InMemorySkillsPolicyStore,
  DEFAULT_SKILL_TOOL_NAMES,
} from './skills.js';
export type {
  SkillsRule,
  SkillsPolicyStore,
  CreateSkillsPolicyOptions,
} from './skills.js';

export type {
  Agent,
  AuditedResultMeta,
  Did,
  ErrorHook,
  IdentityVerifier,
  OpenAgentMcpConfig,
  OpenAgentRequestIdentity,
  PostCallHook,
  PreCallHook,
  ScopeDeriver,
  SkillsPolicyDecision,
  SkillsPolicyHook,
  VerifiedIdentity,
} from './types.js';

export { defaultRequireScopes, defaultScopeFormat } from './types.js';
