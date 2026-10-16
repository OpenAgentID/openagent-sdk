# Delegating Authority

Identity delegation and application capability delegation are different
contracts. SDK 0.8.0's `IdentityVerifier` verifies signed identity paths; the
configured issuer/broker authorizes and signs capability grants. Neither the
local identity module nor `OpenAgentInstance` exposes a `delegate()` method.

## Run real OAS descendants

```sh
cd examples/typescript/04-delegated-agent
npm install
npm start
```

The [complete example](../../examples/typescript/04-delegated-agent/src/index.ts)
uses the published OAS SDK to create and sign a root and two descendants.
`createOasIdentityProvider` from `@openagentid/sdk/integrations/oas` connects its
actual `deriveChild`, document verification and signer APIs to
`OpenAgentRuntime.createAgent` and `loadAgent`. The example verifies the real
root/child chain and rejects a scope-amplification attempt.

Applications supply an `OasIdentityStore`, a creation authorization callback and
a service audience. The store owns current registrations, durable signer custody
and atomic duplicate-DID refusal. The creation callback explicitly authorizes
the requested scope set; scopes are not invented fields on an OAS document.
Names and metadata are included in the child's freshly signed document.

The provider's `signBytes(did, payload)` signs exact bytes for integrations that
require a raw signature. `signChallenge(did, challenge)` separately signs an
audience-bound `oaid-challenge+jwt` envelope with a 60-second lifetime. An
envelope signature cannot be treated as a signature over the raw challenge.
Neither operation creates a capability token or bypasses receiver trust.

Portable OAS lineage establishes signed derivation. Your owner/root authority
still establishes who can act for a person or organization. The local example
makes no claim to public registration or LifeID authentication. For possession
and current owner/self-root trust, use the verification protocol below.

## Signed identity path

An approved root may be a current real owner or an explicitly authorized agent
self root. Each parent signs an `oaid-delegation+jwt` with exact parent `iss`,
child `sub`, fixed service `aud`, integer `iat`/`nbf`/`exp` and unique `jti`.
The protected `kid` names the parent's current authoritative verification
method with `capabilityDelegation` purpose. Ed25519/EdDSA and RSA/RS256 are
supported. An incoming public key cannot appoint that authority.

The possession proof uses `oaid-proof+jwt`, exact agent `iss`/`sub`, `kind:
'agent'` and the receiver-issued nonce. Its key requires `authentication`
purpose. Delegations are root-first in `{token, delegations}`; a direct
approved self root has an empty array. Every delegation/ancestor and credential
revocation is checked, and credential lifetime cannot exceed parent/root
lifetime. Default maximum depth is 16 links.

`verifier.verify(proof, {audience, nonce})` authenticates current possession,
root/chain/revocation and atomic replay. `verifyLineage(did, delegations,
{audience})` checks the current signed path without proving leaf possession.
`resolve(did, {audience})` loads the chain from the host's authoritative
`resolveDelegations`. [Exact verification contract](../identity-verification.md).

## Issuance and permission

The parent signer/custody service owns authorized key use, child provisioning
and signature issuance. The SDK does not derive a child key from a public
parent DID, guess a child's DID from its name, or mint a child ACT when it
verifies a chain. The host's registry persists the actual binding and its
current revocation policy.

If an application delegates permissions, its real issuer/broker must enforce
scope attenuation, tenant binding, budget, expiry and revocation when issuing
and using that grant. Identity JWTs carry identity evidence; they do not
implicitly convey every application scope. A local `SkillsPolicy.grant()`
changes an in-memory allowlist and is not a signed transferable capability.

## Revocation and renewal

The current verifier checks every DID/credential status through its configured
revocation authority. It does not atomically revoke a subtree in a registry or
push an update to every worker. The issuer/registry defines that operation,
distribution and failure handling. `OpenAgentWorkspace.revoke(did)` persists
only that receiver's trust withdrawal; it neither deletes the signer nor
changes independent receivers.

Use the verified `did`, `owner`, explicit `root`, `lineage` and expiry, then apply
the receiving application's permission policy. See [creating an agent](creating-an-agent.md),
[credential clients](managing-credentials.md) and
[wire boundaries](../reference/wire-formats.md).
