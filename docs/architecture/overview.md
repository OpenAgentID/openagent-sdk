# Architecture overview

The current public SDK has independent identity, verification and presentation
modules, plus an optional provider facade. A developer can run the
[starter](../developer-tooling.md) with public npm packages and receiver-owned
trust; hosted services and an anchor chain are not required for that path.

## Public runtime modules

| Module | Responsibility | Caller supplies |
| --- | --- | --- |
| `@openagentid/sdk/local` | Node Ed25519 custody, public identity exchange, current local trust/revocation and durable nonce/JTI consumption | Private persistent single-host directory, audience and explicit trust decisions |
| `IdentityVerifier` | Possession signatures, signed lineage, owned/self root policy, revocation and replay | Authoritative resolvers, root policy, current status and atomic replay storage |
| Verification HTTP handler/client | Carry proof to an application-owned verification service | HTTPS endpoint and server-issued challenge/session binding |
| Characters, Glyph and browser player | Deterministic SVG and live eye presentation | Exact DID, validated appearance and authorized activity updates |
| OATS scorer/evidence adapter | Verify and aggregate accepted attestation evidence | Trusted attesters, assertion-purpose keys and current identity/credential authority |
| Separate OIDC provider | Discovery/JWKS, authorization code/PKCE, signed claims and optional owner federation | Signing/cookie keys, RP registrations, durable provider storage and identity callbacks |

Identity results carry their trust root explicitly. Owned roots bind a verified
person/org; self roots bind a current receiver policy grant and have `owner: null`.
Verification supplies no application scopes or implicit tenant admission.

The local workspace uses jose and Node cryptography; the portable verifier uses
jose/native crypto. Character hashing/rendering uses public JavaScript modules.
The self-contained browser bundle exports the DOM player and catalogs without
Node filesystem or credential clients. The optional
[WASM crypto surface](why-wasm-crypto.md) serves other configured integrations;
it is not a prerequisite for the public starter.

## Optional provider facade

`OpenAgentRuntime` wraps configured `IdentityProvider`, `ArsenalClient` and
`VerificationClient` implementations. `OpenAgent.configure` configures a singleton
of the same runtime. Supply these clients explicitly through `config.clients`.
Endpoint strings do not construct them.

- `createAgent(input)` validates input and calls `clients.identity.createAgentIdentity`.
  The provider owns provisioning policy, key custody and signed relationships.
- `loadAgent(did, skills?)` resolves through the configured identity provider.
- `authenticate(request, options?)` takes a WHATWG Fetch `Request` and delegates
  to `clients.verification.verifyRequest`.
- `agent.credentialsFor(provider)` requires the configured credential client.
  Identity creation alone does not issue a capability token or provider secret.

OAS defines identity/document/lineage contracts; Arsenal supplies capability and
credential-broker contracts; AEGIS supplies verification and policy integrations.
Their packages have separate release/access requirements. The Rust facade has
Git dependencies on those repositories and feature-gated Arsenal/AEGIS modules.
The public TypeScript standalone path avoids those dependency requirements.

## Where authority comes from

Every resolver and authority callback is an explicit trusted boundary. It must
bind current keys and signed evidence to the exact identifier, reject stale or
unknown revocation state and validate the real owner or receiver policy. Request
JSON cannot set trust roots, owner approval or the service's replay policy.

Anchored deployments can configure a resolver/finality adapter for their chosen
authority source. Existing provider-facade interfaces retain legacy lineage
metadata; see [lineage and anchor authority](lineage-finality.md). This repository
does not establish a Base backend replacement merely by changing documentation.

## An authenticated request

1. The application approves a public identity under its onboarding policy.
2. Its receiver issues a DID/audience-bound challenge.
3. The agent signs for that exact challenge; its private key stays in signer custody.
4. Verification checks signature, root/lineage, current revocation and atomic replay.
5. The application authorizes the requested operation and tenant independently.
6. The host may send an authorized activity update to the browser player.

Hosted credential, OIDC, wallet, policy and audit services are separately configured
integrations. This SDK does not promise their deployment, automatic audit capture,
revocation propagation latency or broker performance from a package import.

The [identity verification contract](../identity-verification.md) describes the
mandatory checks and failure behavior; the [threat model](threat-model.md) covers
integration concerns that remain the host's responsibility.
