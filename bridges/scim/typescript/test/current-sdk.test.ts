import { expect, it } from 'vitest';
import { signingAuthority } from './sdk-fixture.js';
import { createSdkScimProvisioner, createScimRouter, InMemoryAgentStore, IdentityNotCreatedError, OPENAGENT_AGENT_SCHEMA, SCIM_USER_SCHEMA, type AgentRecord, type UserNameReservation } from '../src/index.js';

it('provisions an actual current-SDK signer and revokes its authority before deleting the SCIM record', async () => {
  const authority = signingAuthority();
  const store = new InMemoryAgentStore();
  const router = createScimRouter({ bearerTokens: ['scim-test-only'], store,
    provisionIdentity: createSdkScimProvisioner(authority.runtime),
    revokeDidDocument: authority.revoke,
    // This authority issues no delegations or credential sessions; prove both inventories empty.
    cascadeRevokeDelegations: async did => { expect((await store.findByDid(did))?.active).toBe(false); },
    invalidateArsenalSessions: async did => { await expect(authority.provider.resolve(did)).rejects.toThrow('Revoked'); },
  });
  const request = (path: string, init?: RequestInit) => new Request(`https://scim.example.test/scim/v2${path}`, {
    ...init, headers: { Authorization: 'Bearer scim-test-only', 'content-type': 'application/scim+json' },
  });
  const response = await router.handle(request('/Users', { method: 'POST', body: JSON.stringify({
    schemas: [SCIM_USER_SCHEMA, OPENAGENT_AGENT_SCHEMA], userName: 'actual-agent',
    [OPENAGENT_AGENT_SCHEMA]: { parentDid: 'did:oas:test:hmr:owner', scopes: ['tools:invoke:read'], conformanceLevel: 'L1' },
  }) }));
  expect(response.status).toBe(201);
  const body = await response.json();
  const payload = new TextEncoder().encode('SCIM current SDK possession');
  const signature = await authority.provider.signChallenge(body.id, payload);
  expect(authority.verify(body.id, payload, signature.signature)).toBe(true);
  expect(authority.verify(body.id, new TextEncoder().encode('tampered'), signature.signature)).toBe(false);
  expect(body[OPENAGENT_AGENT_SCHEMA].keypairFingerprint).toBe((await authority.provider.resolve(body.id)).publicKeyMultibase);
  expect((await router.handle(request(`/Users/${encodeURIComponent(body.id)}`, { method: 'DELETE' }))).status).toBe(204);
  expect(authority.verify(body.id, payload, signature.signature)).toBe(false);
  expect(await store.findByDid(body.id)).toBeUndefined();
});

it('fails closed without identity creation or bearer authentication', async () => {
  expect(() => createScimRouter()).toThrow('bearer tokens');
  const router = createScimRouter({ bearerTokens: ['scim-test-only'] });
  const response = await router.handle(new Request('https://example.test/scim/v2/Users', { method: 'POST',
    headers: { authorization: 'Bearer scim-test-only' }, body: JSON.stringify({ schemas: [SCIM_USER_SCHEMA, OPENAGENT_AGENT_SCHEMA],
      userName: 'missing-authority', [OPENAGENT_AGENT_SCHEMA]: { parentDid: 'did:oas:test:hmr:owner', scopes: ['tools:invoke:read'] } }) }));
  expect(response.status).toBe(503);
});

function createRequest(userName = 'concurrent-agent', scopes = ['tools:invoke:read']): Request {
  return new Request('https://scim.example.test/scim/v2/Users', { method: 'POST',
    headers: { authorization: 'Bearer scim-test-only', 'content-type': 'application/scim+json' },
    body: JSON.stringify({ schemas: [SCIM_USER_SCHEMA, OPENAGENT_AGENT_SCHEMA], userName,
      [OPENAGENT_AGENT_SCHEMA]: { parentDid: 'did:oas:test:hmr:owner', scopes } }),
  });
}

it('rejects invalid SDK scopes before minting and permits a corrected retry for that username', async () => {
  const authority = signingAuthority({ uniqueDids: true });
  const store = new InMemoryAgentStore();
  const router = createScimRouter({ bearerTokens: ['scim-test-only'], store,
    provisionIdentity: createSdkScimProvisioner(authority.runtime),
  });
  const invalid = await router.handle(createRequest('corrected-agent', ['invalid']));
  expect(invalid.status).toBe(400);
  expect((await invalid.json()).scimType).toBe('invalidValue');
  expect(authority.issuedDids()).toEqual([]);
  expect(await store.findUserNameReservation('corrected-agent')).toBeUndefined();
  expect((await router.handle(createRequest('corrected-agent'))).status).toBe(201);
  expect(authority.issuedDids()).toHaveLength(1);
});

it('reserves a username across routers before the authority can mint distinct real identities', async () => {
  const authority = signingAuthority({ uniqueDids: true });
  const store = new InMemoryAgentStore();
  const provision = createSdkScimProvisioner(authority.runtime);
  let mintCalls = 0;
  let started!: () => void;
  let resume!: () => void;
  const authorityStarted = new Promise<void>(resolve => { started = resolve; });
  const authorityMayFinish = new Promise<void>(resolve => { resume = resolve; });
  const provisionIdentity: typeof provision = async params => {
    mintCalls++;
    started();
    await authorityMayFinish;
    return provision(params);
  };
  // Separate routers/provisioners share only the persistence boundary. There is
  // deliberately no router-local mutex and the authority would mint a new DID
  // on every invocation, even for the same username.
  const firstRouter = createScimRouter({ bearerTokens: ['scim-test-only'], store, provisionIdentity });
  const secondRouter = createScimRouter({ bearerTokens: ['scim-test-only'], store, provisionIdentity });
  const first = firstRouter.handle(createRequest());
  await authorityStarted;
  const loser = await secondRouter.handle(createRequest());
  expect(loser.status).toBe(409);
  expect((await loser.json()).scimType).toBe('uniqueness');
  expect(mintCalls).toBe(1);
  resume();
  const winner = await first;
  expect(winner.status).toBe(201);
  const created = await winner.json();
  expect(authority.issuedDids()).toEqual([created.id]);
  expect(await store.findUserNameReservation('concurrent-agent')).toBeUndefined();
  expect((await store.list()).map(record => record.did)).toEqual([created.id]);
  const bytes = new TextEncoder().encode('concurrent SCIM winner');
  const proof = await authority.provider.signChallenge(created.id, bytes);
  expect(authority.verify(created.id, bytes, proof.signature)).toBe(true);
  expect((await secondRouter.handle(createRequest())).status).toBe(409);
  expect(mintCalls).toBe(1);
});

it('releases a confirmed no-create failure so the same request can retry safely', async () => {
  const authority = signingAuthority({ uniqueDids: true });
  const store = new InMemoryAgentStore();
  const provision = createSdkScimProvisioner(authority.runtime);
  let attempts = 0;
  const router = createScimRouter({ bearerTokens: ['scim-test-only'], store,
    provisionIdentity: async params => {
      if (++attempts === 1) throw new IdentityNotCreatedError('Authority rejected before key creation');
      return provision(params);
    },
  });
  expect((await router.handle(createRequest())).status).toBe(503);
  expect(await store.findUserNameReservation('concurrent-agent')).toBeUndefined();
  expect(authority.issuedDids()).toHaveLength(0);
  expect((await router.handle(createRequest())).status).toBe(201);
  expect(authority.issuedDids()).toHaveLength(1);
});

it('retains an ambiguous authority result until its real identity is reconciled', async () => {
  const authority = signingAuthority({ uniqueDids: true });
  const store = new InMemoryAgentStore();
  const provision = createSdkScimProvisioner(authority.runtime);
  let attempts = 0;
  const router = createScimRouter({ bearerTokens: ['scim-test-only'], store,
    provisionIdentity: async params => {
      const identity = await provision(params);
      if (++attempts === 1) throw new Error('Reply lost after authority committed');
      return identity;
    },
  });
  expect((await router.handle(createRequest())).status).toBe(503);
  expect((await router.handle(createRequest())).status).toBe(409);
  expect(attempts).toBe(1);
  const [orphanDid] = authority.issuedDids();
  const reservation = await store.findUserNameReservation('concurrent-agent');
  expect(reservation).toBeDefined();
  await expect(store.releaseUserName({ ...reservation!, id: 'another-request' })).rejects.toMatchObject({ code: 'CONFLICT' });
  // Operator reconciliation confirms and revokes the previously minted identity
  // before releasing the pending name; blind expiry/retry is never allowed.
  await authority.revoke(orphanDid!);
  await expect(authority.provider.resolve(orphanDid!)).rejects.toThrow('Revoked');
  await store.releaseUserName(reservation!);
  expect((await router.handle(createRequest())).status).toBe(201);
  expect(authority.issuedDids()).toHaveLength(2);
  expect((await store.list())[0]?.did).not.toBe(orphanDid);
});

it('retains a failed storage commit and resumes the same claim without minting again', async () => {
  const authority = signingAuthority({ uniqueDids: true });
  class InterruptedStore extends InMemoryAgentStore {
    pending?: { record: AgentRecord; reservation: UserNameReservation };
    override async create(record: AgentRecord, reservation?: UserNameReservation): Promise<AgentRecord> {
      if (!this.pending && reservation) {
        this.pending = { record, reservation };
        throw new Error('Database unavailable before commit');
      }
      return super.create(record, reservation);
    }
  }
  const store = new InterruptedStore();
  const router = createScimRouter({ bearerTokens: ['scim-test-only'], store,
    provisionIdentity: createSdkScimProvisioner(authority.runtime),
  });
  expect((await router.handle(createRequest())).status).toBe(503);
  expect((await router.handle(createRequest())).status).toBe(409);
  const pending = store.pending!;
  expect(authority.issuedDids()).toEqual([pending.record.did]);
  await expect(store.create({ ...pending.record, did: 'did:oas:test:agent:other' })).rejects.toMatchObject({ code: 'CONFLICT' });
  const recovered = await store.create(pending.record, pending.reservation);
  const retry = await store.create({ ...pending.record, displayName: 'must not overwrite' }, pending.reservation);
  expect(retry).toEqual(recovered);
  await expect(store.create({ ...pending.record, did: 'did:oas:test:agent:other' })).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(store.reserveUserName(pending.record.userName)).rejects.toMatchObject({ code: 'CONFLICT' });
  expect((await store.list()).map(record => record.did)).toEqual(authority.issuedDids());
  expect((await router.handle(createRequest('second-agent'))).status).toBe(201);
  const second = (await store.findByUserName('second-agent'))!;
  await expect(store.update(second.did, { ...second, userName: pending.record.userName })).rejects.toMatchObject({ code: 'CONFLICT' });
  const claimed = await store.reserveUserName('pending-third-agent');
  await expect(store.update(second.did, { ...second, userName: claimed.userName })).rejects.toMatchObject({ code: 'CONFLICT' });
  expect((await store.findByDid(second.did))?.userName).toBe('second-agent');
});
