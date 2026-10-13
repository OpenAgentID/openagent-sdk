/**
 * @openagentid/scim — SCIM 2.0 provisioning bridge for OpenAgent.
 *
 * Enterprise agent lifecycle management via RFC 7644. Compatible with
 * Okta, Azure AD, OneLogin, JumpCloud, and any SCIM 2.0 client.
 *
 * Supply a real identity provisioner and authority revocation callbacks.
 * See README.md for the current SDK wiring and migration contract.
 */

// Router
export { createScimRouter, type ScimRouter, type ScimRouterConfig } from './server.js';

// Config
export {
  type ScimBridgeConfig,
  type ResolvedScimConfig,
  type Logger,
  resolveScimConfig,
  silentLogger,
} from './config.js';

// Schemas
export {
  SCIM_USER_SCHEMA,
  OPENAGENT_AGENT_SCHEMA,
  SCIM_LIST_RESPONSE_SCHEMA,
  SCIM_ERROR_SCHEMA,
  SCIM_PATCH_OP_SCHEMA,
  SCIM_SPC_SCHEMA,
  SCIM_SCHEMA_SCHEMA,
  SCIM_RESOURCE_TYPE_SCHEMA,
  type ConformanceLevel,
  type AgentExtension,
  type ScimAgentResource,
  type ScimMeta,
  type ScimListResponse,
  type ScimErrorResponse,
  buildServiceProviderConfig,
  buildSchemas,
  buildResourceTypes,
} from './schemas.js';

// Resources (SCIM <-> Agent mapping)
export {
  type AgentRecord,
  type CreateAgentFromScimInput,
  type ReplaceAgentFromScimInput,
  agentToScimResource,
  parseCreateInput,
  parseReplaceInput,
  createAgentFromScimSchema,
} from './resources.js';

// Filtering
export {
  type ParsedFilter,
  type AttributeFilter,
  type LogicalFilter,
  type FilterOp,
  parseFilter,
  matchesFilter,
  ScimFilterError,
} from './filtering.js';

// Pagination
export {
  type PaginationParams,
  parsePagination,
  paginateResults,
} from './pagination.js';

// PATCH operations
export {
  type PatchOperation,
  type PatchRequest,
  parsePatchRequest,
  applyPatchOperations,
  ScimPatchError,
} from './operations.js';

// Provisioner
export {
  AgentProvisioner,
  createSdkScimProvisioner,
  IdentityNotCreatedError,
  type IdentityProvisioner,
  type ProvisionerConfig,
  type CreateAgentParams,
  type AuditEvent,
  type AuditSink,
  type DidRevoker,
  type DelegationCascadeRevoker,
  type ArsenalSessionInvalidator,
  ProvisionerError,
} from './provisioner.js';

// Store
export {
  type AgentStore,
  type UserNameReservation,
  InMemoryAgentStore,
  StoreError,
  type StoreErrorCode,
} from './store.js';

/** Package version. */
export const VERSION = '0.2.0';
