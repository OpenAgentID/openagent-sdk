# Scope Grammar

Scopes are the authorization primitive in OpenAgent. This page is the normative specification of the scope string format and the matching algorithm. If you're building a custom resource or writing a new adapter, read this before picking names.

## String format

A scope is three colon-delimited segments:

```
<service>:<resource>:<action>
```

Each segment matches the regex `[a-z0-9][a-z0-9\-]*` — lowercase ASCII, digits, and hyphens, starting with a letter or digit. No underscores, no uppercase, no unicode. Segment length is 1 to 63 characters. Total scope length is at most 191 characters (plus an optional `!` prefix).

A segment may be a literal identifier or the wildcard `*`. The wildcard means "any value for this segment." Wildcards are only allowed on whole segments; you cannot write `github:*-s:*` or `github:pulls:read*`.

A scope may be prefixed with `!` to negate it: `!github:pulls:merge` means "explicitly forbid the github:pulls:merge action, even if a broader grant would otherwise allow it."

## Semantics

Every scope check is of the form "does this set of held scopes satisfy this required scope?" The algorithm:

1. If any held scope is a negation that matches the required scope, return `false` immediately. Negations always win.
2. Otherwise, if any held positive scope matches the required scope, return `true`.
3. Otherwise, return `false`.

A positive scope "matches" a required scope if, for each of the three segments, either the held segment is a literal equal to the required segment or the held segment is `*`.

Examples:

- Held `['github:repo:read']`, required `github:repo:read` → true (literal match).
- Held `['github:repo:*']`, required `github:repo:read` → true (wildcard).
- Held `['github:*:*']`, required `github:repo:read` → true.
- Held `['github:repo:read']`, required `github:repo:write` → false.
- Held `['github:*:*', '!github:pulls:merge']`, required `github:repo:read` → true.
- Held `['github:*:*', '!github:pulls:merge']`, required `github:pulls:merge` → false.

Negations do not require that the negated scope be granted elsewhere. You can write `['!github:pulls:merge']` and `github:pulls:merge` is simply denied. This is useful for policy inheritance: you can add a negation at delegation time to strip a specific permission from a broader grant.

## Hierarchy

Scopes do not have an implicit hierarchy beyond segments. `github:repo:read` does not grant `github:repo:readwrite`, even though `readwrite` might be thought of as "more" than `read`. Actions are arbitrary tokens — you define them in your adapter.

If you want hierarchy, bake it into the action names and use wildcards. Common patterns:

- `read`, `write`, `admin` — three discrete levels.
- `get`, `list`, `search`, `create`, `update`, `delete` — REST-style verbs.
- `invoke` — a single level meaning "use this thing at all." Common for LLM APIs.

`github:repo:*` is usually what you want when you mean "full repository access"; it grants every action that might be defined now or later.

## Namespacing services

The service segment is the most important. It's how resources stay distinct across vendors. Guidelines:

- Use the vendor name: `openai`, `anthropic`, `github`, `stripe`, `slack`.
- For internal services, prefix with your org: `acme-billing`, `acme-core`.
- For the OpenAgent meta-scopes (which govern the SDK itself), use the `openagent` prefix: `openagent:agent:create`, `openagent:credential:raw`, `openagent:revoke`.

Avoid overlapping service names across your ecosystem. Two different services with the same name is a bug that will bite you later.

## Action naming

Actions are vendor-defined but should follow a few conventions:

- Use the verb form: `invoke`, `read`, `write`, `delete`, `create`, `list`, `search`.
- Prefer fewer, broader actions over many narrow ones. `github:repo:read` is better than `github:repo:list-commits` unless you specifically need to distinguish.
- For LLM APIs, the convention is a single `invoke` action per surface: `openai:chat:invoke`, `openai:embeddings:invoke`, `anthropic:messages:invoke`.

## Meta-scopes

OpenAgent reserves the `openagent:*:*` namespace for meta-operations on the SDK itself. The ones you'll encounter most often:

- `openagent:agent:create` — permission to mint new agents.
- `openagent:agent:delegate` — permission to create child agents via `delegate`.
- `openagent:agent:revoke` — permission to revoke an agent and its descendants.
- `openagent:credential:raw` — permission to call `rawCredential()` (the escape hatch).
- `openagent:audit:read` — permission to query the audit log.
- `openagent:policy:admin` — permission to write policies.
- `openagent:broker:admin` — broker administration (typically operators only).

These meta-scopes are checked by the SDK itself and don't require a service catalog entry. Revoking them effectively disables the corresponding SDK surface for the holder.

## Canonicalization

For hashing and comparison, scopes are canonicalized by:

1. Trim whitespace.
2. Lowercase the three segments (the `!` prefix, if present, is preserved).
3. Remove duplicate scopes in a scope list.
4. Sort the scope list lexicographically.

Two scope lists are equivalent if their canonical forms are equal. Equivalent lists hash to the same value.

## Validation

The SDK rejects malformed scopes at every boundary. Common failures:

- `Openai:chat:invoke` — uppercase (reject).
- `github:repo:read_commits` — underscore (reject).
- `github:repo:` — empty action segment (reject).
- `*:chat:*` — wildcard service (accepted, but usually too broad; emit warning).
- `openai::invoke` — empty resource segment (reject).

Validation errors produce `OpenAgentError::InvalidScope` with the offending scope string and a human-readable reason.
