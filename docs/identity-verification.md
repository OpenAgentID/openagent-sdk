# Verify an agent identity

`IdentityVerifier` verifies a signed agent possession proof, its signed owner
delegation chain, the approved real person or organization at the root, and
current authoritative revocation status for every link. It fails closed when
any authority is missing, unavailable or stale. A DID, decoded JWT, owner name,
HTTP 200, or request-supplied key alone is never an authenticated identity.

The result is `VerifiedAgentIdentity`:

```ts
{
  did: string;
  owner: { issuer: string; subject: string; organizationId?: string };
  lineage: readonly string[]; // root owner DID first, agent DID last
  expiresAt: number;          // Unix seconds
}
```

This authenticates identity. It grants no application permission, tenant access,
payment authority or credential. Consumers must authorize the operation against
the returned owner/org and their own service policies. LifeID/WorkOS authenticates
humans; Blinds brokers agent credentials; Genesis KMS protects customer secrets.
The open SDK does not substitute an in-memory owner directory or revocation list
for those authorities.

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
| `resolveDelegations(did, audience)` | Optional for initial proof verification, required by `resolve()`. Return the current signed owner-to-agent chain from an authoritative lineage source. This allows current owner/revocation checks at OIDC code redemption and UserInfo without replaying possession. |

The resolver adapter must restrict outbound origins and honor its own trusted
registry contract. A request supplies identifiers and signed evidence, never
registry credentials, public-key trust roots or permission to expand access.

Defaults are a 300-second possession-proof lifetime, 86,400-second delegation
lifetime, 16 delegation links and zero clock tolerance. Limits and a trusted
`now(): number` clock are configurable. Clock tolerance may be at most 60 seconds;
delegation depth may only be reduced from the 16-link maximum. Owner roots must
have OAS kind `hmr`, `mhr`, `ao`, or the readable `enr` organization alias; an
agent root remains invalid even if an overly broad owner callback approves it.
Expired credentials still fail. Credentials require integer Unix times and cannot
amplify the parent lifetime. Expiry is the shortest signed lifetime in the result.

## Proof transport

`verify(proof, {audience, nonce})` accepts
`{token: string, delegations: readonly string[]}`. `delegations` is ordered from
the approved owner root to the leaf agent. Each link is a compact signed JWT with:

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
owner authority and revocation, but **does not prove the subject's possession**.
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
owner authority, keys, policy and revocation configuration come from the server.
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
