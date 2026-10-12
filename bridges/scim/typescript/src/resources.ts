/**
 * SCIM User <-> OAS Agent mapping.
 *
 * Bidirectional conversion between SCIM 2.0 User resources (with the
 * `urn:openagent:scim:1.0:Agent` extension) and the internal agent
 * record stored by the provisioner.
 */

import { z } from 'zod';
import {
  type ScimAgentResource,
  type ScimMeta,
  type AgentExtension,
  type ConformanceLevel,
  SCIM_USER_SCHEMA,
  OPENAGENT_AGENT_SCHEMA,
} from './schemas.js';

// ── Internal agent record ─────────────────────────────────────────────────

/** The canonical internal representation of a provisioned agent. */
export interface AgentRecord {
  readonly did: string;
  readonly userName: string;
  readonly displayName: string;
  readonly active: boolean;
  readonly parentDid: string;
  readonly conformanceLevel: ConformanceLevel;
  readonly scopes: readonly string[];
  readonly lineageDepth: number;
  readonly createdVia: string;
  readonly keypairFingerprint: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: string;
  readonly externalId?: string;
}

// ── Zod schemas for SCIM input validation ─────────────────────────────────

const DID_REGEX =
  /^did:(?:oas:[a-z0-9][a-z0-9-]{0,63}|l1fe):(hmr|mhr|ao|enr|agent|tool|skill|workflow|model|dataset|service|agent:instance):[A-Za-z0-9._-]+$/;

const agentExtensionInputSchema = z.object({
  parentDid: z.string().regex(DID_REGEX, 'parentDid must be a valid OAS or legacy identifier'),
  conformanceLevel: z.enum(['L0', 'L1', 'L2']).default('L1'),
  scopes: z.array(z.string().min(1)).min(1, 'At least one scope is required'),
  lineageDepth: z.number().int().min(0).optional(),
  createdVia: z.string().optional(),
  keypairFingerprint: z.string().optional(),
});

export const createAgentFromScimSchema = z.object({
  schemas: z.array(z.string()).refine(
    (s) => s.includes(SCIM_USER_SCHEMA) && s.includes(OPENAGENT_AGENT_SCHEMA),
    'schemas must include both core User and Agent extension URNs',
  ),
  externalId: z.string().optional(),
  userName: z.string().min(1).max(128),
  displayName: z.string().min(1).max(256).optional(),
  active: z.boolean().default(true),
  [OPENAGENT_AGENT_SCHEMA]: agentExtensionInputSchema,
});

export type CreateAgentFromScimInput = z.infer<typeof createAgentFromScimSchema>;

export const replaceAgentFromScimSchema = createAgentFromScimSchema;
export type ReplaceAgentFromScimInput = z.infer<typeof replaceAgentFromScimSchema>;

// ── Mapping functions ─────────────────────────────────────────────────────

/** Convert an internal AgentRecord into a SCIM User resource. */
export function agentToScimResource(
  agent: AgentRecord,
  baseUrl: string,
): ScimAgentResource {
  const meta: ScimMeta = {
    resourceType: 'User',
    created: agent.createdAt,
    lastModified: agent.updatedAt,
    location: `${baseUrl}/Users/${encodeURIComponent(agent.did)}`,
    version: `W/"${agent.version}"`,
  };

  const extension: AgentExtension = {
    parentDid: agent.parentDid,
    conformanceLevel: agent.conformanceLevel,
    scopes: agent.scopes,
    lineageDepth: agent.lineageDepth,
    createdVia: agent.createdVia,
    keypairFingerprint: agent.keypairFingerprint,
  };

  return {
    schemas: [SCIM_USER_SCHEMA, OPENAGENT_AGENT_SCHEMA],
    id: agent.did,
    ...(agent.externalId !== undefined ? { externalId: agent.externalId } : {}),
    userName: agent.userName,
    displayName: agent.displayName,
    active: agent.active,
    meta,
    [OPENAGENT_AGENT_SCHEMA]: extension,
  };
}

/** Parse and validate a SCIM create request body into typed input. */
export function parseCreateInput(body: unknown): CreateAgentFromScimInput {
  return createAgentFromScimSchema.parse(body);
}

/** Parse and validate a SCIM replace (PUT) request body into typed input. */
export function parseReplaceInput(body: unknown): ReplaceAgentFromScimInput {
  return replaceAgentFromScimSchema.parse(body);
}
