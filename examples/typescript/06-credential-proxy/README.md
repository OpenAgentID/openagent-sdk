# Actual Arsenal capability proxy

```sh
npm install
npm start
```

Runs locally with Node 20+ and no account. Two loopback HTTP services start with
disposable credentials: an upstream echo service requires a secret, and a small
local broker issues actual Ed25519-signed Arsenal capabilities and verifies them
before forwarding a permitted request. The real published `ArsenalClient` uses
the broker's supported capability/proxy endpoints; the OpenAgent SDK adapter
preserves the request's method/body and returns a standard `Response`.

The example verifies the real upstream response, denial without the upstream
credential, and rejection of an unapproved destination. It closes both servers.
No secrets are printed. All parts share this one demonstration process; this is
not a production key-custody boundary or a hosted Arsenal deployment.

In production, use your actual broker and its authenticated tenant registration,
server-owned DID-to-Arsenal identity binding, secret store and destination
policy. `createArsenalCapabilityFetch` requires an issued capability, a fresh
binding-authority callback and an explicit destination allowlist. HTTPS is
required except for loopback development addresses. The published broker API
buffers bytes; this adapter does not advertise streaming/SSE support.
