# @openagentid/http

HTTP challenge authentication for OpenAgentID: verified DID binding, single-use
challenges, server-side sessions and immediate identity revocation checks. Works
with the current `@openagentid/sdk` IdentityVerifier and Express or Fetch handlers.

## Run a real agent in one command

Install Node.js 20+, then:

```sh
npm install @openagentid/http @openagentid/sdk express@^5
node node_modules/@openagentid/http/examples/express-sdk.mjs
```

The complete [example](examples/express-sdk.mjs) generates an actual Ed25519 key,
explicitly registers that public identity in a local receiver, authenticates
through a real TCP Express server, sends a JSON application request, revokes the
identity and confirms the next request is denied. It needs no hosted account.
The example's in-memory pins are an explicit local trust policy; they do not
claim registration at a public identity authority.

## Integrate with your SDK verifier

Use the same authoritative `resolveDid` callback that your `IdentityVerifier`
uses. The bridge calls `verifier.resolve(did, { audience })` to validate current
root authorization, signed lineage and revocation, then selects the uniquely
bound Ed25519 authentication key. A request-provided DID or key is never trusted.

```ts
import { createOpenAgentMiddleware, createSdkIdentityKeyResolver } from '@openagentid/http';
import { verifyNodeSignature } from '@openagentid/http/node';

// app is your Express app; verifier and resolveDid are your configured SDK
// authorities. The complete runnable example above provides every definition.
app.use(express.json());
app.use(createOpenAgentMiddleware({
  origin: 'https://api.example.com',
  verifySignature: verifyNodeSignature,
  resolveIdentityKey: createSdkIdentityKeyResolver({
    verifier, resolveDid, audience: 'https://api.example.com',
  }),
}));
```

The middleware adds `req.openAgent` with the authenticated `peerDid`. Application
JSON and query parameters remain intact. The Fetch handler returns either a
`Response` for handshake routes or an `AuthResult`: the application must check
`result.authenticated` before continuing. Optional `excludePaths` deliberately
make the specified path and descendants public. Other well-known descendants
remain protected.

The default session store is single-process memory. Multiple workers require a
shared `SessionStore` with an **atomic `take(id)`** operation (Redis GETDEL or SQL
DELETE RETURNING); separate get/delete operations are unsafe. Challenge tokens
are consumed before asynchronous authority/signature verification, on success
and failure. Session records must remain private and expire at `expiresAt`.
Serve production traffic over HTTPS; session tokens are bearer credentials.

## Algorithms and trust

`verifyNodeSignature` supports Ed25519 raw 32-byte keys and secp256k1 compressed
33-byte SEC1 keys. Both use base64url without padding. secp256k1 signatures use
SHA-256 and 64-byte IEEE-P1363 encoding. Custom runtimes can supply an
algorithm-aware `VerifySignatureFn` and authoritative `ResolveIdentityKeyFn`.

The SDK identity verifier supports Ed25519/RSA; this HTTP protocol supports
Ed25519/secp256k1. Their shared supported algorithm is Ed25519. secp256k1 callers
must supply an authoritative resolver for that algorithm. The SDK bridge rejects
ambiguous authentication keys and methods that are not bound to the requested
DID. The middleware rechecks current trust and the same key on every application
request; rotation, revocation or unavailable authority invalidates the session.

This is client authentication over an authenticated HTTPS connection. It does
not independently prove a server's DID or grant application scopes/tenant
access. Apply your application's authorization to the verified `peerDid`.

## Migrate from 0.1.x

- Set `origin` to the canonical service HTTP origin. `serverDid` is now an
  optional, separate discovery field; a DID is not an HTTP origin.
- Supply `resolveIdentityKey`; proof JSON now includes `did`. The client sends
  and validates it automatically. Unbound proofs are rejected.
- Custom `SessionStore` implementations must implement atomic `take`.
- Custom signature callbacks receive `keyType` and must verify exactly that
  algorithm. Node callers can use the included verifier.
- Register `express.json()` before the middleware. Read `req.openAgent.peerDid`
  rather than trusting caller-supplied DID headers.
- The nonexistent `@openagentid/auth-protocol` peer has been removed. The SDK
  peer is the actual published `@openagentid/sdk` package, starting at 0.7.2.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run example
```

Tests exercise actual Node cryptography for both algorithms, 20 concurrent
replays, invalid signatures, DID/key substitution, stale challenges, authority
outages and actual Express requests with the SDK's root/revocation validation.

## License

Apache-2.0 OR MIT. [Source](https://github.com/OpenAgentID/openagent-sdk).

Direct `authenticateRequest(request, store, resolveIdentityKey)` calls require the
same authoritative resolver as middleware. The resolver runs on every request;
missing configuration, revocation, key rotation or an outage denies admission.
