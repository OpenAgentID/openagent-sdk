# TypeScript API reference

This is a map of the current SDK 0.7.2 surfaces. The linked source declarations
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
and state types. The closed catalog has 17 families, 62 kinds and 18 expressions.
`CharacterAppearance` stores skin/version, eye style, shape, finish, eye placement
and accessories. `view` belongs to render/player options, not that stored type.

`@openagentid/sdk/browser` is self-contained browser ESM. It exports
`mountCharacter(element, did, options?)` and catalogs. The returned player has
`update`, `setAppearance`, `setReducedMotion`, `getState` and `dispose`.
`@openagentid/sdk/character-player` also exposes the player as a module, while
`@openagentid/sdk/character-animation` supplies DOM-free sampled geometry.

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

The facade does not expose the former guide's proposed `authenticateHandshake`,
global `revoke`, `audit`, `healthCheck`, `refresh` or `startAutoRefresh` methods.
Use actual exported contracts rather than those historical example shapes.
Current per-instance methods and credential handles are declared in source.

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
