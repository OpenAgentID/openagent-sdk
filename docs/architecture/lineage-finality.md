# Lineage and anchor authority

A valid signature, a current trusted identity and permission for an operation
are separate decisions. OpenAgentID supplies portable verification and explicit
authority hooks; it does not require every agent to use a human root or one
centralized finality service.

## Portable identity verification

`IdentityVerifier` verifies signed possession/delegation evidence against the
receiver's authoritative DID keys, root policy, current revocation and atomic
challenge/replay store. It supports owned roots and explicitly authorized self
roots. The Node local workspace implements direct self-root trust using public
key pins at that receiver.

Signatures may be checked locally; external ownership, current revocation and
application permissions still depend on the configured authority. A request's
declared root or lineage array is insufficient. See
[identity verification](../identity-verification.md) for the exact contract.

## Provider-facade authority hooks

The configured verification facade retains these genuine interfaces:

- `PrivilegedAuthorityVerifier.verify(ctx, options)` supplies a verified
  `LineageAuthorityContext` from the deployment's authority backend.
- `PrivilegedAuthorityVerificationClient` wraps a real `VerificationClient`
  and invokes that hook when `requirePrivilegedAuthority` is requested.
- `LineageAuthorityContext` carries `subject`, `source`, `root`, `path`,
  `finalizedBlock`, `pathKind`, `scopes` and `generation`, with optional root/org
  commitment and expiry metadata.

The wrapper checks bindings and required path metadata; the configured authority
verifier must actually reconstruct and verify that authority. Returning a shaped
object without the underlying checks supplies no proof. Keep the names and fields
intact when integrating an existing deployment.

These facade APIs and some upstream documentation retain Sigil-oriented comments
and terminology. They describe the legacy anchored integration, not a mandatory
backend for local identity, portable JWT verification or the browser player.
The existing [EAS adapter](../../adapters/eas/typescript/) is another explicit
anchor seam. It requires its own authoritative configuration and is not a
default global trust source.

## Base and backend migration

The implemented [EAS adapter](../../adapters/eas/typescript/) is configurable
for Base; its README uses Base RPC and EAS GraphQL endpoints. The separate
`@openagentid/anchor-eas` package is published at 0.1.1. Select its schema UID,
trusted attester, endpoints, confirmation policy and, when publishing, actual
EAS contract and protected signer explicitly.

That support does not prove a default Base backend, a deployed trusted contract
or a completed Sigil-to-Base data migration. A migration must preserve identifier
bindings, authority commitments, revocation, finality and rollback policy.
Renaming legacy type fields does not implement or verify that migration.

## Fail closed at the required boundary

If an application requires an owned root, a particular chain anchor or an
organization membership proof, it must refuse the operation when that authority
is missing, stale or unavailable. It must not downgrade the required permission
check to DID syntax or successful key possession. Self-root approval is a
separate explicit policy, not a fallback for a failed owned-root check.

The identity decision can be shared by OIDC, OATS, credential brokers and runtime
consumers through their configured contracts. Each consumer still authorizes its
own operation and tenant; identity, reputation and avatar pixels do not grant
those permissions automatically.
