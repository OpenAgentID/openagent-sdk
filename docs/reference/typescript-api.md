# TypeScript API reference

This is a map of the current SDK 0.8.0 surfaces. The linked source declarations
are authoritative for exact types and exports; the public
[developer-tooling guide](../developer-tooling.md) supplies the complete first
integration. The separate OIDC package remains version 0.2.0.

## Node local authority

Import `OpenAgentWorkspace` from `@openagentid/sdk/local`. This is Node-only,
single-host filesystem custody and receiver-controlled trust.

| Method | Actual contract |
| --- | --- |
| `initialize(directory, { audience, namespace? })` | Initialize an absent private workspace; refuse existing or invalid state. |
| `open(directory)` | Open valid existing state without resetting, repairing or stealing a lock. |
| `createAgent(name)` | Generate a real Ed25519 signer and approve it at this workspace. |
| `listAgents()` | Return registration metadata, not private keys. |
| `exportIdentity(did)` | Return a public `LocalAgentDocument`. |
| `trustIdentity(document)` | Explicitly pin a public identity at this receiver; reimport does not undo revocation. |
| `issueChallenge(did)` | Persist a fresh DID/audience-bound `LocalChallenge`. |
| `prove(did, { nonce, audience })` | Sign an `AgentIdentityProof` with the local private signer. |
| `verify(proof, { nonce })` | Verify current local trust and durably consume the issued challenge/proof ID. |
| `revoke(did)` | Persist withdrawal of this receiver's trust. |
| `inspect()` | Return audience, namespace and registration counts. |

Times use Unix seconds. The local challenge/proof window is 60 seconds. The
public document and possession proof do not grant trust to another receiver.
See [local source](../../sdks/typescript/src/local-workspace.ts).

## Portable identity verification

`IdentityVerifier`, `AgentIdentityProof`, `VerifiedAgentIdentity` and configuration
types are root exports. Configure authoritative resolution, root approval,
revocation and atomic replay. `verify` proves possession; `verifyLineage` and
`resolve` establish current chain/root trust without a new possession proof.

`VerifiedAgentIdentity` carries `did`, root-first `lineage`, Unix-second `expiresAt`
and an explicit owned/self root result. Owned results bind a real person/org;
self roots require a current authoritative grant and have `owner: null`.

`createIdentityVerificationHandler` and `verifyIdentityRemote` supply Fetch
transport around that authority. See the [normative verification contract](../identity-verification.md),
[verifier source](../../sdks/typescript/src/identity-verification.ts) and
[HTTP source](../../sdks/typescript/src/verification-api.ts).

## Presentation and browser state

`@openagentid/sdk/characters` exports `generateCharacter`, `renderCharacterSvg`,
`getCharacterSkins`, `getCharacterExpressions`, `getCharacterStatuses`, appearance
and state types. The closed catalog has 18 families, 77 kinds and 18 expressions.
`CharacterAppearance` stores skin/version, eye style, shape, colour (the One
family only), finish, eye placement and accessories. `view`, `theme` and `label` belong to render/player options, not
that stored type. Each catalog family lists its eye styles (`live-v1`, or
`agent-eye-v1` for One). For the One family it also exports `getOneShapes`,
`getOneColors`, `ONE_SHAPE_ORDER`, `ONE_DIGITAL`, `isOneShape`, `isOneColor`,
`isOneKind`, `isOneColorAllowed`, `oneShapeForDid`, `oneColorForDid`,
`oneLookForDid` and `nextOneLook` with the `OneShape`, `OneColor`, `OneKind`,
`OneLook`, `OneLookHolder`, `OneShapeDescription` and `OneColorDescription`
types.

`@openagentid/sdk/browser` is self-contained browser ESM. It exports
`mountCharacter(element, did, options?)` and catalogs. The returned player has
`update`, `setAppearance`, `setReducedMotion`, `getState` and `dispose`; One heads
also take `cadence`, `group`, `voiceLevel` and `follow`. The browser entry re-exports
the One colour helpers. `@openagentid/sdk/one` is the One family alone: `renderOne`,
`mountOne` and the palette helpers; `@openagentid/sdk/browser/one` is its live
runtime, self-contained, within a 16 KB gzipped budget. `@openagentid/sdk/character-player` also exposes the player as a
module, while `@openagentid/sdk/character-animation` supplies DOM-free sampled
geometry, including `frame.one` for One heads.

Root/`glyph` exports include `oasGlyph`, `glyphEndpoint`, `agentAvatar` and
`isAgentAvatarDid`. Display parsing establishes no authentication or permission.
See [characters](../characters.md), [Glyph](../glyph.md) and
[player source](../../sdks/typescript/src/character-player.ts).

## OATS and OIDC

Root exports include `VerifiedOatsScorer` and `createOatsEvidenceVerifier`.
They require verified attestation evidence, explicit trusted issuers and current
identity/credential authority. See [OATS](../oats.md).

The separate `@openagentid/oidc@0.2.0` exports `createAgentOidcProvider` and its
configuration/identity contracts. See the [provider reference](../../bridges/oidc/typescript/README.md).
The SDK's `oaid oidc doctor` is diagnosis, not an OIDC login client.

## Published component adapters

Import the adapter from its component entry point: `@openagentid/sdk/integrations/oas`,
`/integrations/arsenal`, `/integrations/aegis` or `/integrations/skills-policy`.
Each entry references only that component's optional peer types. Core SDK
consumers need none of them. The aggregate `/integrations` entry remains available
for applications with all four component packages installed.

| Export | Actual contract |
| --- | --- |
| `createOasIdentityProvider({ oas, store, authorizeCreation, audience })` | Adapt published OAS 1.0.2 to the `IdentityProvider` facade. Returns `OasIdentityProvider`, including explicit `signBytes(did, payload)`. |
| `OasIdentityStore` | Current `get`/`resolve` plus atomic duplicate-refusing `put`; application owns signer custody and persistence. |
| `createArsenalCapabilityFetch({ client, capability, binding, authorizeBinding, allowedOrigins, maxRequestBytes?, timeoutMs? })` | Return a Fetch-compatible function using actual Arsenal 0.1.1 broker transport, bound capability/tenant/DID and destination policy. Responses are buffered by the broker protocol. |
| `ArsenalIdentityBinding` | Explicit receiver-owned `did`, `agentId`, `tenantId`, `audience` relationship. |
| `createAegisRequestAuthenticator({ client, readCredential, authorizeSession })` | Return `(request, requirements?) => Promise<AuthContext>` after actual AEGIS 0.1.1 credential authentication and receiver-owned authorization. |
| `createSkillsPolicyInvoker({ policy, agentDid, context })` | Return `invoke(skill, args, run)` with `{ result, receipt }`; actual contextual policy authorizes and records before execution. |

Complete runnable examples: [OAS descendants](../../examples/typescript/04-delegated-agent/README.md),
[skills governance](../../examples/typescript/05-skills-governance/README.md),
[Arsenal capability proxy](../../examples/typescript/06-credential-proxy/README.md).
[Integration notes](../../sdks/typescript/INTEGRATION_NOTES.md) document trust,
transport and custody contracts. No identity lookup is substituted for request
possession, and no capability scope is inferred from a DID string.

## HTTP authentication adapter

`@openagentid/http@0.2.0` exports `HttpAuthClient`,
`createOpenAgentHandler`, `createOpenAgentMiddleware`, and
`createSdkIdentityKeyResolver`. `@openagentid/http/node` exports
`verifyNodeSignature` for real Ed25519/secp256k1 verification. The SDK bridge
uses Ed25519, the algorithm supported by both identity protocols.

Servers configure a canonical HTTP `origin`, actual signature verifier and
authoritative DID/key resolver. `serverDid` is an optional separate discovery
field. Proofs carry a DID, and `SessionStore.take` must atomically consume
challenges across workers. Express middleware follows `express.json()`, preserves
application bodies/queries and exposes the authenticated `req.openAgent`.
Session requests recheck current authority so rotation/revocation closes access.
See the [complete working HTTP example](../../adapters/http/typescript/README.md).

## ACT and raw cryptography

`setActCryptoBinding` accepts the actual initialized WASM binding. Fluent
`act.verify(bytes)` requires issuer, audience and trusted keys before `run()`.
SDK 0.7.3 passes fresh receiver Unix time on every verification, including
`withAct` and `requireActExpress`. `atTime(seconds)` is an explicit fixed-time
override for tests/decision replay; it is not a startup-time production clock.
Claims retain the [canonical wire contract](wire-formats.md).

## Configured provider facade

Root exports `OpenAgent`, `OpenAgentRuntime`, `OpenAgentInstance`, `IdentityProvider`,
`ArsenalClient`, `VerificationClient`, `AuthContext` and configuration types.
These operations require supplied concrete clients:

| Surface | Contract |
| --- | --- |
| `OpenAgent.configure(config)` | Replace the singleton runtime with explicitly configured clients. |
| `runtime.createAgent(input)` | Validate `CreateAgentInput`, call the configured identity provider and return an `OpenAgentInstance`. |
| `runtime.loadAgent(did, skills?)` | Resolve through the configured identity provider. |
| `runtime.authenticate(request, options?)` | Call the configured verification client with a WHATWG `Request`. |
| `instance.credentialsFor(provider)` | Obtain a handle from the configured credential client. |

`CreateAgentInput` requires `parent`, `name` and a nonempty `scopes` array; optional
fields are `namespace`, `skills` and `metadata`. This provider-facade parent input
does not prohibit self-root identities through the local/general verifier paths.
Creation does not implicitly issue an ACT or start a worker. Endpoint strings
do not instantiate these clients. See [facade source](../../sdks/typescript/src/agent.ts)
and [configuration](../../sdks/typescript/src/config.ts).

Use the explicit adapters above for published component packages. The proxy-URL
credential facade is a distinct application-supplied contract; it is not the
class exported by the Arsenal package. Current per-instance methods and
credential handles are declared in source.

`PrivilegedAuthorityVerifier`, `PrivilegedAuthorityVerificationClient` and
`LineageAuthorityContext` are genuine optional authority hooks with legacy anchor
metadata. ACT/key helpers have explicit crypto-binding initialization. See
[authority boundary](../architecture/lineage-finality.md) and
[crypto integrations](../architecture/why-wasm-crypto.md).

## CLI and diagnostics

The `oaid` binary is included in the installed SDK. Local commands, HTTPS
verification, OIDC diagnosis and avatar/Glyph rendering are listed by
`npx --no-install oaid --help`. See the
[exact CLI sequence](../developer-tooling.md#use-the-cli-with-an-existing-application)
and [CLI source](../../sdks/typescript/src/cli.ts). Commands return JSON/SVG and
nonzero exit codes on failure; `doctor` reports workspace metadata, not a remote
acceptance verdict.
