/**
 * SCIM 2.0 schema definitions — RFC 7643 core + OpenAgent agent extension.
 *
 * These are the JSON payloads returned by `/Schemas` and `/ResourceTypes`
 * discovery endpoints, and the schema URNs referenced in every SCIM resource.
 */

/** SCIM core User schema URN. */
export const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User' as const;

/** OpenAgent agent extension schema URN. */
export const OPENAGENT_AGENT_SCHEMA = 'urn:openagent:scim:1.0:Agent' as const;

/** SCIM List Response schema URN. */
export const SCIM_LIST_RESPONSE_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse' as const;

/** SCIM Error schema URN. */
export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error' as const;

/** SCIM Patch Operation schema URN. */
export const SCIM_PATCH_OP_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp' as const;

/** SCIM ServiceProviderConfig schema URN. */
export const SCIM_SPC_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig' as const;

/** SCIM Schema schema URN. */
export const SCIM_SCHEMA_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Schema' as const;

/** SCIM ResourceType schema URN. */
export const SCIM_RESOURCE_TYPE_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:ResourceType' as const;

/** Conformance levels for OpenAgent agents. */
export type ConformanceLevel = 'L0' | 'L1' | 'L2';

/** The OpenAgent agent extension attribute group. */
export interface AgentExtension {
  readonly parentDid: string;
  readonly conformanceLevel: ConformanceLevel;
  readonly scopes: readonly string[];
  readonly lineageDepth: number;
  readonly createdVia: string;
  readonly keypairFingerprint: string;
}

/** Full SCIM User resource with agent extension. */
export interface ScimAgentResource {
  readonly schemas: readonly string[];
  readonly id: string;
  readonly externalId?: string;
  readonly userName: string;
  readonly displayName: string;
  readonly active: boolean;
  readonly meta: ScimMeta;
  readonly [OPENAGENT_AGENT_SCHEMA]: AgentExtension;
}

/** SCIM resource metadata. */
export interface ScimMeta {
  readonly resourceType: string;
  readonly created: string;
  readonly lastModified: string;
  readonly location: string;
  readonly version: string;
}

/** SCIM List Response envelope. */
export interface ScimListResponse<T> {
  readonly schemas: readonly string[];
  readonly totalResults: number;
  readonly startIndex: number;
  readonly itemsPerPage: number;
  readonly Resources: readonly T[];
}

/** SCIM Error response. */
export interface ScimErrorResponse {
  readonly schemas: readonly string[];
  readonly status: string;
  readonly scimType?: string;
  readonly detail: string;
}

/** Service Provider Configuration response. */
export function buildServiceProviderConfig(baseUrl: string): Record<string, unknown> {
  return {
    schemas: [SCIM_SPC_SCHEMA],
    documentationUri: 'https://openagent.id/docs/scim',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: true },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'OAuth Bearer Token',
        description: 'Authentication scheme using the OAuth Bearer Token Standard',
        specUri: 'https://www.rfc-editor.org/info/rfc6750',
        primary: true,
      },
    ],
    meta: {
      resourceType: 'ServiceProviderConfig',
      location: `${baseUrl}/ServiceProviderConfig`,
    },
  };
}

/** Schema discovery response for the User + Agent extension. */
export function buildSchemas(): readonly Record<string, unknown>[] {
  return [
    {
      schemas: [SCIM_SCHEMA_SCHEMA],
      id: SCIM_USER_SCHEMA,
      name: 'User',
      description: 'SCIM 2.0 User mapped to OAS Agent identity',
      attributes: [
        { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite', returned: 'default', uniqueness: 'server' },
        { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
        { name: 'active', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
      ],
      meta: { resourceType: 'Schema', location: `/Schemas/${SCIM_USER_SCHEMA}` },
    },
    {
      schemas: [SCIM_SCHEMA_SCHEMA],
      id: OPENAGENT_AGENT_SCHEMA,
      name: 'Agent',
      description: 'OpenAgent agent extension for SCIM User',
      attributes: [
        { name: 'parentDid', type: 'string', multiValued: false, required: true, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
        { name: 'conformanceLevel', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none', canonicalValues: ['L0', 'L1', 'L2'] },
        { name: 'scopes', type: 'string', multiValued: true, required: true, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
        { name: 'lineageDepth', type: 'integer', multiValued: false, required: false, mutability: 'readOnly', returned: 'default', uniqueness: 'none' },
        { name: 'createdVia', type: 'string', multiValued: false, required: false, mutability: 'readOnly', returned: 'default', uniqueness: 'none' },
        { name: 'keypairFingerprint', type: 'string', multiValued: false, required: false, mutability: 'readOnly', returned: 'default', uniqueness: 'none' },
      ],
      meta: { resourceType: 'Schema', location: `/Schemas/${OPENAGENT_AGENT_SCHEMA}` },
    },
  ];
}

/** Resource type discovery for User (Agent). */
export function buildResourceTypes(baseUrl: string): readonly Record<string, unknown>[] {
  return [
    {
      schemas: [SCIM_RESOURCE_TYPE_SCHEMA],
      id: 'User',
      name: 'User',
      description: 'OAS Agent identity provisioned via SCIM',
      endpoint: '/Users',
      schema: SCIM_USER_SCHEMA,
      schemaExtensions: [
        {
          schema: OPENAGENT_AGENT_SCHEMA,
          required: true,
        },
      ],
      meta: {
        resourceType: 'ResourceType',
        location: `${baseUrl}/ResourceTypes/User`,
      },
    },
  ];
}
