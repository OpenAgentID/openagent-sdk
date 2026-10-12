# Authenticating requests

Choose the verification surface that matches your application. Identity
authentication and permission for an operation remain separate checks.

## Local signed requests

The public [developer-tooling guide](../developer-tooling.md) shows the complete
signer/receiver flow. The receiver explicitly trusts a public identity, issues a
challenge and calls `OpenAgentWorkspace.verify(proof, { nonce })` after receiving
the signed proof. This verifies real Ed25519 possession, current receiver-local
trust/revocation, exact audience and atomic durable nonce/JTI consumption.

The local verifier supports direct approved self roots and returns a
`VerifiedAgentIdentity` with `owner: null`. It supplies no ACT or application
scopes. Authorize the operation and tenant after authentication.

## Portable verifier and HTTP transport

`IdentityVerifier.verify(proof, { audience, nonce })` accepts
`{ token, delegations }` against explicitly configured authoritative DID keys,
owned/self-root policy, current revocation and atomic replay storage. A request
cannot supply its own authority. `verifyLineage`/`resolve` recheck the identity
chain but do not establish fresh possession.

Use `createIdentityVerificationHandler(verifier, { audience, resolveNonce })`
for a framework-independent Fetch POST endpoint. Its server-owned challenge
lookup must validate the issued nonce, expiry and session/tenant binding. The
handler consumes bounded JSON `{ proof }`; it does not implement that challenge
issuer or its authorization policy for you.

The configured remote client `verifyIdentityRemote(endpoint, proof, { nonce })`
checks an HTTPS authority response and its correlation to the proof. That
response is trust in the configured service, not a portable signed attestation.
See [identity verification](../identity-verification.md) for keys, temporal rules,
limits and exact HTTP error semantics.

## Configured provider facade

`OpenAgentRuntime.authenticate(request, options?)` delegates to the supplied
`clients.verification.verifyRequest`. Its input is a WHATWG Fetch `Request`, not
a Node `IncomingMessage`, an Axum request or an arbitrary headers object. Use your
framework's bounded transport adapter when converting an incoming Node request.

This helper composes a real configured verification client; it does not construct
one from an endpoint or accept a decoded token as authentication:

```ts
import {
  OpenAgentRuntime,
  assertScopes,
  type AuthContext,
  type VerificationClient,
} from '@openagentid/sdk';

export async function authenticateRequest(
  verification: VerificationClient,
  request: Request,
  requiredScopes: readonly string[],
): Promise<AuthContext> {
  const runtime = new OpenAgentRuntime({ clients: { verification } });
  const context = await runtime.authenticate(request, { requiredScopes });
  assertScopes(context, requiredScopes);
  return context;
}
```

The verification client must actually verify its supported credential, key
binding, lineage, current revocation and policy. The helper's `assertScopes`
checks exact required scope strings against the returned scopes; it is not a
replacement for a broker's wildcard/negation or delegation policy. Protect
tenant access separately using verified authoritative context.

The facade returns `AuthContext`; `expiresAt` is a Unix timestamp in seconds.
Do not assume unsupported fields such as `rootHuman` or `actingAs`. The host
maps structured error codes to its HTTP response and redacts sensitive details;
there is no universal facade `error.httpStatus` contract.

## ACT and anchored integrations

ACT verification is a separate `act.verify(tokenBytes)` builder. Supply the
trusted issuer, audience, broker keys and required scopes, plus an initialized
compatible crypto binding. An identity possession proof is not an ACT.

The existing `PrivilegedAuthorityVerificationClient` can additionally require a
configured `PrivilegedAuthorityVerifier`; see
[lineage and anchor authority](../architecture/lineage-finality.md). Failure of a
required owner/anchor check must not fall back to weaker identity possession.
No import automatically provisions a broker, current ownership service or
chain backend.
