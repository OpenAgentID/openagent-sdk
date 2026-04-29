# Error Codes

Every failure in OpenAgent produces an `OpenAgentError` with a stable `code` (TypeScript) or error variant (Rust). This page lists every code, its meaning, the canonical HTTP status, and the usual remediation. Both SDKs return the same codes.

| Code | HTTP | Meaning | Typical cause | Remediation |
|---|---|---|---|---|
| `UNAUTHENTICATED` | 401 | No credential was presented or it could not be parsed. | Missing `Authorization` header, malformed Bearer token. | Require callers to send a valid ACT or detached signature. |
| `INVALID_TOKEN` | 401 | The token was parsed but failed signature verification. | Broker key rotated, corrupted token, forged token. | Re-mint the ACT. If the error persists, check broker key rotation and cached keys. |
| `EXPIRED` | 401 | Token is past its `exp` timestamp. | Clock skew, long-running process holding a stale token. | Call `agent.refresh()` or re-authenticate. Check system clock. |
| `LINEAGE_BROKEN` | 401 | One of the lineage proofs in the chain failed verification. | Corrupted chain, parent key rotated without re-minting descendants. | Re-mint the agent under the correct parent. This is almost always a config error. |
| `LINEAGE_REVOKED` | 401 | An ancestor (or the agent itself) has been revoked. | Incident response, manual revocation, cascade from a parent revocation. | Do not retry. The agent is dead — mint a new one under a non-revoked parent. |
| `SCOPE_DENIED` | 403 | The held scopes do not cover the required scope. | Agent was created with too-narrow scopes, or the target operation requires a scope you didn't think of. | Review the scope list on the agent; re-mint with a broader (but minimal) scope set. |
| `SCOPE_AMPLIFICATION` | 400 | A delegation attempted to grant a scope the parent does not hold. | Bug in provisioning code passing a wider scope list than the parent holds. | Always derive child scopes as a subset of `parent.scopes`. The SDK provides `parent.narrowScopes(desired)` as a helper. |
| `POLICY_DENIED` | 403 | An AEGIS policy evaluated to deny. `details.reason` says which clause. | Time-of-day restriction, rate limit, spend cap, IP allowlist. | Surface the reason to the user; adjust the policy if it's wrong; otherwise deny is correct. |
| `POLICY_REQUIRES_APPROVAL` | 202 | A policy requires a human approval before proceeding. `details.approvalPrompt` has the human-readable text to display. | Skill is gated on `approval.active(...)` and no fresh approval exists. | Emit an approval request to your UI, wait for it, then retry. The Claude Agent plugin handles this automatically. |
| `BROKER_UNAVAILABLE` | 502 | The Arsenal broker could not be reached. | Broker down, network partition, DNS failure, TLS mismatch. | Check broker health, retry with exponential backoff. Most SDK methods retry automatically up to 3 times. |
| `UPSTREAM_ERROR` | 502 | The broker reached the upstream service but got a non-2xx response. `details.upstream_status` and `details.upstream_body` are provided. | Invalid request to OpenAI, GitHub rate limit, etc. | Fix the request; this is a pass-through from the upstream API. |
| `INVALID_REQUEST` | 400 | The arguments you passed to the SDK were malformed. `details.field` identifies which one. | Invalid DID string, malformed scope, missing required field, wrong body type. | Check the call site; the SDK rejects invalid input before doing any work. |
| `INVALID_SCOPE` | 400 | A scope string failed grammar validation. | Uppercase letter, underscore, empty segment. | See [scope-grammar.md](scope-grammar.md). |
| `NAMESPACE_MISMATCH` | 400 | A child DID was requested in a different namespace than the parent. | Explicit `namespace` override doesn't match parent's namespace and the caller lacks the cross-namespace meta-scope. | Remove the override or grant `openagent:namespace:cross-mint`. |
| `DID_NOT_FOUND` | 404 | The DID resolver could not find the requested DID. | Typo in DID string, resolver pointing at wrong registry, DID was never registered. | Verify the DID, check resolver configuration, re-mint if needed. |
| `DUPLICATE_DELEGATION` | 409 | A delegation with the same `(parent, name)` already exists. | Re-running a provisioning script without cleanup. | Either reuse the existing child (idempotent) or pick a different name. |
| `WALLET_INSUFFICIENT_FUNDS` | 402 | A wallet operation would exceed the agent's available balance. | Self-explanatory. | Fund the wallet or reduce the transaction. |
| `WALLET_CHAIN_UNSUPPORTED` | 400 | The requested chain is not supported or not configured. | Trying `Chain::Ethereum` without the `wallet` feature flag, or a chain that isn't in the supported list. | Enable the feature flag; check the chain name. |
| `INTERNAL` | 500 | An unexpected SDK-level error occurred. Bug report territory. | Panic caught, unexpected broker response, serialization failure. | File a bug with the `details.trace_id`. |

## HTTP status mapping

When an `OpenAgentError` is rendered via `IntoResponse` (Axum) or `err.httpStatus` (TypeScript), the status is derived from the table above. The body is a JSON object:

```json
{
  "code": "SCOPE_DENIED",
  "message": "scope denied: required github:pulls:write, held [github:repo:read]",
  "details": {
    "required": "github:pulls:write",
    "held": ["github:repo:read"]
  }
}
```

The `details` object varies by code but is always present. The fields are enumerated in the SDK source. You should treat `code` as the stable machine-readable key and `message` as the human-readable surface.

## Retry policy

Not every error is retriable. The SDK retries internally only for:

- `BROKER_UNAVAILABLE` (3 retries, exponential backoff starting at 100ms).
- Transient network errors below the broker layer (reqwest connect errors, DNS failures).

It does **not** retry:

- `UNAUTHENTICATED`, `INVALID_TOKEN`, `EXPIRED` — the credential is the problem.
- `SCOPE_DENIED`, `POLICY_DENIED` — the semantic answer is "no."
- `UPSTREAM_ERROR` — the upstream service said no, retrying won't help.
- `INTERNAL` — bug territory, should not be silently papered over.

If you want app-level retry on top of this, wrap the SDK call in your own retry layer. A common pattern is to retry `POLICY_REQUIRES_APPROVAL` after human approval comes in — the Claude Agent plugin does this automatically.

## Structured logging

Every `OpenAgentError` carries a `trace_id` that matches a W3C Trace Context span. If you're using `tracing` (Rust) or the OpenTelemetry JS SDK, the SDK automatically attaches the trace id so you can correlate errors across services. This is how you debug "which of the 400 denials this morning belong to this one angry customer" — search by trace id and walk the distributed trace.
