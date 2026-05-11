# Authenticating Requests

`OpenAgent.authenticate(request)` is the function you call at the top of every handler that should be restricted to agents. It verifies the inbound request, returns a `Context` object, and throws a structured error if anything fails.

## What authenticate does

Given an HTTP-like request (Node's `IncomingMessage`, a `Request` from the Fetch API, an Axum `Request<Body>`, or a framework-agnostic shape), the SDK walks through a short pipeline:

1. **Locate the credential.** The TypeScript SDK looks at headers in this order: `Authorization: OpenAgent <token>`, `Authorization: Bearer <token>`, `X-OpenAgent-Token`, and finally an `oa_token` query parameter. The first one that matches wins.
2. **Parse the token.** If the credential is an ACT, it's decoded and its structural integrity checked. If it's a detached signature, the signing DID is extracted from the `X-OpenAgent-Did` header.
3. **Verify the signature.** The DID's public key is recovered (either from the DID itself or from a cached resolver), and the signature is verified offline.
4. **Check the ACT.** If there is one, the broker signature is verified, expiration is checked, and the scope list is captured.
5. **Apply AEGIS policies.** Any policies referenced by the ACT are evaluated against the request context — time-of-day rules, rate limits, IP allow-lists, spending caps, whatever you've configured.
6. **Return a `Context`.** The context holds the DID, the lineage chain, the scope list, the policy evaluation results, and the raw ACT for forwarding.

If any step fails, the SDK throws `OpenAgentError` with a `code` you can switch on. Every failure mode is distinct — you won't get "invalid request" as a catch-all.

## TypeScript example

```ts
import { OpenAgent, OpenAgentError } from '@openagent/sdk';
import type { IncomingMessage, ServerResponse } from 'node:http';

export async function handle(req: IncomingMessage, res: ServerResponse) {
  try {
    const ctx = await OpenAgent.authenticate(req);
    // ctx.did        -> 'did:oas:acme:agent:...'
    // ctx.scopes     -> ['openai:chat:invoke', ...]
    // ctx.lineage    -> ['did:oas:acme:hmr:alice', ...]
    // ctx.expiresAt  -> Date
    return handleAuthenticated(ctx, req, res);
  } catch (err) {
    if (err instanceof OpenAgentError) {
      res.writeHead(err.httpStatus, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: err.code, message: err.message }));
      return;
    }
    throw err;
  }
}
```

Every `OpenAgentError` has an `httpStatus` field (401 for auth failures, 403 for scope/policy denials, 400 for malformed inputs, 502 for upstream broker unavailability). Rendering it is one line.

## Rust example

The Rust SDK provides `OpenAgentError` with an `axum::IntoResponse` implementation under the `axum` feature, so the same handler looks like:

```rust
use axum::{extract::State, http::Request, response::IntoResponse};
use axum::body::Body;
use openagent_sdk::{OpenAgent, Context, OpenAgentError};
use std::sync::Arc;

async fn handler(
    State(oa): State<Arc<OpenAgent>>,
    req: Request<Body>,
) -> Result<impl IntoResponse, OpenAgentError> {
    let ctx: Context = oa.authenticate(&req).await?;
    ctx.require_scope("openai:chat:invoke")?;

    Ok(handle_authenticated(ctx, req).await?)
}
```

The `require_scope` method returns `Err(ScopeDenied)` which `IntoResponse` renders as 403.

## Scopes and negations

Scopes are checked with `has_scope`/`hasScope`, or enforced with `require_scope`/`requireScope`. They follow a hierarchy — `github:repo:read` is satisfied by `github:repo:*` or `github:*:*`, but not by `github:issues:*`. If a scope has been explicitly negated (`!github:pulls:merge`), any check against it will always fail, regardless of broader grants.

## Middleware integration

Most frameworks have a middleware or plugin shape. OpenAgent ships ready-made adapters:

- **Express / Connect** — `import { expressMiddleware } from '@openagent/sdk/express'`
- **Fastify** — `import { fastifyPlugin } from '@openagent/sdk/fastify'`
- **Hono** — `import { honoMiddleware } from '@openagent/sdk/hono'`
- **Axum** — `use openagent_sdk::axum::OpenAgentLayer` (feature-gated on `axum`)
- **Tower** — `use openagent_sdk::tower::OpenAgentService`

Every adapter does the same thing: runs `authenticate`, stashes the `Context` on the request extension bag, and short-circuits with the right HTTP status on failure. You still need to call `require_scope` in handlers where scope matters, but the authentication step becomes automatic.

## Caching and performance

Authentication is already fast — an ACT verification is a few Ed25519 pairings, microseconds at most — but the SDK caches DID resolution in-process so that repeated requests from the same agent don't repeatedly hit the DID resolver. The cache is bounded (default 10,000 entries, LRU) and respects a short TTL. For very high-throughput services, crank the cache size or pre-warm it with your known agent DIDs.

## Delegated and compound contexts

When a parent agent calls your service "on behalf of" a child (or vice versa), the ACT can carry a compound delegation chain. `ctx.lineage` shows the chain; `ctx.actingAs` shows the innermost delegated identity; `ctx.rootHuman` shows the HMR at the top of the chain. This lets you write policies like "only accept delegated calls from a human root whose HMR is in the `acme` namespace," which is useful for SaaS multi-tenancy. See [delegating-authority.md](delegating-authority.md).

Next: [managing credentials](managing-credentials.md).
