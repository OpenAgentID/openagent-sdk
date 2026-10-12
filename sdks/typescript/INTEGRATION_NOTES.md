# Published component integrations

The current SDK integrates with these real published APIs through explicit,
typed adapters. Import only the needed component from
`@openagentid/sdk/integrations/oas`, `/integrations/arsenal`, `/integrations/aegis`
or `/integrations/skills-policy`; each entry's types need only its own component.
The aggregate `@openagentid/sdk/integrations` entry is for applications with all
four components installed. Importing the SDK alone never loads an optional
component or constructs trust, a broker, or private signing keys.

| Published component | SDK adapter | Actual supported workflow |
| --- | --- | --- |
| OAS SDK 1.0.2 | `createOasIdentityProvider` | Signed OAS root/child documents, portable lineage verification and challenge signatures, with application-owned scope authorization and signer storage. |
| Arsenal SDK 0.1.1 | `createArsenalCapabilityFetch` | Real issued capabilities and broker `proxyRequest` with explicit DID/agent/tenant/audience binding and destination policy. |
| AEGIS SDK 0.1.1 | `createAegisRequestAuthenticator` | `authenticate(AuthCredential, 'agent')`, then application-owned lineage/scope authorization bound to the resulting session. |
| Skills Policy 0.1.1 | `createSkillsPolicyInvoker` | `recordInvocation(skill, InvocationContext)` preserving arguments, consent, session, quota enforcement and audit receipts. |
| Crypto WASM 0.1.1+ | `setActCryptoBinding`, `setKeyCryptoBinding` | Actual cryptographic functions; ACT verification passes fresh host time. |

## OAS and the identity facade

Inject the actual OAS module, an `OasIdentityStore`, creation authority and a
service audience into `createOasIdentityProvider`. Pass its result to
`new OpenAgentRuntime({ clients: { identity } })`. The adapter calls the real
`deriveChild`, `verifyChain`, `verifyDocumentProof` and `OasKeyPair.sign` APIs.
`OpenAgentRuntime.createAgent` and `loadAgent` then use the same provider contract.

The store owns authoritative registrations and key custody. `put` must atomically
reject duplicate DIDs, and `resolve` supplies the current documents for lineage
verification. A required creation-policy callback decides scopes; no scope field
is fabricated on an OAS document. Reading a DID or verifying portable lineage
does not authenticate an HTTP request or establish a public owner registration.
The complete local flow is `examples/typescript/04-delegated-agent`.

`signChallenge` produces a real audience-bound `oaid-challenge+jwt` assertion
containing the challenge bytes and a 60-second lifetime. This is distinct from
the `oaid-proof+jwt` possession protocol consumed by `IdentityVerifier`. Use the
appropriate protocol verifier, including issuer/key binding, audience, expiry
and an issued one-use challenge. Never accept a decoded JWT as authentication.
`signBytes(did, payload)` is the separate exact-byte signing operation for
integrations such as Claude's `createSdkAgentIdentity` raw signer seam. An
assertion envelope's signature is not a signature over its raw challenge bytes.

## Arsenal capability transport

The published Arsenal client does not implement the older `requestCredential`
facade and does not mint proxy URLs. Use `startSession`,
`requestCapabilityForScopes` or `requestCapability`, and pass the resulting
`CapabilityHandle` into `createArsenalCapabilityFetch`.

The adapter checks the capability's agent, tenant, audience and lifetime,
revalidates an explicit server-owned DID binding and limits destinations. The
actual broker still verifies the signature and applies its policies. Requests
use `BrokerClient.proxyRequest` and include the client's fingerprint; the
published high-level `proxyHttp` omits that fingerprint argument. Response
metadata must confirm both destination and fingerprint verification.

The published wire protocol buffers request/response bytes. It is not an SSE
transport. Requests have a configurable size bound and broker timeout. Abort
signals are checked around processing; the published broker API cannot abort
its already dispatched call. `examples/typescript/06-credential-proxy` executes
an actual local signed-capability broker and a separately listening protected
upstream. Production applications use their own real broker and secret custody.

## AEGIS request authentication

`createAegisRequestAuthenticator` takes the actual AEGIS client, a credential
extractor and an authorization callback. AEGIS validates the credential first.
The callback receives that authenticated session and returns receiver-owned
lineage/scopes. The adapter enforces DID/session binding, lifetime and requested
scopes/ancestor, then releases the request's temporary session.

`verifyIdentity(did)` is identity lookup/verification, not request authentication.
It is never substituted for possession. The standalone request authenticator
does not invent `issueChallenge` or other methods on the published client.
Privileged authority must be checked through the dedicated
`PrivilegedAuthorityVerificationClient`; this adapter rejects that requirement.

## Skills policy

The lightweight SDK `SkillsPolicy` is a boolean allowlist. The published policy
engine requires an `InvocationContext`; casting one to the other drops arguments,
rate accounting and consent. `createSkillsPolicyInvoker` instead checks agent,
session and argument binding, records authorization, then invokes the operation.
A receipt records authorization/invocation; it does not assert operation success.
Use `examples/typescript/05-skills-governance` for YAML loading, invalid-argument
and unknown-skill denial, quota enforcement and hash-chain verification.

## Verification

`test/components-real.test.ts` exercises the installed published packages,
actual OAS Ed25519 signatures and lineage, actual AEGIS credential validation,
policy quotas and receipts, and the real Arsenal HTTP/CBOR client with a
cryptographically validating loopback broker. No component method is replaced
with a fabricated facade or an always-successful verifier.
