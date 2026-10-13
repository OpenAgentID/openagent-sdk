# @openagentid/scim

SCIM 2.0 provisioning for OpenAgentID SDK `^0.7.2`.

```sh
npm install @openagentid/scim@0.2.0 @openagentid/sdk@^0.7.2
```

## Wire an actual identity authority

`createSdkScimProvisioner(runtime)` adapts your current `OpenAgentRuntime` and
its configured identity provider. The provider must create real signing keys,
authorize the parent, retain custody and return its actual public identity.
The bridge never fabricates a DID or a pending-key fingerprint.

```ts
import { createScimRouter, createSdkScimProvisioner } from '@openagentid/scim';
// runtime, durableStore and authorities are your configured application services.
const scim = createScimRouter({
  bearerTokens: [process.env.SCIM_TOKEN!],
  baseUrl: 'https://scim.example.com/scim/v2',
  store: durableStore,
  provisionIdentity: createSdkScimProvisioner(runtime),
  updateIdentityScopes: authorities.updateScopes,
  revokeDidDocument: authorities.revokeDid,
  cascadeRevokeDelegations: authorities.revokeDelegations,
  invalidateArsenalSessions: authorities.invalidateSessions,
});
// Route standard Web Requests to await scim.handle(request).
```

These callbacks are explicit authority boundaries. The bridge cannot infer your
credential/session stores from an SDK instance. Supply durable, idempotent
operations, including an authoritative confirmation when a service has no issued
delegations or sessions. `InMemoryAgentStore` is for local demonstrations and tests;
production must configure a durable store. A parent/scopes field in SCIM is not a
signed delegation proof.

`AgentStore.reserveUserName` must atomically claim a name across every instance
of your service before identity creation starts. `create(record, reservation)`
must atomically enforce DID/name uniqueness, insert the record and consume that
exact reservation. Retrying a completed reservation returns the existing record
without overwriting it. `update` must also enforce name uniqueness, including
pending reservations. Use database constraints/transactions in a durable store;
the supplied memory implementation only coordinates routers in one process.

Concurrent or repeated POSTs for an existing/pending username return 409 without
creating another identity. The SDK does not expose an idempotency key for identity
creation, so an uncertain authority failure retains the reservation. Never expire
it automatically: inspect `findUserNameReservation`, reconcile the authority's
result, and commit that same record/reservation or revoke the orphan before
calling `releaseUserName`. Only a provider that confirms no identity was created
may throw `IdentityNotCreatedError`; the bridge then releases the claim and a
subsequent POST can retry. Do not use that error for timeouts or lost responses.
Keep the authority's durable creation audit so interrupted operations can be
reconciled; a username reservation alone is not an identity transaction.

Creation fails closed without an identity provisioner. Scope changes require an
authority updater before the SCIM representation changes. `active: false` and
DELETE first mark the record inactive, then attempt DID, delegation and session
revocation. Any incomplete step returns 503 and retains the inactive record for
retry. Only a completed cascade deletes it. Revoked identities cannot be
reactivated, and changing a parent requires provisioning a new identity.

Bearer tokens are required. Explicit `allowUnauthenticated: true` is restricted
to isolated local development; it is never a default. Protect the SCIM transport
with TLS and apply your tenant boundary before constructing its store/authorities.

## Migration from 0.1

The insecure built-in DID/fingerprint placeholder and best-effort successful
DELETE fallback have been removed. Configure real authority callbacks before
accepting provisioning traffic. If revocation is unavailable, keep the inactive
record and retry instead of treating 204 as evidence of a completed cascade.
Custom stores must implement the atomic reservation/commit contract above; the
previous lookup-then-insert interface allowed duplicate principals under load.

The package's integration suite provisions through the current SDK using actual
Ed25519 keys, verifies possession and tamper rejection, then verifies revocation
before SCIM deletion. Concurrent routers, distinct authority-generated DIDs,
failed/ambiguous creation and commit recovery exercise the same store contract.
`npm run typecheck`, `npm test`, and `npm run build` run the
same package checks used by the release qualification.
