# 06 — Credential Proxy (Arsenal Broker)

Demonstrates calling an upstream HTTP API through the Arsenal credential proxy. The agent never sees the real API key — the broker attaches it, proxies upstream, and returns the response. This is the pattern you want for any agent making external HTTP calls in production.

## What it shows

- `agent.credentialsFor(service)` returning a fetch-compatible proxy.
- GET, POST, and streaming examples.
- Headers set by the caller, and headers injected by the broker.
- Error handling — what happens when the upstream service returns 4xx/5xx.
- Why the credential never enters the agent process.

## Run it

```bash
bun install
bun run start
```

The example uses a local `echo` service baked into the SDK's `fake://in-memory` mode, so it runs without any external API. In production, `credentialsFor('echo')` would route to a real service and the broker would inject a real credential.

## The flow in detail

```
your agent                 Arsenal broker                upstream API
-----------------          -----------------             -----------------
credentialsFor('openai')
 |
 v
openai.post(url, body)     --->                          (pending)
                           verify ACT
                           look up credential
                           attach Authorization header
                           apply SSRF guard
                           proxy upstream            --->
                                                          process request
                           <---                           200 OK
                           return body + status
 <---
handler sees response
```

The agent never held the `Authorization: Bearer sk-...` header, and it never had the opportunity to leak it. A full compromise of the agent process leaks zero provider credentials.

## Error handling

The example also shows how the SDK distinguishes broker errors from upstream errors:

```
try {
  const res = await openai.post(url, body);
  if (!res.ok) { /* upstream 4xx/5xx */ }
} catch (err) {
  if (err instanceof OpenAgentError && err.code === 'BROKER_UNAVAILABLE') { ... }
  if (err instanceof OpenAgentError && err.code === 'UPSTREAM_ERROR') { ... }
}
```

See [error-codes.md](../../../docs/reference/error-codes.md) for the full code table.

## Try this next

- Add a second service and register credentials for both.
- Enable semantic caching with `{ cache: { mode: 'semantic', ttlSeconds: 60 } }`.
- Watch the audit log for credential fetches with `OpenAgent.audit(did).recent({ limit: 10 })`.

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](../../../LICENSE-APACHE) or [MIT license](../../../LICENSE-MIT), at your option.
