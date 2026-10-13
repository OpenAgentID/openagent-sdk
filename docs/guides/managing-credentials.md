# Managing credentials

Use a real Arsenal capability with the SDK's `createArsenalCapabilityFetch`
adapter. It connects the published Arsenal client to standard HTTP requests,
with explicit DID, agent, tenant, audience and destination binding.

## Run the complete example

From the repository:

```sh
cd examples/typescript/06-credential-proxy
npm install
npm start
```

The [complete source](../../examples/typescript/06-credential-proxy/src/index.ts)
starts an actual local broker and a separately listening protected upstream.
The real `ArsenalClient` requests an Ed25519-signed capability, the broker
verifies its signature and identity/fingerprint constraints, and a permitted
request reaches the upstream with the broker's disposable credential. The
example asserts the response and both unauthorized-request denials, then closes
the services. It prints no credentials and makes no external provider calls.

This is an executable local protocol demonstration. Production applications use
their actual broker, secret custody and authenticated tenant registration.

## Connect an existing broker client

Import the current SDK adapter from its optional component entry point:

```ts
import { createArsenalCapabilityFetch } from '@openagentid/sdk/integrations/arsenal';
import type { ArsenalClient, CapabilityHandle } from '@openagentid/arsenal-sdk';
import type { ArsenalIdentityBinding } from '@openagentid/sdk/integrations/arsenal';

export function providerFetch(
  client: ArsenalClient,
  capability: CapabilityHandle,
  binding: ArsenalIdentityBinding,
  authorizeBinding: (binding: ArsenalIdentityBinding) => Promise<boolean>,
  allowedOrigins: readonly string[],
): typeof fetch {
  return createArsenalCapabilityFetch({
    client, capability, binding, authorizeBinding, allowedOrigins,
    maxRequestBytes: 1_048_576,
    timeoutMs: 30_000,
  });
}
```

Start the actual client's session with `startSession()`, then obtain the
`CapabilityHandle` with `requestCapability()` or `requestCapabilityForScopes()`.
The required binding contains `did`, `agentId`, `tenantId` and `audience`.
`authorizeBinding` must consult the receiving application's current authority;
an incoming DID, tenant selection or token claim cannot establish that mapping.

Before dispatch, the adapter checks the actual client's identity, capability
subject/tenant/audience and lifetime, the fresh binding decision, destination
allowlist and request size. It calls the published `BrokerClient.proxyRequest`
with the actual client fingerprint. The broker verifies cryptographic authority,
consent and destination policy; returned metadata must confirm destination and
fingerprint checks. HTTPS is required except for numeric loopback development
addresses. The returned `Response` preserves status, headers and response bytes.

The published Arsenal proxy protocol buffers bytes. This adapter does not claim
SSE streaming. It enforces a configurable request-body limit and sends a broker
timeout. Abort signals are checked before/after processing; the published
broker API cannot cancel an already dispatched call. Do not automatically retry
an uncertain non-idempotent operation.

## Existing proxy-URL integrations

The SDK's older `ArsenalClient` interface is a separate injected contract:
`requestCredential({agentDid, provider, scopes?})` returns a scoped `proxyUrl`.
It is not the class exported by `@openagentid/arsenal-sdk`. Applications already
implementing that contract can keep `OpenAgentInstance.credentialsFor()` and
`CredentialHandle.fetch`, `refresh` and `release`.

SDK 0.7.3 preserves native `Request` method/body/headers and `RequestInit`
overrides through that transport, including cancellation. Standard `Response`
streaming remains available when the configured proxy supports it. The proxy
still owns target restrictions, tenant/provider scopes, quotas and expiry.
`refresh()` returns a new handle; `release()` marks the old handle unusable and
calls the optional release hook. A broker release failure still rejects.

Use `createArsenalCapabilityFetch` for the published Arsenal capability client.
Passing that client into the incompatible proxy-URL facade now fails immediately
with adapter guidance. No proxy URL, broker endpoint or credential is fabricated.

In Life integrations, Blinds brokers credentials and Genesis KMS protects
customer secrets using Google Cloud KMS. Other deployments choose their own
custody and broker. [Integration contracts](../../sdks/typescript/INTEGRATION_NOTES.md)
explain these boundaries and the concrete published APIs.
