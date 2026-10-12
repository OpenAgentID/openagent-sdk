# Scope Validation and Matching

Scope strings belong to the API that consumes them. SDK 0.7.2's provider
creation input, canonical ACT grants, facade checks, OIDC identity scopes and
skills allowlists have distinct validation/matching contracts. This page does
not define a new universal grammar or permission policy.

## TypeScript provider creation input

The exported `scopeSchema` in `sdks/typescript/src/config.ts` validates:

```text
^[a-z0-9][a-z0-9_-]*(?::[a-z0-9*][a-z0-9_*-]*){1,4}$
```

It accepts **2–5** nonempty colon-separated segments. The first starts with a
lowercase letter/digit and permits lowercase letters/digits, underscores and
hyphens. Later segments additionally permit `*` in their strings. Uppercase,
whitespace, empty segments, a wildcard first segment and leading `!` are refused.
This is lexical input validation, not wildcard expansion or a scope grant.

`CreateAgentInput.scopes` is a nonempty array of these strings. The facade
passes validated requests to the configured identity provider; that provider
and the actual issuer/broker enforce parent authorization and permission.
The schema does not lowercase, trim, deduplicate or sort the list, and it does
not promise three segments, 63-byte segments or a universal 191-byte limit.

`providerSchema` is a **separate** service identifier validator:
`^[a-z0-9][a-z0-9_-]*$`. It is not a capability matcher or trusted provider
catalog. [Actual configuration source](../../sdks/typescript/src/config.ts).

## Exact facade checks

`assertScopes(authContext, required)` builds a set of the authenticated
context's held strings and requires each exact requested string. It implements
no wildcard expansion, hierarchy or negation priority. The actual configured
verification client must return authoritative scopes and enforce its own
protocol/tenant policy; a caller's requested scopes cannot become that grant.

| Held string | Required string | `assertScopes` |
| --- | --- | --- |
| `github:repo:read` | `github:repo:read` | Pass |
| `github:repo:*` | `github:repo:read` | Refuse: not an exact match |
| `github:repo:read` | `github:repo:*` | Refuse: not an exact match |

A missing exact scope throws `VerificationError` with
`ErrorCode.VERIFICATION_FAILED`. This is not the former guide's invented
`OpenAgent.scopeMatches`, context `hasScope`/`requireScope`, or global
meta-operation enforcement. Strings named `openagent:credential:raw` or
`openagent:agent:delegate` do not create those nonexistent facade methods.
[Actual checks](../../sdks/typescript/src/verification.ts).

## Canonical ACT scopes

The canonical ACT dependency pinned by the Rust SDK lockfile is
`8fda81b18c8b74726d1cbd9e7915d443b5630dcb`. Its
[`Scope` parser/matcher](https://github.com/OpenAgentID/act/blob/8fda81b18c8b74726d1cbd9e7915d443b5630dcb/agent-capability-token/src/scope.rs)
requires exactly **three nonempty** segments:
`service:resource:action`. The parser in that revision does not impose the
TypeScript creation regex or automatically normalize case/whitespace.

A whole `*` segment in an issued grant covers any requested segment in the
same position. All other strings compare literally. Matching is directional:
a wildcard in the request cannot widen a specific grant. There is no implicit
leading-`!` negation or deny-wins algorithm in this matcher.

| ACT grant | Requested ACT scope | Coverage |
| --- | --- | --- |
| `tools:calendar:invoke` | `tools:calendar:invoke` | Pass |
| `runtime:platform:*` | `runtime:platform:spawn` | Pass |
| `runtime:platform:*` | `runtime:network:spawn` | Refuse |
| `tools:calendar:invoke` | `tools:calendar:*` | Refuse |

The ACT verifier must still validate the binary envelope/signature, configured
issuer/audience, time and required scopes. Scope syntax or coverage alone
establishes no identity, tenant access, key possession or real permission
issuer. A string valid for TypeScript creation, such as `tools:invoke`, is not
valid canonical ACT scope syntax. [ACT API](../../sdks/typescript/src/act.ts)
and [wire boundaries](wire-formats.md).

## Other policies

The public `InMemorySkillsPolicy` checks exact skill names or suffix wildcard
prefixes, returning a boolean; it does not parse colon-delimited ACT scopes.
The separate OIDC provider grants identity scopes `openid` and `profile`, not
provider/tool capabilities. Specialized broker/MCP/harness policies use their
actual configured issuer/checker contracts.

Choose literal operation names and least necessary permissions under the real
issuer policy. Preserve exact signed and authorized bytes rather than silently
repairing names. Validation failures stay refusals, and an unavailable required
permission service never becomes an allowlist fallback. See
[request authentication](../guides/authenticating-requests.md),
[skills](../guides/skills-governance.md) and
[developer tooling](../developer-tooling.md).
