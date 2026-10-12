# Managing Credentials

SDK 0.7.2 provides a TypeScript credential **proxy client contract**. It does
not provision a broker, import production secrets or grant permission to use a
provider. The public [local identity path](creating-an-agent.md) needs none of
these services. Add credential brokering only when your application requires it.

## Configure a real client

An `OpenAgentRuntime` facade uses `clients.credentials`, supplied by the host.
The injected `ArsenalClient` implements:

- `requestCredential({agentDid, provider, scopes?})` returning
  `{provider, proxyUrl, expiresAt, remainingCalls?, metadata?}`.
- Optional `release(credentialProxyUrl)` to withdraw the issued proxy handle.

The client authenticates the caller and selected tenant to the actual broker.
The broker authorizes the provider, scope and upstream request; an agent DID or
requested scope array is not itself that authority. `endpoints.arsenalBroker`
alone does not construct a client. Facade use fails closed when the required
credential client is missing.

With an already configured `OpenAgentInstance`, the actual API is
`credentialsFor(provider, scopes?: readonly string[])`:

```ts
import type { OpenAgentInstance } from '@openagentid/sdk';

export async function readProviderJson(
  agent: OpenAgentInstance,
  provider: string,
  target: string,
  init: RequestInit,
  scopes: readonly string[],
): Promise<unknown> {
  const credential = await agent.credentialsFor(provider, scopes);
  try {
    const response = await credential.fetch(target, init);
    if (!response.ok) throw new Error('Provider request refused');
    return await response.json();
  } finally {
    await credential.release();
  }
}
```

This helper requires a real configured agent/client and the host's permitted
provider/target/scopes. It issues no fabricated credentials or public broker
promise. The helper consumes the JSON body before releasing. Streaming applications
should retain their handle until body consumption/cleanup has finished.

`createCredentialHandle({agentDid, provider, arsenal, fetchImpl,
requestTimeoutMs, scopes?})` is the lower-level exported function for hosts
that already have an authorized DID and real broker client. The local
workspace's public `LocalAgent` record is not an `OpenAgentInstance` and does
not have `credentialsFor`.

## Handle behavior and proxy transport

`CredentialHandle` exposes `provider`, `agentDid`, `expiresAt`, `fetch`,
`refresh()` and `release()`. Use a target URL plus explicit `RequestInit` for
method, headers and body. There are no `post`/`get`/`stream`/`multipart` wrapper
methods, raw-secret getter or per-handle cache/broker-URL options in this API.
A standard returned `Response` provides its body for streaming.

The SDK sends the request to the broker-issued `proxyUrl`, with
`X-Arsenal-Target` set to the requested upstream URL and `X-Arsenal-Agent` set
to the issued provider identifier. It forwards the explicit method/headers/body
and an abort signal using the configured fetch/timeout. The default facade
request timeout is 30 seconds; the timer ends when fetch resolves, so it is not
a guaranteed deadline for consuming an entire response stream.

The broker-issued URL may contain scoped credential material. Treat it as a
secret: do not log, expose to the browser, include in telemetry or publish it.
The SDK does not independently validate broker expiry/call counters, implement
SSRF policy, scrub responses or assert which upstream secret is attached.
The real broker enforces those contracts. It must restrict upstream origins,
redirects, resolved addresses, tenant/provider scope and credential expiry;
never let a requested target expand authorized access.

## Refresh, release and storage

`refresh()` requests a fresh credential and returns a **new** handle using the
same bound client/DID/provider/scopes. It does not mutate or release the old
handle, refresh automatically, or implement provider key rotation. The host
controls safe retry/renewal; avoid retrying uncertain non-idempotent upstream
operations.

`release()` marks this handle released before invoking the optional broker
release hook. Later `fetch` calls on the released handle are refused. Repeat
release calls are no-ops; a broker release failure can still reject the first
call, and the local released flag does not prove remote revocation succeeded.
Provider secret registration, rotation, custody, audit and recovery belong to
the actual broker/secret service. This SDK exposes no credential-registration
CLI/admin route, automatic secret-manager synchronization or `rawCredential`.

In Life integrations, **Blinds** brokers agent credentials and **Genesis KMS**
protects customer secrets using Google Cloud KMS. Those service contracts must
be configured and authorized; the SDK does not supply a retired KMS fallback
or migrate existing encrypted data. Other deployments choose their own real
custody/client implementation.

Source: [`credentials.ts`](../../sdks/typescript/src/credentials.ts),
[`agent.ts`](../../sdks/typescript/src/agent.ts) and
[`config.ts`](../../sdks/typescript/src/config.ts). See
[developer tooling](../developer-tooling.md),
[request authentication](authenticating-requests.md) and
[audit responsibilities](audit-and-compliance.md).
