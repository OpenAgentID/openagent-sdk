# @openagentid/oidc

OpenAgentID's agent OpenID Connect provider and human-identity federation bridge.
Version 0.2.0 uses the maintained `oidc-provider` implementation for registered
OIDC relying parties: discovery, public JWKS, authorization code, PKCE S256,
client authentication, signed ID tokens, and UserInfo. OpenAgentID is free and
open software in the [Open Software](https://open.software) family. Life can
operate hosted services around the same open contracts.

```sh
npm install @openagentid/oidc@0.2.0
```

Node 20.19+ is required. ESM and CommonJS entry points are supplied; provider
creation is asynchronous because the underlying provider is ESM.

## Configure the provider

```ts
import { createAgentOidcProvider } from '@openagentid/oidc';

const issuer = 'https://identity.example.com';
const oidc = await createAgentOidcProvider({
  issuer,
  clients: [{
    client_id: 'registered-application',
    redirect_uris: ['https://application.example.com/callback'],
    token_endpoint_auth_method: 'none',
  }],
  jwks: privateSigningJwks,
  cookieKeys: rotatingCookieSigningKeys,
  adapter: PersistentProviderAdapter,
  persistent: true,
  verifyAgent: (proof, context) => identityVerifier.verify(proof, context),
  resolveIdentity: (did) => identityVerifier.resolve(did, { audience: issuer }),
  lifeId: {
    issuer: 'https://auth.life.one',
    audience: registeredLifeIdFederationClient,
    jwksUri: 'https://auth.life.one/.well-known/jwks.json',
  },
  requireLifeId: true,
  allowSelfRooted: false,
});
```

The deployment supplies protected RSA/RS256 or Ed25519/EdDSA private JWKs with
unique `kid` values. Public JWKS never includes private key material. RS256 is
the ordinary RP default; an Ed25519-only deployment must register its clients
with `id_token_signed_response_alg: 'EdDSA'`. Neither ephemeral default keys nor
unsigned ID tokens are permitted. Each cookie signing key must be at least 32
bytes. Enable `trustProxy` only behind a trusted TLS terminator that sanitizes
forwarding headers. Production issuers and web redirect URIs require HTTPS.
Native app redirects follow the underlying provider's URI policy; executable
browser schemes are refused.

`PersistentProviderAdapter` implements the upstream
[storage adapter contract](https://github.com/panva/node-oidc-provider/blob/main/example/my_adapter.js).
It must persist every provider model plus the `AgentGrantIdentity` model, retain
arbitrary JSON payload fields, expire records, and implement atomic token
consumption and grant revocation. `persistent: true` is the deployment's explicit
assertion that this adapter uses durable shared storage. The library cannot
infer a database's durability from a JavaScript constructor. An unavailable
identity authority or storage service denies authentication. Explicit test mode
is accepted only with `NODE_ENV=test` and a loopback issuer; it cannot start a
production deployment.

## Complete a verified interaction

Mount `oidc.callback()` on a Node/Express/Koa HTTP server. The provider exposes:

- `/.well-known/openid-configuration`
- `/jwks`
- `/authorize`
- `/token`
- `/userinfo`

The host must implement `/interaction/:uid`. There is no development login
screen or route accepting an arbitrary `accountId`.

Call `oidc.interaction(req, res)` to obtain the registered `clientId`, requested
scopes, and an interaction-specific `{ audience, nonce }` challenge. Ask the
agent to approve that application and its identity claims, and obtain an agent
possession proof for that exact challenge. On the same signed-cookie interaction,
call:

```ts
await oidc.completeInteraction(req, res, {
  proof: { token: agentPossessionJwt, delegations: signedOwnerDelegations },
  consent: true,
  lifeIdToken: validatedOwnerSessionIdToken,
});
```

The mandatory server `verifyAgent` callback must cryptographically verify key
possession, every signed owner delegation, authoritative owner identity,
revocation and atomic proof replay prevention. Its structural contract matches
`@openagentid/sdk`'s `IdentityVerifier`: it accepts `{ token, delegations }` and
`{ audience, nonce }`, and returns `{ did, owner, root, lineage, expiresAt }` or throws.
Owned identities have `owner: { issuer, subject, organizationId? }` and
`root: { kind: 'lifeid', did: ownerRootDid }`. Historical owned callback results
may omit `root`; the provider derives the explicit LifeID root from the validated
first lineage DID. Owned lineages start at an HMR/MHR/AO/ENR person or organization
root and contain at least two DIDs. Every lineage is root-first, has at most 17
distinct valid DIDs of at most 512 characters, and ends at the authenticated
agent DID. New identities use `did:oas`; existing `did:l1fe` identifiers
remain literal when verifying signatures. A decoded JWT subject is never itself
proof of agent identity.

`resolveIdentity` must retrieve the current signed chain through authoritative
sources and recheck current root authority and every revocation. It is invoked
during login, code redemption, and UserInfo. Each grant persists its original
verified root, owner and expiry. Root mode/DID, self authorization ID/revision,
or LifeID owner changes and missing/expired bindings invalidate the grant.
Access-token and ID-token lifetimes cannot outlive that verified identity.
Providers cannot substitute a stale cached successful possession result for
this status check.

LifeID federation verifies the human JWT signature against the configured public
JWKS and validates its exact issuer, federation audience, expiry and issued-at.
The verified subject and organization must exactly match the agent's proven
owner. `organization_id`, `org_id` and legacy `oid` are supported; conflicting
aliases are refused. Agent assertions and DID-shaped human subjects are
refused. `requireLifeId` enforces owner authentication for each owned interaction;
it does not change or deploy LifeID/WorkOS configuration. Hosted Life services
must preserve Blinds credential brokering, Genesis KMS customer-secret custody
and their existing tenant authorization boundaries.

Only the identity scopes `openid` and `profile` are granted. This adapter does
not issue inference, billing or other application capabilities from OIDC login.
Register the provider issuer/client in each RP or LifeID federation policy; no
library can authenticate to an RP that has not trusted its issuer.

## Explicit self-rooted identities

Self-rooted OIDC authentication is disabled by default. A deployment must set
`allowSelfRooted: true` and configure its identity verifier's authoritative
`authorizeSelfRoot(did, { audience })` policy. The server must approve a current,
bounded grant for the exact agent root and audience. Caller-provided unsigned
root fields, a valid possession signature alone, and the OIDC opt-in flag cannot
create that approval. `resolveIdentity` must recheck this policy and revocation
at every identity lookup; policy withdrawal or an unavailable authority denies
the login, code redemption or UserInfo request.

The verified self identity has `owner: null` and this required root:

```ts
{
  kind: 'self',
  did: selfRootDid,
  authorizationId: currentServerAuthorizationId,
  revision: currentServerPolicyRevision,
}
```

Its lineage starts at that agent root, with one DID for the root itself or a
signed delegation chain ending at a descendant agent. All signatures, method
purposes, challenge/replay checks and authoritative revocations still apply.
The SDK verifier caps the identity lifetime by the current self-root grant and
every signed credential. The OIDC provider additionally caps tokens by the
identity's remaining lifetime and keeps the original grant binding.

After enabling this mode in the provider configuration, complete a self-rooted
interaction using the exact issued challenge and explicit consent:

```ts
await oidc.completeInteraction(req, res, {
  proof: { token: agentPossessionJwt, delegations: signedAgentDelegations },
  consent: true,
});
```

For the self root, `signedAgentDelegations` is empty. Descendants supply their
signed root-first agent chain. Self interactions omit `lifeIdToken`; the provider
rejects attempts to attach a human owner assertion. `requireLifeId` continues to
protect owned interactions on the same provider without fabricating a human
owner for self identities.

Signed ID tokens and UserInfo publish `owner: null` and the explicit self `root`,
including `authorizationId` and `revision`, so RPs can apply their own identity
policy. Owned tokens likewise publish the explicit LifeID root and their owner.
These claims grant no application permission, organization membership, billing
account or tenant. RPs must explicitly decide whether they accept self-rooted
identities; a policy revision, authorization, root or mode change invalidates
existing OIDC grants.

## Migrate the legacy bridge from 0.1.x

`OidcBridge`, its JWT/JWKS helpers, and ACT wrapping remain available. Production
paths that previously emitted unsigned token text or fabricated identities now
fail closed. Supply real authoring/custody and broker hooks:

```ts
const bridge = new OidcBridge({ issuer: humanIssuer, audience: humanClientId }, {
  deriveAgent: deriveOwnerAuthorizedOasIdentity,
  mintCapability: authorizeAndMintBrokerCapability,
});
```

`deriveAgentFromClaims(namespace, claims, name, derive)` also requires an
explicit real derivation callback. It validates matching Ed25519 public/private
key material and requires owner lineage; the host's custody implementation owns
signed lineage verification. This legacy human-to-agent derivation flow remains
owned; self-rooted authentication uses the verified provider interaction above.
A real broker mint hook must authorize requested
scopes and return `{ actB64, scopes, expiresIn }`. ACT requests return that signed
ACT; JWT requests additionally require an explicit signing key and audience and
are correctly labeled as JWTs. Human JWT validation now requires a configured
audience plus `iss`, `sub`, `aud`, `exp` and `iat`, and accepts only RS256/EdDSA.
There is no unsigned-token, dummy-key or timestamp-based random fallback.

## Verification

The test suite generates real RSA and Ed25519 keypairs, runs actual local HTTP
issuer and RP servers, fetches JWKS, redeems authorization codes and verifies ID
token signatures. It covers PKCE rejection, code replay, wrong agent audience,
wrong human owner/audience, forged and expired human tokens, owner change,
revocation before redemption and after token issuance, and unsafe deployment
configuration. Self-rooted cases use real RSA-signed current policy records,
Ed25519 possession/delegation signatures and Ed25519 OIDC issuer signing keys;
they cover root/descendant and legacy flows, default denial, policy withdrawal,
revocation and root/mode/authorization/revision changes before redemption and
UserInfo. Run typechecking, tests, and both package formats in the approved
remote build environment before release.

## License

Apache-2.0 OR MIT. [Source](https://github.com/OpenAgentID/openagent-sdk).
