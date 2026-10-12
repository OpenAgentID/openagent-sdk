/**
 * SCIM bridge test suite — full CRUD + deprovisioning cascade + filtering + pagination.
 */

import { signingAuthority } from './sdk-fixture.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createScimRouter,
  createSdkScimProvisioner,
  type ScimRouter,
  InMemoryAgentStore,
  SCIM_USER_SCHEMA,
  OPENAGENT_AGENT_SCHEMA,
  SCIM_ERROR_SCHEMA,
  SCIM_PATCH_OP_SCHEMA,
  SCIM_LIST_RESPONSE_SCHEMA,
  type AuditEvent,
  parseFilter,
  matchesFilter,
  type AgentRecord,
  applyPatchOperations,
  parsePagination,
  paginateResults,
  ScimFilterError,
  ScimPatchError,
  buildServiceProviderConfig,
  buildSchemas,
  buildResourceTypes,
  agentToScimResource,
} from '../src/index.js';

// ── Test helpers ──────────────────────────────────────────────────────────

const BASE_URL = 'https://scim.test.com/scim/v2';
const BEARER_TOKEN = 'test-token-abc123';

function makeRequest(path: string, init?: RequestInit): Request {
  return new Request(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${BEARER_TOKEN}`,
      'Content-Type': 'application/scim+json',
      ...((init?.headers as Record<string, string>) ?? {}),
    },
  });
}

function validAgentPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemas: [SCIM_USER_SCHEMA, OPENAGENT_AGENT_SCHEMA],
    userName: 'test-bot',
    displayName: 'Test Bot Agent',
    active: true,
    [OPENAGENT_AGENT_SCHEMA]: {
      parentDid: 'did:oas:l1fe:hmr:alice',
      conformanceLevel: 'L2',
      scopes: ['openai:chat:completions', 'github:repo:read'],
    },
    ...overrides,
  };
}

let store: InMemoryAgentStore;
let auditEvents: AuditEvent[];
let revokedDids: string[];
let cascadedDids: string[];
let invalidatedDids: string[];
let router: ScimRouter;
let authority: ReturnType<typeof signingAuthority>;

beforeEach(() => {
  store = new InMemoryAgentStore();
  authority = signingAuthority();
  auditEvents = [];
  revokedDids = [];
  cascadedDids = [];
  invalidatedDids = [];

  router = createScimRouter({
    namespace: 'l1fe',
    provisionIdentity: createSdkScimProvisioner(authority.runtime),
    updateIdentityScopes: authority.updateScopes,
    bearerTokens: [BEARER_TOKEN],
    baseUrl: BASE_URL,
    maxPageSize: 50,
    store,
    auditSink: (event) => { auditEvents.push(event); },
    revokeDidDocument: async (did) => { revokedDids.push(did); },
    cascadeRevokeDelegations: async (did) => { cascadedDids.push(did); },
    invalidateArsenalSessions: async (did) => { invalidatedDids.push(did); },
  });
});

// ── Discovery endpoints ───────────────────────────────────────────────────

describe('Discovery endpoints', () => {
  it('GET /ServiceProviderConfig returns config', async () => {
    const res = await router.handle(makeRequest('/ServiceProviderConfig'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.patch.supported).toBe(true);
    expect(body.filter.supported).toBe(true);
    expect(body.bulk.supported).toBe(false);
    expect(body.authenticationSchemes).toHaveLength(1);
    expect(body.authenticationSchemes[0].type).toBe('oauthbearertoken');
  });

  it('GET /Schemas returns User and Agent schemas', async () => {
    const res = await router.handle(makeRequest('/Schemas'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalResults).toBe(2);
    expect(body.Resources).toHaveLength(2);
    const ids = body.Resources.map((s: Record<string, unknown>) => s.id);
    expect(ids).toContain(SCIM_USER_SCHEMA);
    expect(ids).toContain(OPENAGENT_AGENT_SCHEMA);
  });

  it('GET /ResourceTypes returns User resource type', async () => {
    const res = await router.handle(makeRequest('/ResourceTypes'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalResults).toBe(1);
    expect(body.Resources[0].name).toBe('User');
    expect(body.Resources[0].schemaExtensions[0].schema).toBe(OPENAGENT_AGENT_SCHEMA);
  });
});

// ── Authentication ────────────────────────────────────────────────────────

describe('Authentication', () => {
  it('rejects requests without Authorization header', async () => {
    const req = new Request(`${BASE_URL}/Users`, { method: 'GET' });
    const res = await router.handle(req);
    expect(res.status).toBe(401);
  });

  it('rejects requests with wrong token', async () => {
    const req = new Request(`${BASE_URL}/Users`, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer wrong-token' },
    });
    const res = await router.handle(req);
    expect(res.status).toBe(401);
  });

  it('accepts requests with valid token', async () => {
    const res = await router.handle(makeRequest('/Users'));
    expect(res.status).toBe(200);
  });
});

// ── POST /Users — Create ─────────────────────────────────────────────────

describe('POST /Users — Create agent', () => {
  it('creates an agent and returns 201 with Location header', async () => {
    const res = await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload()),
    }));

    expect(res.status).toBe(201);
    expect(res.headers.get('Location')).toBeTruthy();
    expect(res.headers.get('ETag')).toBeTruthy();
    expect(res.headers.get('Content-Type')).toBe('application/scim+json');

    const body = await res.json();
    expect(body.schemas).toContain(SCIM_USER_SCHEMA);
    expect(body.schemas).toContain(OPENAGENT_AGENT_SCHEMA);
    expect(body.userName).toBe('test-bot');
    expect(body.displayName).toBe('Test Bot Agent');
    expect(body.active).toBe(true);
    expect(body.id).toMatch(/^did:oas:test:agent:test-bot$/);

    const ext = body[OPENAGENT_AGENT_SCHEMA];
    expect(ext.parentDid).toBe('did:oas:l1fe:hmr:alice');
    expect(ext.conformanceLevel).toBe('L2');
    expect(ext.scopes).toEqual(['openai:chat:completions', 'github:repo:read']);
    expect(ext.lineageDepth).toBe(1);
    expect(ext.createdVia).toBe('scim');
    expect(ext.keypairFingerprint).toMatch(/^u/);
  });

  it('emits audit event on creation', async () => {
    await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload()),
    }));

    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].type).toBe('agent.created');
    expect(auditEvents[0].did).toMatch(/^did:oas:/);
  });

  it('returns 409 on duplicate userName', async () => {
    await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload()),
    }));

    const res = await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload()),
    }));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.scimType).toBe('uniqueness');
  });

  it('returns 400 on invalid payload', async () => {
    const res = await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify({ schemas: [], userName: '' }),
    }));

    expect(res.status).toBe(400);
  });

  it('returns 400 on malformed JSON', async () => {
    const res = await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: 'not-json',
    }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.scimType).toBe('invalidSyntax');
  });

  it('sets lineageDepth to 1 for HMR parent', async () => {
    const res = await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload()),
    }));

    const body = await res.json();
    expect(body[OPENAGENT_AGENT_SCHEMA].lineageDepth).toBe(1);
  });

  it('calculates lineageDepth from parent agent', async () => {
    // Create parent agent first
    await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload({ userName: 'parent-bot' })),
    }));

    // Create child agent with parent as agent
    const childPayload = validAgentPayload({
      userName: 'child-bot',
      [OPENAGENT_AGENT_SCHEMA]: {
        parentDid: 'did:oas:test:agent:parent-bot',
        conformanceLevel: 'L1',
        scopes: ['github:repo:read'],
      },
    });

    const res = await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(childPayload),
    }));

    const body = await res.json();
    expect(body[OPENAGENT_AGENT_SCHEMA].lineageDepth).toBe(2);
  });
});

// ── GET /Users — List ─────────────────────────────────────────────────────

describe('GET /Users — List agents', () => {
  it('returns empty list when no agents exist', async () => {
    const res = await router.handle(makeRequest('/Users'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schemas).toContain(SCIM_LIST_RESPONSE_SCHEMA);
    expect(body.totalResults).toBe(0);
    expect(body.Resources).toEqual([]);
  });

  it('returns all agents', async () => {
    await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload({ userName: 'bot-1' })),
    }));
    await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload({ userName: 'bot-2' })),
    }));

    const res = await router.handle(makeRequest('/Users'));
    const body = await res.json();
    expect(body.totalResults).toBe(2);
    expect(body.Resources).toHaveLength(2);
  });

  it('supports filter by userName eq', async () => {
    await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload({ userName: 'bot-alpha' })),
    }));
    await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload({ userName: 'bot-beta' })),
    }));

    const res = await router.handle(makeRequest('/Users?filter=userName%20eq%20%22bot-alpha%22'));
    const body = await res.json();
    expect(body.totalResults).toBe(1);
    expect(body.Resources[0].userName).toBe('bot-alpha');
  });

  it('supports filter by active eq true', async () => {
    await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload({ userName: 'active-bot' })),
    }));

    const res = await router.handle(makeRequest('/Users?filter=active%20eq%20true'));
    const body = await res.json();
    expect(body.totalResults).toBe(1);
  });

  it('supports pagination with startIndex and count', async () => {
    for (let i = 0; i < 5; i++) {
      await router.handle(makeRequest('/Users', {
        method: 'POST',
        body: JSON.stringify(validAgentPayload({ userName: `bot-${i}` })),
      }));
    }

    const res = await router.handle(makeRequest('/Users?startIndex=2&count=2'));
    const body = await res.json();
    expect(body.totalResults).toBe(5);
    expect(body.startIndex).toBe(2);
    expect(body.itemsPerPage).toBe(2);
    expect(body.Resources).toHaveLength(2);
  });

  it('returns 400 on invalid filter', async () => {
    const res = await router.handle(makeRequest('/Users?filter=invalid!!!'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.scimType).toBe('invalidFilter');
  });
});

// ── GET /Users/:id — Get by DID ──────────────────────────────────────────

describe('GET /Users/:id — Get agent by DID', () => {
  it('returns agent by DID', async () => {
    const createRes = await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload()),
    }));
    const created = await createRes.json();

    const res = await router.handle(makeRequest(`/Users/${encodeURIComponent(created.id)}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(created.id);
    expect(body.userName).toBe('test-bot');
  });

  it('returns 404 for unknown DID', async () => {
    const res = await router.handle(makeRequest('/Users/did:oas:l1fe:agent:nonexistent'));
    expect(res.status).toBe(404);
  });
});

// ── PUT /Users/:id — Replace ──────────────────────────────────────────────

describe('PUT /Users/:id — Replace agent', () => {
  it('replaces agent attributes', async () => {
    const createRes = await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload()),
    }));
    const created = await createRes.json();

    const updated = validAgentPayload({
      userName: 'test-bot',
      displayName: 'Updated Bot',
      [OPENAGENT_AGENT_SCHEMA]: {
        parentDid: 'did:oas:l1fe:hmr:alice',
        conformanceLevel: 'L1',
        scopes: ['github:repo:write'],
      },
    });

    const res = await router.handle(makeRequest(`/Users/${encodeURIComponent(created.id)}`, {
      method: 'PUT',
      body: JSON.stringify(updated),
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.displayName).toBe('Updated Bot');
    expect(body[OPENAGENT_AGENT_SCHEMA].scopes).toEqual(['github:repo:write']);
    expect(body[OPENAGENT_AGENT_SCHEMA].conformanceLevel).toBe('L1');
  });

  it('returns 404 for unknown DID', async () => {
    const res = await router.handle(makeRequest('/Users/did:oas:l1fe:agent:ghost', {
      method: 'PUT',
      body: JSON.stringify(validAgentPayload()),
    }));
    expect(res.status).toBe(404);
  });

  it('emits audit event on replace', async () => {
    const createRes = await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload()),
    }));
    const created = await createRes.json();
    auditEvents.length = 0;

    await router.handle(makeRequest(`/Users/${encodeURIComponent(created.id)}`, {
      method: 'PUT',
      body: JSON.stringify(validAgentPayload({ displayName: 'V2' })),
    }));

    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].type).toBe('agent.updated');
  });
});

// ── PATCH /Users/:id — Partial update ────────────────────────────────────

describe('PATCH /Users/:id — Partial update', () => {
  it('updates displayName via replace operation', async () => {
    const createRes = await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload()),
    }));
    const created = await createRes.json();

    const patchBody = {
      schemas: [SCIM_PATCH_OP_SCHEMA],
      Operations: [
        { op: 'replace', path: 'displayName', value: 'Patched Bot' },
      ],
    };

    const res = await router.handle(makeRequest(`/Users/${encodeURIComponent(created.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patchBody),
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.displayName).toBe('Patched Bot');
  });

  it('deactivates agent via replace active=false', async () => {
    const createRes = await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload()),
    }));
    const created = await createRes.json();

    const patchBody = {
      schemas: [SCIM_PATCH_OP_SCHEMA],
      Operations: [
        { op: 'replace', path: 'active', value: false },
      ],
    };

    const res = await router.handle(makeRequest(`/Users/${encodeURIComponent(created.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patchBody),
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.active).toBe(false);
  });

  it('updates scopes via add operation', async () => {
    const createRes = await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload()),
    }));
    const created = await createRes.json();

    const patchBody = {
      schemas: [SCIM_PATCH_OP_SCHEMA],
      Operations: [
        { op: 'add', path: 'scopes', value: ['stripe:charges:create'] },
      ],
    };

    const res = await router.handle(makeRequest(`/Users/${encodeURIComponent(created.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patchBody),
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[OPENAGENT_AGENT_SCHEMA].scopes).toEqual(['stripe:charges:create']);
  });

  it('returns 404 for unknown DID', async () => {
    const patchBody = {
      schemas: [SCIM_PATCH_OP_SCHEMA],
      Operations: [{ op: 'replace', path: 'displayName', value: 'X' }],
    };

    const res = await router.handle(makeRequest('/Users/did:oas:l1fe:agent:nope', {
      method: 'PATCH',
      body: JSON.stringify(patchBody),
    }));
    expect(res.status).toBe(404);
  });

  it('returns 400 on invalid patch operation', async () => {
    const createRes = await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload()),
    }));
    const created = await createRes.json();

    const patchBody = {
      schemas: [SCIM_PATCH_OP_SCHEMA],
      Operations: [{ op: 'replace', path: 'id', value: 'hacked' }],
    };

    const res = await router.handle(makeRequest(`/Users/${encodeURIComponent(created.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patchBody),
    }));
    expect(res.status).toBe(400);
  });
});

// ── DELETE /Users/:id — Deprovisioning cascade ───────────────────────────

describe('DELETE /Users/:id — Deprovisioning cascade', () => {
  it('returns 204 No Content on successful delete', async () => {
    const createRes = await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload()),
    }));
    const created = await createRes.json();

    const res = await router.handle(makeRequest(`/Users/${encodeURIComponent(created.id)}`, {
      method: 'DELETE',
    }));

    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it('revokes the DID document', async () => {
    const createRes = await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload()),
    }));
    const created = await createRes.json();

    await router.handle(makeRequest(`/Users/${encodeURIComponent(created.id)}`, {
      method: 'DELETE',
    }));

    expect(revokedDids).toContain(created.id);
  });

  it('cascade-revokes all delegation proofs', async () => {
    const createRes = await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload()),
    }));
    const created = await createRes.json();

    await router.handle(makeRequest(`/Users/${encodeURIComponent(created.id)}`, {
      method: 'DELETE',
    }));

    expect(cascadedDids).toContain(created.id);
  });

  it('invalidates all Arsenal sessions', async () => {
    const createRes = await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload()),
    }));
    const created = await createRes.json();

    await router.handle(makeRequest(`/Users/${encodeURIComponent(created.id)}`, {
      method: 'DELETE',
    }));

    expect(invalidatedDids).toContain(created.id);
  });

  it('emits agent.deprovisioned audit event', async () => {
    const createRes = await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload()),
    }));
    const created = await createRes.json();
    auditEvents.length = 0;

    await router.handle(makeRequest(`/Users/${encodeURIComponent(created.id)}`, {
      method: 'DELETE',
    }));

    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].type).toBe('agent.deprovisioned');
    expect(auditEvents[0].did).toBe(created.id);
  });

  it('agent is gone after delete', async () => {
    const createRes = await router.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload()),
    }));
    const created = await createRes.json();

    await router.handle(makeRequest(`/Users/${encodeURIComponent(created.id)}`, {
      method: 'DELETE',
    }));

    const getRes = await router.handle(makeRequest(`/Users/${encodeURIComponent(created.id)}`));
    expect(getRes.status).toBe(404);
  });

  it('returns 404 for unknown DID', async () => {
    const res = await router.handle(makeRequest('/Users/did:oas:l1fe:agent:nonexistent', {
      method: 'DELETE',
    }));
    expect(res.status).toBe(404);
  });

  it('continues cascade even if DID revocation fails', async () => {
    const failRouter = createScimRouter({
      namespace: 'l1fe',
    provisionIdentity: createSdkScimProvisioner(authority.runtime),
    updateIdentityScopes: authority.updateScopes,
      bearerTokens: [BEARER_TOKEN],
      baseUrl: BASE_URL,
      store,
      revokeDidDocument: async () => { throw new Error('OAS down'); },
      cascadeRevokeDelegations: async (did) => { cascadedDids.push(did); },
      invalidateArsenalSessions: async (did) => { invalidatedDids.push(did); },
    });

    const createRes = await failRouter.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload()),
    }));
    const created = await createRes.json();

    const res = await failRouter.handle(makeRequest(`/Users/${encodeURIComponent(created.id)}`, {
      method: 'DELETE',
    }));

    expect(res.status).toBe(503);
    expect((await store.findByDid(created.id))?.active).toBe(false);
    // Cascade and invalidation still ran
    expect(cascadedDids).toContain(created.id);
    expect(invalidatedDids).toContain(created.id);
  });

  it('executes all 3 deprovisioning steps in order', async () => {
    const executionOrder: string[] = [];

    const orderRouter = createScimRouter({
      namespace: 'l1fe',
    provisionIdentity: createSdkScimProvisioner(authority.runtime),
    updateIdentityScopes: authority.updateScopes,
      bearerTokens: [BEARER_TOKEN],
      baseUrl: BASE_URL,
      store,
      revokeDidDocument: async () => { executionOrder.push('revoke-did'); },
      cascadeRevokeDelegations: async () => { executionOrder.push('cascade-delegations'); },
      invalidateArsenalSessions: async () => { executionOrder.push('invalidate-sessions'); },
    });

    const createRes = await orderRouter.handle(makeRequest('/Users', {
      method: 'POST',
      body: JSON.stringify(validAgentPayload()),
    }));
    const created = await createRes.json();

    await orderRouter.handle(makeRequest(`/Users/${encodeURIComponent(created.id)}`, {
      method: 'DELETE',
    }));

    expect(executionOrder).toEqual([
      'revoke-did',
      'cascade-delegations',
      'invalidate-sessions',
    ]);
  });
});

// ── Filter parser unit tests ──────────────────────────────────────────────

describe('Filter parser', () => {
  it('parses simple eq filter', () => {
    const f = parseFilter('userName eq "test"');
    expect(f).toEqual({
      type: 'attribute',
      attribute: 'userName',
      op: 'eq',
      value: 'test',
    });
  });

  it('parses boolean filter', () => {
    const f = parseFilter('active eq true');
    expect(f).toEqual({
      type: 'attribute',
      attribute: 'active',
      op: 'eq',
      value: true,
    });
  });

  it('parses co (contains) filter', () => {
    const f = parseFilter('displayName co "bot"');
    expect(f).toEqual({
      type: 'attribute',
      attribute: 'displayName',
      op: 'co',
      value: 'bot',
    });
  });

  it('parses compound and filter', () => {
    const f = parseFilter('userName eq "test" and active eq true');
    expect(f?.type).toBe('and');
    if (f?.type === 'and') {
      expect(f.filters).toHaveLength(2);
    }
  });

  it('parses compound or filter', () => {
    const f = parseFilter('userName eq "a" or userName eq "b"');
    expect(f?.type).toBe('or');
  });

  it('returns undefined for empty filter', () => {
    expect(parseFilter('')).toBeUndefined();
    expect(parseFilter(undefined)).toBeUndefined();
    expect(parseFilter(null)).toBeUndefined();
  });

  it('throws on invalid operator', () => {
    expect(() => parseFilter('userName badop "test"')).toThrow(ScimFilterError);
  });

  it('throws on missing value', () => {
    expect(() => parseFilter('userName eq')).toThrow(ScimFilterError);
  });
});

// ── Filter matching unit tests ────────────────────────────────────────────

describe('Filter matching', () => {
  const record: AgentRecord = {
    did: 'did:oas:l1fe:agent:test',
    userName: 'test-agent',
    displayName: 'Test Agent',
    active: true,
    parentDid: 'did:oas:l1fe:hmr:alice',
    conformanceLevel: 'L2',
    scopes: ['openai:chat:completions'],
    lineageDepth: 1,
    createdVia: 'scim',
    keypairFingerprint: 'z6Mktest',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    version: 'v1',
  };

  it('matches eq on userName', () => {
    const f = parseFilter('userName eq "test-agent"')!;
    expect(matchesFilter(record, f)).toBe(true);
  });

  it('does not match eq with wrong value', () => {
    const f = parseFilter('userName eq "other"')!;
    expect(matchesFilter(record, f)).toBe(false);
  });

  it('matches co on displayName', () => {
    const f = parseFilter('displayName co "Agent"')!;
    expect(matchesFilter(record, f)).toBe(true);
  });

  it('matches sw (starts with)', () => {
    const f = parseFilter('displayName sw "Test"')!;
    expect(matchesFilter(record, f)).toBe(true);
  });

  it('matches active eq true', () => {
    const f = parseFilter('active eq true')!;
    expect(matchesFilter(record, f)).toBe(true);
  });

  it('matches ne (not equal)', () => {
    const f = parseFilter('userName ne "other"')!;
    expect(matchesFilter(record, f)).toBe(true);
  });

  it('returns true when filter is undefined (match all)', () => {
    expect(matchesFilter(record, undefined)).toBe(true);
  });
});

// ── Pagination unit tests ─────────────────────────────────────────────────

describe('Pagination', () => {
  it('defaults to startIndex=1', () => {
    const params = parsePagination(new URLSearchParams(), 100);
    expect(params.startIndex).toBe(1);
  });

  it('caps count to maxPageSize', () => {
    const params = parsePagination(new URLSearchParams('count=500'), 50);
    expect(params.count).toBe(50);
  });

  it('paginates results correctly', () => {
    const items = [1, 2, 3, 4, 5];
    const result = paginateResults(items, { startIndex: 2, count: 2 });
    expect(result.totalResults).toBe(5);
    expect(result.startIndex).toBe(2);
    expect(result.itemsPerPage).toBe(2);
    expect(result.Resources).toEqual([2, 3]);
  });

  it('handles startIndex beyond items', () => {
    const items = [1, 2, 3];
    const result = paginateResults(items, { startIndex: 10, count: 10 });
    expect(result.totalResults).toBe(3);
    expect(result.itemsPerPage).toBe(0);
    expect(result.Resources).toEqual([]);
  });
});

// ── PATCH operations unit tests ───────────────────────────────────────────

describe('PATCH operations', () => {
  const baseRecord: AgentRecord = {
    did: 'did:oas:l1fe:agent:test',
    userName: 'test',
    displayName: 'Test',
    active: true,
    parentDid: 'did:oas:l1fe:hmr:alice',
    conformanceLevel: 'L2',
    scopes: ['openai:chat:completions'],
    lineageDepth: 1,
    createdVia: 'scim',
    keypairFingerprint: 'z6Mktest',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    version: 'v1',
  };

  it('replaces displayName', () => {
    const result = applyPatchOperations(baseRecord, [
      { op: 'replace', path: 'displayName', value: 'New Name' },
    ]);
    expect(result.displayName).toBe('New Name');
    expect(result.userName).toBe('test'); // unchanged
  });

  it('replaces active', () => {
    const result = applyPatchOperations(baseRecord, [
      { op: 'replace', path: 'active', value: false },
    ]);
    expect(result.active).toBe(false);
  });

  it('does not mutate the original record', () => {
    const result = applyPatchOperations(baseRecord, [
      { op: 'replace', path: 'displayName', value: 'Changed' },
    ]);
    expect(baseRecord.displayName).toBe('Test');
    expect(result.displayName).toBe('Changed');
  });

  it('applies multiple operations in order', () => {
    const result = applyPatchOperations(baseRecord, [
      { op: 'replace', path: 'displayName', value: 'Step 1' },
      { op: 'replace', path: 'displayName', value: 'Step 2' },
    ]);
    expect(result.displayName).toBe('Step 2');
  });

  it('throws on unknown attribute', () => {
    expect(() =>
      applyPatchOperations(baseRecord, [
        { op: 'replace', path: 'nonexistent', value: 'x' },
      ]),
    ).toThrow(ScimPatchError);
  });

  it('throws on remove without path', () => {
    expect(() =>
      applyPatchOperations(baseRecord, [{ op: 'remove' }]),
    ).toThrow(ScimPatchError);
  });

  it('handles extension-prefixed paths', () => {
    const result = applyPatchOperations(baseRecord, [
      { op: 'replace', path: `${OPENAGENT_AGENT_SCHEMA}:scopes`, value: ['new:scope:x'] },
    ]);
    expect(result.scopes).toEqual(['new:scope:x']);
  });
});

// ── Schema builder unit tests ─────────────────────────────────────────────

describe('Schema builders', () => {
  it('buildServiceProviderConfig has correct structure', () => {
    const spc = buildServiceProviderConfig('https://example.com/scim/v2');
    expect(spc.patch).toEqual({ supported: true });
    expect(spc.filter).toEqual({ supported: true, maxResults: 200 });
    expect((spc.meta as Record<string, unknown>).location).toBe('https://example.com/scim/v2/ServiceProviderConfig');
  });

  it('buildSchemas returns 2 schemas', () => {
    const schemas = buildSchemas();
    expect(schemas).toHaveLength(2);
  });

  it('buildResourceTypes returns 1 resource type', () => {
    const types = buildResourceTypes('https://example.com/scim/v2');
    expect(types).toHaveLength(1);
    expect(types[0].name).toBe('User');
  });
});

// ── Resource mapping unit tests ───────────────────────────────────────────

describe('Resource mapping', () => {
  it('maps AgentRecord to ScimAgentResource', () => {
    const record: AgentRecord = {
      did: 'did:oas:l1fe:agent:test',
      userName: 'test',
      displayName: 'Test Agent',
      active: true,
      parentDid: 'did:oas:l1fe:hmr:alice',
      conformanceLevel: 'L2',
      scopes: ['openai:chat:completions'],
      lineageDepth: 1,
      createdVia: 'scim',
      keypairFingerprint: 'z6Mktest',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      version: 'v1',
    };

    const resource = agentToScimResource(record, 'https://example.com/scim/v2');
    expect(resource.schemas).toContain(SCIM_USER_SCHEMA);
    expect(resource.schemas).toContain(OPENAGENT_AGENT_SCHEMA);
    expect(resource.id).toBe('did:oas:l1fe:agent:test');
    expect(resource.meta.resourceType).toBe('User');
    expect(resource.meta.version).toBe('W/"v1"');
    expect(resource[OPENAGENT_AGENT_SCHEMA].parentDid).toBe('did:oas:l1fe:hmr:alice');
  });
});

// ── Store unit tests ──────────────────────────────────────────────────────

describe('InMemoryAgentStore', () => {
  it('create and findByDid roundtrip', async () => {
    const record: AgentRecord = {
      did: 'did:oas:l1fe:agent:store-test',
      userName: 'store-test',
      displayName: 'Store Test',
      active: true,
      parentDid: 'did:oas:l1fe:hmr:alice',
      conformanceLevel: 'L1',
      scopes: ['github:repo:read'],
      lineageDepth: 1,
      createdVia: 'scim',
      keypairFingerprint: 'z6Mktest',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 'v1',
    };

    const s = new InMemoryAgentStore();
    await s.create(record);
    const found = await s.findByDid('did:oas:l1fe:agent:store-test');
    expect(found?.userName).toBe('store-test');
  });

  it('findByDid returns undefined for missing DID', async () => {
    const s = new InMemoryAgentStore();
    const found = await s.findByDid('did:oas:l1fe:agent:missing');
    expect(found).toBeUndefined();
  });

  it('delete removes the record', async () => {
    const record: AgentRecord = {
      did: 'did:oas:l1fe:agent:del-test',
      userName: 'del-test',
      displayName: 'Delete Test',
      active: true,
      parentDid: 'did:oas:l1fe:hmr:alice',
      conformanceLevel: 'L1',
      scopes: ['github:repo:read'],
      lineageDepth: 1,
      createdVia: 'scim',
      keypairFingerprint: 'z6Mktest',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 'v1',
    };

    const s = new InMemoryAgentStore();
    await s.create(record);
    await s.delete('did:oas:l1fe:agent:del-test');
    const found = await s.findByDid('did:oas:l1fe:agent:del-test');
    expect(found).toBeUndefined();
  });

  it('countActive counts only active agents', async () => {
    const s = new InMemoryAgentStore();
    await s.create({
      did: 'did:oas:l1fe:agent:active',
      userName: 'active',
      displayName: 'Active',
      active: true,
      parentDid: 'did:oas:l1fe:hmr:alice',
      conformanceLevel: 'L1',
      scopes: ['x:y:z'],
      lineageDepth: 1,
      createdVia: 'scim',
      keypairFingerprint: 'z6Mk1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 'v1',
    });
    await s.create({
      did: 'did:oas:l1fe:agent:inactive',
      userName: 'inactive',
      displayName: 'Inactive',
      active: false,
      parentDid: 'did:oas:l1fe:hmr:alice',
      conformanceLevel: 'L1',
      scopes: ['x:y:z'],
      lineageDepth: 1,
      createdVia: 'scim',
      keypairFingerprint: 'z6Mk2',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 'v1',
    });

    expect(await s.countActive()).toBe(1);
  });
});

// ── Content-Type header ───────────────────────────────────────────────────

describe('Content-Type', () => {
  it('all responses use application/scim+json', async () => {
    const res = await router.handle(makeRequest('/ServiceProviderConfig'));
    expect(res.headers.get('Content-Type')).toBe('application/scim+json');
  });
});
