/**
 * SCIM 2.0 endpoint handlers — framework-agnostic Request/Response API.
 *
 * These handlers operate on WHATWG `Request` and `Response` objects,
 * making them portable across Node (with fetch), Bun, Deno, Cloudflare
 * Workers, and any framework that exposes the standard Web API.
 *
 * Usage with a framework:
 * ```ts
 * import { createScimRouter } from '@openagent/scim';
 *
 * const scim = createScimRouter({ namespace: 'acme', bearerTokens: ['secret'] });
 *
 * // Express: app.all('/scim/v2/*', (req, res) => ...)
 * // Hono:    app.all('/scim/v2/*', (c) => scim.handle(c.req.raw))
 * // Bun:     Bun.serve({ fetch: scim.handle })
 * ```
 */

import { type ResolvedScimConfig, resolveScimConfig, type ScimBridgeConfig } from './config.js';
import { type AgentStore, InMemoryAgentStore, StoreError } from './store.js';
import { AgentProvisioner, type AuditSink, type DidRevoker, type DelegationCascadeRevoker, type ArsenalSessionInvalidator, ProvisionerError } from './provisioner.js';
import { agentToScimResource, parseCreateInput, parseReplaceInput, type CreateAgentFromScimInput, type AgentRecord } from './resources.js';
import { OPENAGENT_AGENT_SCHEMA, SCIM_ERROR_SCHEMA, buildServiceProviderConfig, buildSchemas, buildResourceTypes } from './schemas.js';
import { parseFilter, matchesFilter, ScimFilterError } from './filtering.js';
import { parsePagination, paginateResults } from './pagination.js';
import { parsePatchRequest, applyPatchOperations, ScimPatchError } from './operations.js';

// ── Router configuration ──────────────────────────────────────────────────

export interface ScimRouterConfig extends ScimBridgeConfig {
  /** Custom agent store. Defaults to in-memory. */
  readonly store?: AgentStore;
  /** Audit event sink. */
  readonly auditSink?: AuditSink;
  /** DID revocation hook (production: OAS SDK). */
  readonly revokeDidDocument?: DidRevoker;
  /** Delegation cascade revocation hook (production: AEGIS SDK). */
  readonly cascadeRevokeDelegations?: DelegationCascadeRevoker;
  /** Arsenal session invalidation hook (production: Arsenal SDK). */
  readonly invalidateArsenalSessions?: ArsenalSessionInvalidator;
}

export interface ScimRouter {
  /** Handle a WHATWG Request and return a WHATWG Response. */
  handle(request: Request): Promise<Response>;
}

// ── Factory ───────────────────────────────────────────────────────────────

/** Create a SCIM 2.0 router with the given configuration. */
export function createScimRouter(routerConfig: ScimRouterConfig = {}): ScimRouter {
  const config = resolveScimConfig(routerConfig);
  const store = routerConfig.store ?? new InMemoryAgentStore();

  const provisioner = new AgentProvisioner({
    store,
    namespace: config.namespace,
    logger: config.logger,
    auditSink: routerConfig.auditSink,
    revokeDidDocument: routerConfig.revokeDidDocument,
    cascadeRevokeDelegations: routerConfig.cascadeRevokeDelegations,
    invalidateArsenalSessions: routerConfig.invalidateArsenalSessions,
  });

  return {
    handle: (request: Request) => routeRequest(request, config, provisioner),
  };
}

// ── Request routing ───────────────────────────────────────────────────────

async function routeRequest(
  request: Request,
  config: ResolvedScimConfig,
  provisioner: AgentProvisioner,
): Promise<Response> {
  // Authenticate bearer token
  const authError = authenticateRequest(request, config);
  if (authError) return authError;

  const url = new URL(request.url, config.baseUrl);
  const method = request.method.toUpperCase();

  // Extract path relative to /scim/v2 (handle both with and without prefix)
  const pathMatch = url.pathname.match(/\/scim\/v2(\/.*)?$/);
  const subPath = pathMatch ? (pathMatch[1] ?? '/') : url.pathname;

  try {
    // Discovery endpoints
    if (subPath === '/ServiceProviderConfig' && method === 'GET') {
      return jsonResponse(200, buildServiceProviderConfig(config.baseUrl));
    }
    if (subPath === '/Schemas' && method === 'GET') {
      return jsonResponse(200, { schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'], totalResults: 2, Resources: buildSchemas() });
    }
    if (subPath === '/ResourceTypes' && method === 'GET') {
      return jsonResponse(200, { schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'], totalResults: 1, Resources: buildResourceTypes(config.baseUrl) });
    }

    // Users collection
    if (subPath === '/Users' && method === 'GET') {
      return await handleListUsers(url.searchParams, config, provisioner);
    }
    if (subPath === '/Users' && method === 'POST') {
      return await handleCreateUser(request, config, provisioner);
    }

    // Users by ID
    const userIdMatch = subPath.match(/^\/Users\/(.+)$/);
    if (userIdMatch) {
      const userId = decodeURIComponent(userIdMatch[1]);
      switch (method) {
        case 'GET': return await handleGetUser(userId, config, provisioner);
        case 'PUT': return await handleReplaceUser(userId, request, config, provisioner);
        case 'PATCH': return await handlePatchUser(userId, request, config, provisioner);
        case 'DELETE': return await handleDeleteUser(userId, provisioner);
        default: return scimError(405, 'invalidSyntax', `Method ${method} not allowed`);
      }
    }

    return scimError(404, 'invalidPath', `Unknown SCIM endpoint: ${subPath}`);
  } catch (err) {
    config.logger.error('Unhandled SCIM error', { error: String(err), path: subPath, method });
    return scimError(500, 'invalidValue', 'Internal server error');
  }
}

// ── Authentication ────────────────────────────────────────────────────────

function authenticateRequest(request: Request, config: ResolvedScimConfig): Response | null {
  if (config.bearerTokens.length === 0) return null; // auth disabled

  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return scimError(401, 'invalidValue', 'Missing Authorization header');
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return scimError(401, 'invalidValue', 'Authorization header must use Bearer scheme');
  }

  const token = match[1];
  if (!config.bearerTokens.includes(token)) {
    return scimError(401, 'invalidValue', 'Invalid bearer token');
  }

  return null;
}

// ── GET /Users ────────────────────────────────────────────────────────────

async function handleListUsers(
  searchParams: URLSearchParams,
  config: ResolvedScimConfig,
  provisioner: AgentProvisioner,
): Promise<Response> {
  const filterStr = searchParams.get('filter');
  let parsedFilter;
  try {
    parsedFilter = parseFilter(filterStr);
  } catch (err) {
    if (err instanceof ScimFilterError) {
      return scimError(400, 'invalidFilter', err.message);
    }
    throw err;
  }

  const allAgents = await provisioner.listAgents();
  const filtered = parsedFilter
    ? allAgents.filter((a) => matchesFilter(a, parsedFilter))
    : allAgents;

  const pagination = parsePagination(searchParams, config.maxPageSize);
  const scimResources = filtered.map((a) => agentToScimResource(a, config.baseUrl));
  const listResponse = paginateResults(scimResources, pagination);

  return jsonResponse(200, listResponse);
}

// ── GET /Users/:id ────────────────────────────────────────────────────────

async function handleGetUser(
  userId: string,
  config: ResolvedScimConfig,
  provisioner: AgentProvisioner,
): Promise<Response> {
  const agent = await provisioner.findByDid(userId);
  if (!agent) {
    return scimError(404, 'invalidValue', `User "${userId}" not found`);
  }

  return jsonResponse(200, agentToScimResource(agent, config.baseUrl));
}

// ── POST /Users ───────────────────────────────────────────────────────────

async function handleCreateUser(
  request: Request,
  config: ResolvedScimConfig,
  provisioner: AgentProvisioner,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return scimError(400, 'invalidSyntax', 'Request body must be valid JSON');
  }

  let input: CreateAgentFromScimInput;
  try {
    input = parseCreateInput(body);
  } catch (err) {
    return scimError(400, 'invalidValue', `Invalid SCIM User payload: ${extractMessage(err)}`);
  }

  const ext = input[OPENAGENT_AGENT_SCHEMA];

  // Check for duplicate userName
  const existing = await provisioner.findByUserName(input.userName);
  if (existing) {
    return scimError(409, 'uniqueness', `userName "${input.userName}" already exists`);
  }

  try {
    const agent = await provisioner.createAgent({
      userName: input.userName,
      displayName: input.displayName,
      parentDid: ext.parentDid,
      conformanceLevel: ext.conformanceLevel ?? 'L1',
      scopes: [...ext.scopes],
      externalId: input.externalId,
    });

    const resource = agentToScimResource(agent, config.baseUrl);
    return jsonResponse(201, resource, {
      'Location': resource.meta.location,
      'ETag': resource.meta.version,
    });
  } catch (err) {
    if (err instanceof StoreError && err.code === 'CONFLICT') {
      return scimError(409, 'uniqueness', err.message);
    }
    throw err;
  }
}

// ── PUT /Users/:id ────────────────────────────────────────────────────────

async function handleReplaceUser(
  userId: string,
  request: Request,
  config: ResolvedScimConfig,
  provisioner: AgentProvisioner,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return scimError(400, 'invalidSyntax', 'Request body must be valid JSON');
  }

  let input: CreateAgentFromScimInput;
  try {
    input = parseReplaceInput(body);
  } catch (err) {
    return scimError(400, 'invalidValue', `Invalid SCIM User payload: ${extractMessage(err)}`);
  }

  const ext = input[OPENAGENT_AGENT_SCHEMA];

  try {
    const agent = await provisioner.replaceAgent(userId, {
      userName: input.userName,
      displayName: input.displayName,
      parentDid: ext.parentDid,
      conformanceLevel: ext.conformanceLevel ?? 'L1',
      scopes: [...ext.scopes],
      externalId: input.externalId,
    });

    const resource = agentToScimResource(agent, config.baseUrl);
    return jsonResponse(200, resource, { 'ETag': resource.meta.version });
  } catch (err) {
    if (err instanceof ProvisionerError && err.code === 'NOT_FOUND') {
      return scimError(404, 'invalidValue', err.message);
    }
    throw err;
  }
}

// ── PATCH /Users/:id ──────────────────────────────────────────────────────

async function handlePatchUser(
  userId: string,
  request: Request,
  config: ResolvedScimConfig,
  provisioner: AgentProvisioner,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return scimError(400, 'invalidSyntax', 'Request body must be valid JSON');
  }

  let patchReq;
  try {
    patchReq = parsePatchRequest(body);
  } catch (err) {
    return scimError(400, 'invalidValue', `Invalid SCIM PatchOp: ${extractMessage(err)}`);
  }

  const existing = await provisioner.findByDid(userId);
  if (!existing) {
    return scimError(404, 'invalidValue', `User "${userId}" not found`);
  }

  let updated: AgentRecord;
  try {
    updated = applyPatchOperations(existing, patchReq.Operations);
  } catch (err) {
    if (err instanceof ScimPatchError) {
      return scimError(400, 'invalidValue', err.message);
    }
    throw err;
  }

  const result = await provisioner.updateAgent(userId, updated);
  const resource = agentToScimResource(result, config.baseUrl);
  return jsonResponse(200, resource, { 'ETag': resource.meta.version });
}

// ── DELETE /Users/:id ─────────────────────────────────────────────────────

async function handleDeleteUser(
  userId: string,
  provisioner: AgentProvisioner,
): Promise<Response> {
  try {
    await provisioner.deprovisionAgent(userId);
  } catch (err) {
    if (err instanceof ProvisionerError && err.code === 'NOT_FOUND') {
      return scimError(404, 'invalidValue', `User "${userId}" not found`);
    }
    if (err instanceof StoreError && err.code === 'NOT_FOUND') {
      return scimError(404, 'invalidValue', `User "${userId}" not found`);
    }
    throw err;
  }

  return new Response(null, { status: 204 });
}

// ── Response helpers ──────────────────────────────────────────────────────

function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/scim+json',
    ...extraHeaders,
  };
  return new Response(JSON.stringify(body), { status, headers });
}

function scimError(status: number, scimType: string, detail: string): Response {
  return jsonResponse(status, {
    schemas: [SCIM_ERROR_SCHEMA],
    status: String(status),
    scimType,
    detail,
  });
}

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}
