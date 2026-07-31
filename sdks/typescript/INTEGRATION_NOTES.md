# Integration Notes

This file tracks the APIs the OpenAgent TypeScript SDK expects from its
peer packages. Until those packages ship, the SDK provides safe stub
implementations and duck-typed adapters.

When a wrapped SDK finalizes, **replace the relevant interface import with a
direct package import and delete the corresponding stub**. No source changes
should be required outside the file listed for each gap.

## Status matrix

| Package                   | Status                | Gap owner file                  |
|---------------------------|-----------------------|---------------------------------|
| `@openagentid/oas-sdk`                | Not yet published     | `src/identity.ts`               |
| `@openagentid/arsenal-sdk`            | Not yet published     | `src/credentials.ts`            |
| `@openagentid/aegis-sdk`              | Not yet published     | `src/verification.ts`           |
| `@openagentid/crypto-wasm`  | Rust crate exists; wasm-pack build pending | `src/identity.ts` (signChallenge) |

## `@openagentid/oas-sdk` — identity provider

The SDK expects an exported class (or factory) matching `IdentityProvider`
in `src/identity.ts`:

```ts
interface IdentityProvider {
  createAgentIdentity(input: CreateAgentInput): Promise<IdentityDocument>;
  resolve(did: Did): Promise<IdentityDocument>;
  signChallenge(did: Did, challenge: Uint8Array): Promise<SignedAssertion>;
  publicKey(did: Did): Promise<string>;
}
```

Things the OAS SDK must supply that are currently stubbed:

1. **Key generation** — real Ed25519 keypairs via `@openagentid/crypto-wasm`
   rather than the deterministic-string placeholder in
   `StubIdentityProvider.createAgentIdentity`.
2. **DID assembly** — use the canonical `did:oas:<namespace>:<kind>:<id>`
   algorithm from the OAS v1.1.0 spec, not the `stub-*` suffix.
3. **Document persistence** — the OAS SDK owns resolver caching,
   pinning, and revocation checks. The stub keeps an in-memory map.
4. **`signChallenge` signature format** — the stub returns a
   `stub.<did>.<b64>` string. The real SDK should return a JWS or COSE
   envelope as specified in OAS §5.

Replace plan:

- Delete `StubIdentityProvider` once `@openagentid/oas-sdk` ships a conforming class.
- In `agent.ts#buildSubsystems`, replace the `new StubIdentityProvider(...)`
  fallback with `new OasIdentityClient(...)`.
- Keep `toIdentityProvider()` — it remains useful for user-supplied
  wrappers and mocks.

## `@openagentid/arsenal-sdk` — credential broker client

The SDK expects `@openagentid/arsenal-sdk` to export a class matching `ArsenalClient`
in `src/credentials.ts`:

```ts
interface ArsenalClient {
  requestCredential(params: {
    agentDid: Did;
    provider: string;
    scopes?: readonly string[];
  }): Promise<IssuedCredential>;

  release?(credentialProxyUrl: string): Promise<void>;
}

interface IssuedCredential {
  provider: string;
  proxyUrl: string;
  expiresAt: number;
  remainingCalls?: number;
  metadata?: Record<string, unknown>;
}
```

Things to confirm with the Arsenal team:

1. **Proxy URL format** — the current stub uses
   `https://stub.arsenal.invalid/proxy?...`. The real broker should return
   an HTTPS URL with whatever auth material Arsenal bakes into headers or
   path params. The OpenAgent SDK passes through `X-Arsenal-Target` and
   `X-Arsenal-Agent` headers; Arsenal must document whether these are the
   final names.
2. **Scope denial error** — when a requested scope is not granted by the
   broker, `requestCredential` should throw an error that the OpenAgent
   SDK can map to `ErrorCode.CREDENTIAL_SCOPE_DENIED`. A stable error
   class or `code` field on the thrown error is required.
3. **Release semantics** — `release()` is currently optional. If Arsenal
   requires explicit release for per-call quota accounting, make it
   mandatory; the SDK already calls it during `handle.release()`.
4. **Refresh** — the SDK calls `requestCredential` again when the
   credential is within 30 seconds of expiry. Arsenal must tolerate this
   "silent rotation" without rate-limiting legitimate re-issue.

Replace plan:

- In `agent.ts#buildSubsystems`, replace `stubArsenalClient()` with
  `new ArsenalBrokerClient({ endpoint: resolved.endpoints.arsenalBroker, ... })`.

## `@openagentid/aegis-sdk` — verification client

The SDK expects `@openagentid/aegis-sdk` to export a class matching `VerificationClient`
in `src/verification.ts`:

```ts
interface VerificationClient {
  verifyRequest(req: Request, options?: VerifyRequestOptions): Promise<AuthContext>;
  issueChallenge(): Promise<{ challenge: Uint8Array; challengeId: string }>;
  verifyChallengeResponse(params: {
    challengeId: string;
    agentDid: Did;
    signatureBase64: string;
  }): Promise<AuthContext>;
}
```

Things to confirm:

1. **`verifyRequest` input** — the SDK passes a standard WHATWG `Request`.
   AEGIS must accept this directly (reading `Authorization`, method, path,
   and body as needed). Framework-specific adapters (Express, Next, Hono)
   stay outside the core SDK.
2. **`AuthContext` shape** — lineage, scopes, and expiry must match the
   structure in `src/verification.ts`. If AEGIS returns richer claims,
   they can go into the optional `claims` field.
3. **Clock skew** — `VerifyRequestOptions.clockSkewSeconds` is currently
   a hint. AEGIS should document its own skew tolerance.

Replace plan:

- In `agent.ts#buildSubsystems`, replace `new StubVerificationClient()`
  with `new AegisVerifier({ endpoint: resolved.endpoints.aegisVerifier, ... })`.

## `@openagentid/crypto-wasm`

The Rust crate exists at
`/Volumes/L1feAI/l1feosx/openagent-sdk/crates/openagent-crypto-wasm/` but
has not yet been published as a wasm-pack NPM package. Once built:

1. Wire `StubIdentityProvider` (or its OAS replacement) to use
   `ed25519_generate_keypair()` and `ed25519_sign()` from the wasm bindings.
2. Gate the import behind a try/catch so the SDK still works in runtimes
   where loading WASM synchronously is awkward (e.g. Workers cold start).

Until then: the SDK's crypto-dependent surfaces live inside `signChallenge`
and are only reachable through the `IdentityProvider` interface, so they
can be swapped without touching public API.

## Parallel Rust SDK alignment

The Rust version of this SDK is being built in parallel at
`/Volumes/L1feAI/l1feosx/openagent-sdk/crates/openagent-sdk/` (not yet
present). When it lands, verify:

- Function names match: `create_agent` ↔ `createAgent`,
  `credentials_for` ↔ `credentialsFor`, etc.
- Error codes match the `ErrorCode` enum in `src/errors.ts`.
- `SkillsPolicy` supports the same wildcard matching semantics.
- `AuthContext` fields are identical across languages.

Conformance tests should live in `openagent-sdk/conformance/` and exercise
both SDKs against the same fixtures.
