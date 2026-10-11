# Verify an agent identity

`IdentityVerifier` verifies a signed agent possession proof, its current trust
root, every signed delegation and authoritative revocation status. A root may
be a LifeID person/organization or an explicitly authorized self-rooted agent.
Missing, unavailable or stale authorities fail closed. A decoded JWT or a
request-supplied public key never establishes an authenticated identity.

`VerifiedAgentIdentity` returns `did`, `lineage`, `expiresAt` and one of:

```ts
// LifeID-owned identity
{ owner: { issuer, subject, organizationId? }, root: { kind: 'lifeid', did: rootDid } }
// Self-rooted identity, including signed descendants of this root
{ owner: null, root: { kind: 'self', did: rootDid, authorizationId, revision } }
```

`lineage` starts at the root and ends at the authenticated agent. A direct
self-root has one entry and no delegations; its descendants carry each signed
parent-to-child delegation. Existing owned result objects without a `root`
field remain readable. An ownerless result requires the explicit `self` root.

Self-rooted status imposes no reduced access tier or human-owner requirement.
Services apply their normal operation, tenant and credential authorization to
both modes; identity verification does not manufacture application permissions,
tenants or payment authority. LifeID/WorkOS authenticates humans, Blinds brokers
credentials and Genesis KMS protects customer secrets.

## Configure the authorities

Construct `new IdentityVerifier(authorities)` with these application-owned
adapters. The constructor requires the first four; there is no automatic network
discovery of trust roots and no development bypass.

| Adapter | Required behavior |
| --- | --- |
| `resolveDid(did)` | Return the current authoritative `{did, verificationMethods: [{id, publicKeyJwk, purposes}]}` or `null`. `purposes` is an explicit array of current DID verification relationships. Possession signing requires `authentication`; delegation signing requires `capabilityDelegation`. Preserve the exact DID. Keys and relationship authorizations must come from a trusted OAS resolver/registry, with workload authentication and tenant authorization where needed. Never infer purpose from the presence of a public key, fetch a request-selected `jku`, or accept its `jwk`. |
| `authorizeOwner(rootDid)` | Check the current binding from this owner root to an active real person or organization in LifeID/WorkOS. Return its trusted `{issuer, subject, organizationId?}` or `null`. Do not merely echo claims supplied by the agent. WorkOS membership/organization authority belongs in this adapter, not in the browser or proof payload. |
| `checkRevocation({did, issuerDid?, credentialId?})` | Check both the DID and the particular credential when supplied. Return `{revoked: boolean, checkedAt: number}` only from an authoritative source. Check parent/root status as well as the leaf; missing status is an error. Default maximum age is 60 seconds. |
| `replay.consume({issuer, tokenId, audience, nonce, expiresAt})` | Atomically validate/consume the service-issued, unexpired challenge bound to the correct audience/session and claim the unique issuer/token ID until its expiry. Return `true` once, `false` for invalid/reused challenges or credentials. Use shared durable storage across replicas. Separate read/write operations are insufficient. |
| `resolveDelegations(did, audience)` | Optional for initial proof verification, required by `resolve()`. Return the current signed root-to-agent chain, or `[]` for an authorized direct self-root. The verifier rechecks current root authority and revocation without replaying possession. |
| `authorizeSelfRoot(did, {audience})` | Optional server policy adapter. Return `null` to deny, or a current authoritative `SelfRootAuthorization` bound to this exact DID and audience. Its fields are `did`, `audience`, `authorizationId`, `revision`, `issuedAt`, `notBefore`, `expiresAt`, and `checkedAt`; times are Unix seconds. The policy grant must be active and fresh, with stable nonempty authorization ID/revision. The self-root DID must resolve to an importable public signing key authorized for `authentication`. Its authorization ID is checked for revocation. Never derive approval from a request's root claims. |

The resolver adapter must restrict outbound origins and honor its own trusted
registry contract. A request supplies identifiers and signed evidence, never
registry credentials, public-key trust roots or permission to expand access.

Defaults are a 300-second possession-proof lifetime, 86,400-second delegation
lifetime, 16 delegation links and zero clock tolerance. Limits and a trusted
`now(): number` clock are configurable. Clock tolerance may be at most 60 seconds;
delegation depth may only be reduced from the 16-link maximum. Owner roots must
have OAS kind `hmr`, `mhr`, `ao`, or the readable `enr` organization alias; an
agent root requires the separate self-root authority; an overly broad owner
callback cannot approve it. Failed person/org approval never falls back to
self-root approval.
Expired credentials still fail. Credentials require integer Unix times and cannot
amplify the parent lifetime. Expiry is the shortest credential/root-authority lifetime in the result. A
self-root grant bounds possession and descendant lifetimes, and freshness uses
the same configured maximum age as revocation. Grant withdrawal or a new
revision must invalidate OIDC grants already bound to the previous root policy.

## Proof transport

`verify(proof, {audience, nonce})` accepts
`{token: string, delegations: readonly string[]}`. `delegations` is ordered from
the approved trust root to the leaf agent; a direct self-root uses an empty
array. Each link is a compact signed JWT with:

| Field | Delegation | Possession |
| --- | --- | --- |
| Protected `typ` | `oaid-delegation+jwt` | `oaid-proof+jwt` |
| Protected `alg` | `EdDSA` (Ed25519) or `RS256` | Same |
| Protected `kid` | Exact issuer DID verification-method ID, e.g. `did:oas:openagent:hmr:owner#signing` | Exact agent DID verification-method ID |
| `iss` | Parent/owner DID | Agent DID |
| `sub` | Child agent DID | Same exact agent DID |
| `aud` | Exact configured relying-service audience string | Same; audience arrays are refused |
| `iat`, `nbf`, `exp`, `jti` | All required | All required |
| `nonce`, `kind` | Not possession evidence | Expected service-issued nonce; `kind: "agent"` |

Use real signing keys managed by the authorized key service. Verification accepts
only the public JWK resolved for the exact issuer and `kid`; embedded keys, remote
key references, symmetric algorithms, ambiguous key IDs and private JWKs fail.
The authoritative method must explicitly authorize its signing purpose:
`authentication` for `oaid-proof+jwt` and `capabilityDelegation` for
`oaid-delegation+jwt`. An `assertionMethod` key can sign a credential, but cannot
authenticate an agent or delegate identity solely because its signature is valid.
Missing or mismatched purpose authorization fails closed. Resolver adapters must
map the current DID relationship lists rather than assign every method all purposes.
The JWT transport adapts signed identity evidence to the SDK; it does not define
a replacement DID method or automatically convert existing ACT/VC formats.
Adapters for those formats must verify and bind their evidence explicitly.

`did:oas` follows the repository's shared OAS validation. The existing
`did:l1fe:<kind>:<identifier>` form remains readable. Legacy DIDs and their key IDs
remain exact throughout signature verification, lineage and results; no rewriting
or aliasing creates a second principal. New agent identities use `did:oas`.

`verifyLineage(did, delegations, {audience})` checks current cryptographic lineage,
root authority and revocation, but **does not prove the subject's possession**.
Use it after independently verifying a signed OATS attestation/VC or other evidence.
`resolve(did, {audience})` uses the configured authoritative signed-lineage source
for the same current checks. Neither method consumes an old possession nonce.

## Host a verification endpoint

`createIdentityVerificationHandler(verifier, {audience, resolveNonce, maxBodyBytes?})`
returns a framework-independent `(request: Request) => Promise<Response>` handler.
Mount it at the service's chosen HTTPS POST endpoint. `resolveNonce(request)` must
look up and validate the challenge issued by that service, including audience,
session/tenant binding and expiry. It must not simply echo the
`X-OpenAgent-Nonce` request header. `replay.consume` completes the atomic claim.

Requests use `Content-Type: application/json` and contain only `{proof}`. Audience,
root authority, keys, policy and revocation configuration come from the server.
Default request size is 128 KiB. Responses use `Cache-Control: no-store`:

| Status | Meaning |
| --- | --- |
| 200 | `{identity: VerifiedAgentIdentity}` after all checks pass |
| 400 / 413 / 415 | Malformed, oversized or unsupported request |
| 401 | Invalid signature/claims, untrusted owner, revocation or replay |
| 503 | Owner/resolver/revocation/replay/challenge authority unavailable |

`verifyIdentityRemote(endpoint, proof, {nonce, fetch?, signal?, timeoutMs?})` calls
that configured trusted endpoint and validates its result shape and current expiry.
The returned DID must match the submitted possession proof, its expiry cannot
exceed that proof's expiry, and the proof must contain the issued nonce. Local
decoding performs correlation only; the remote authority verifies signatures.
It requires HTTPS, sends no ambient cookies, refuses redirects, bounds response
size and times out after 10 seconds by default. An HTTPS verdict establishes trust
in that configured verification service; it is not a separate portable signed
attestation. Services requiring portable evidence should use verified signed tokens.

The package supplies the handler and client. It does not claim that a Genesis,
LifeID or public verification endpoint is deployed or configured. A hosting service
must supply real authorities and verify the actual tenant and revocation flow before
calling the integration live.
