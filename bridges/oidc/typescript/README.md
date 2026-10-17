# @openagentid/oidc

OpenAgentID's self-hosted agent OpenID Connect provider, with the branded
**Continue as Agent** button for browsers and an optional LifeID human-identity
federation bridge. Version 0.3.0 uses the maintained `oidc-provider`
implementation for registered OIDC relying parties: discovery, public JWKS,
authorization code, PKCE S256, client authentication, signed ID tokens, and
UserInfo. OpenAgentID is free and open software in the
Open Software family. Life can operate hosted services
around the same open contracts; nothing here depends on them.

```sh
npm install @openagentid/oidc@0.3.0
```

The browser button additionally needs the SDK's live-eye player:

```sh
npm install @openagentid/sdk@0.7.2
```

Node 20.19+ is required. ESM and CommonJS entry points are supplied; provider
creation is asynchronous because the underlying provider is ESM.

## Configure a standalone provider

A self-hosted deployment authenticates self-rooted agents with its own issuer,
signing keys, durable storage and admission policy. It needs no OpenAgentID or
Life hosted service and no LifeID configuration:

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
  allowSelfRooted: true,
  verifyAgent: (proof, context) => identityVerifier.verify(proof, context),
  resolveIdentity: (did) => identityVerifier.resolve(did, { audience: issuer }),
});
```

`allowSelfRooted: true` only enables the mode; the deployment's identity
verifier still has to approve each self root through its own authoritative
policy, as described under [Explicit self-rooted identities](#explicit-self-rooted-identities).
With `lifeId` and `requireLifeId` omitted no federation object is constructed
and no LifeID JWKS is ever fetched. A `lifeIdToken` submitted to such a server
is refused rather than ignored. The test suite covers this exact configuration
end to end with real keys and HTTP. Owned, human-rooted agents are an optional
addition; see [Optional LifeID federation](#optional-lifeid-federation-for-owned-agents).

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
  proof: { token: agentPossessionJwt, delegations: signedAgentDelegations },
  consent: true,
});
```

For a self root, `signedAgentDelegations` is empty; descendants supply their
signed root-first agent chain. Owned agents additionally pass a `lifeIdToken`,
described under optional federation below.

The mandatory server `verifyAgent` callback must cryptographically verify key
possession, every signed delegation, the authoritative root or owner,
revocation and atomic proof replay prevention. Its structural contract matches
`@openagentid/sdk`'s `IdentityVerifier`: it accepts `{ token, delegations }` and
`{ audience, nonce }`, and returns `{ did, owner, root, lineage, expiresAt }` or throws.
Self-rooted identities have `owner: null` and a `root` of kind `self`. Every
lineage is root-first, has at most 17 distinct valid DIDs of at most 512
characters, and ends at the authenticated agent DID. New identities use
`did:oas`; existing `did:l1fe` identifiers remain literal when verifying
signatures. A decoded JWT subject is never itself proof of agent identity.

`resolveIdentity` must retrieve the current signed chain through authoritative
sources and recheck current root authority and every revocation. It is invoked
during login, code redemption, and UserInfo. Each grant persists its original
verified root, owner and expiry. Root mode/DID, self authorization ID/revision,
or LifeID owner changes and missing/expired bindings invalidate the grant.
Access-token and ID-token lifetimes cannot outlive that verified identity.
Providers cannot substitute a stale cached successful possession result for
this status check.

Only the identity scopes `openid` and `profile` are granted. This adapter does
not issue inference, billing or other application capabilities from OIDC login.
Register the provider issuer/client in each RP or LifeID federation policy; no
library can authenticate to an RP that has not trusted its issuer.

## Explicit self-rooted identities

Self-rooted OIDC authentication is disabled unless the deployment sets
`allowSelfRooted: true`, as the standalone configuration above does. It must also configure its identity verifier's authoritative
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

Self interactions are completed exactly as shown above and omit `lifeIdToken`;
the provider rejects attempts to attach a human owner assertion. On a provider
that also federates LifeID, `requireLifeId` continues to protect owned
interactions without fabricating a human owner for self identities.

Signed ID tokens and UserInfo publish `owner: null` and the explicit self `root`,
including `authorizationId` and `revision`, so RPs can apply their own identity
policy. Owned tokens likewise publish the explicit LifeID root and their owner.
These claims grant no application permission, organization membership, billing
account or tenant. RPs must explicitly decide whether they accept self-rooted
identities; a policy revision, authorization, root or mode change invalidates
existing OIDC grants.

## Optional LifeID federation for owned agents

Agents owned by a human or organization identity are an optional addition on
the same provider. Configure the LifeID federation and, to require owner
authentication for every owned interaction, `requireLifeId`:

```ts
const oidc = await createAgentOidcProvider({
  // ...the standalone configuration above...
  lifeId: {
    issuer: 'https://auth.life.one',
    audience: registeredLifeIdFederationClient,
    jwksUri: 'https://auth.life.one/.well-known/jwks.json',
  },
  requireLifeId: true,
});
```

Owned interactions then pass the validated owner session token:

```ts
await oidc.completeInteraction(req, res, {
  proof: { token: agentPossessionJwt, delegations: signedOwnerDelegations },
  consent: true,
  lifeIdToken: validatedOwnerSessionIdToken,
});
```

Owned identities have `owner: { issuer, subject, organizationId? }` and
`root: { kind: 'lifeid', did: ownerRootDid }`. Historical owned callback results
may omit `root`; the provider derives the explicit LifeID root from the validated
first lineage DID. Owned lineages start at an HMR/MHR/AO/ENR person or organization
root and contain at least two DIDs.

LifeID federation verifies the human JWT signature against the configured public
JWKS and validates its exact issuer, federation audience, expiry and issued-at.
The verified subject and organization must exactly match the agent's proven
owner. `organization_id`, `org_id` and legacy `oid` are supported; conflicting
aliases are refused. Agent assertions and DID-shaped human subjects are
refused. `requireLifeId` enforces owner authentication for each owned interaction;
it does not change or deploy LifeID/WorkOS configuration. Hosted Life services
must preserve Blinds credential brokering, Genesis KMS customer-secret custody
and their existing tenant authorization boundaries. Any LifeID issuer is a
deployment choice; the library never contacts one unless configured.

## Continue as Agent button

`@openagentid/oidc/button` is a framework-neutral, browser-only entry that
renders the canonical OpenAgentID sign-in control: one silhouette, one
typography scale, the exact label **Continue as Agent** and a dark 32px window
holding only a pair of bright eyes, like an agent in the dark whose face you
never see. There is no logo or trailing icon; the eyes and the label are the
brand. The eyes are the real
`@openagentid/sdk` live-eye player; the character body is never shown. They
glance around the window, tilt, squint, blink and pause, look at the viewer on
hover or focus, think while `onContinue` runs and react to success or failure.
Randomness lives only in their timing; the button chrome never changes. It is
separate from the Node provider entry, so a browser bundle never pulls in
`oidc-provider`.

```ts
import { mountContinueAsAgent } from '@openagentid/oidc/button';
import '@openagentid/oidc/button.css';

const handle = mountContinueAsAgent(document.querySelector('#sign-in'), {
  onContinue() {
    // Your existing server-side start route creates state, nonce and PKCE,
    // sets the transaction cookie and redirects to your issuer's /authorize.
    window.location.assign('/oauth/start');
  },
});
```

`onContinue` is required and is the only thing the button does. It receives
`{ button }` and nothing else: no issuer, redirect, state, nonce or identity is
invented here, and the decorative character is deliberately not passed to the
callback so a generated seed can never reach an authorization request. The
`/oauth/start` path above is the host's own route, shown as an example.

Return a promise from `onContinue` for an asynchronous start (for example a
`fetch` that returns the authorize URL). While it is pending the button sets
`aria-busy`, ignores further clicks, keeps its exact label and dimensions, and
shows the eyes thinking; nothing is added or resized. A rejection restores the button, announces an
accessible status message (`errorMessage` to customize) and calls `onError`.
`dispose()` removes everything and is safe at any time, including mid-request.

Options: `appearance.did` to time the eyes from an agent the host has already
chosen; doing so does not claim it is authenticated. `theme` (`auto`, `light`,
`dark`), `size` (`medium`, `large`), `fullWidth`, `disabled` and
`errorMessage`. Without `appearance.did` each mounted button draws one random
decorative seed that stays fixed for the life of the mount and is readable from
`handle.appearance` for display only. Idle glances stop under the operating
system's reduced-motion preference, in hidden tabs and on dispose; reduced
motion shows still eyes through the SDK player. The stylesheet is static;
custom properties on `.oaid-continue` adjust colors, and `forced-colors` mode
keeps a visible focus outline.

React hosts mount it in an effect; there is no React dependency:

```tsx
function ContinueAsAgent() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handle = mountContinueAsAgent(ref.current!, { onContinue: () => { window.location.assign('/oauth/start'); } });
    return () => handle.dispose();
  }, []);
  return <div ref={ref} />;
}
```

`examples/continue-as-agent` is a self-contained review page with several
mounted buttons, light/dark, sizes and the disabled, loading, error and
host-selected states; its callbacks are labeled demos that start nothing.

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
UserInfo, plus the standalone no-LifeID server. `tools/public-onboarding/verify-button.mjs`
installs the packed `@openagentid/sdk` and `@openagentid/oidc` archives into a
clean consumer and drives the review page in real Chromium: exact accessible
name, one silhouette across variants, eyes-only rendering with the body never
painted, live glances, tilts and squints at 32px, still eyes under reduced
motion, keyboard activation and focus (including forced colors), duplicate
clicks while pending, rejection recovery, disposal mid-request and browser/Node
entry separation. It asserts the consumer resolved the source SDK version, or
`OAID_EXPECTED_SDK_VERSION` when a registry run installs the supported minimum
published SDK instead. Run typechecking, tests, and both package formats in
the approved remote build environment before release.

## License

Apache-2.0 OR MIT. [Source](https://github.com/OpenAgentID/openagent-sdk).
