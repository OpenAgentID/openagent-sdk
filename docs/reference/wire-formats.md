# Wire Formats

This page documents the byte-level formats OpenAgent emits and consumes: DID strings, Arsenal Capability Tokens (ACTs), detached signatures, audit log entries, and the handshake extension for MCP. Implementing an interop library for a language OpenAgent doesn't ship? This is your document.

## DID

The canonical DID format is a string:

```
did:oas:<namespace>:<kind>:<fingerprint>[?<query>][#<fragment>]
```

- `namespace` is `[a-z0-9][a-z0-9\-]{0,62}`, roughly a DNS label. Examples: `acme`, `l1fe`, `local`, `test`.
- `kind` is one of the 11 OAS entity kinds: `hmr`, `mhr`, `enr`, `agent`, `tool`, `skill`, `workflow`, `model`, `dataset`, `service`, `agent:instance`. The colon in `agent:instance` is allowed.
- `fingerprint` is a base58btc-encoded BLAKE3 hash of the public key, truncated to 26 bytes. 36 characters long.

The query and fragment are used for proofs and service endpoints and follow the W3C DID Core spec.

Example:

```
did:oas:acme:agent:8hT3k4Pq2mXrY9vWbCdEfGh1JkLmNo
```

Public key recovery is direct: the fingerprint is a hash, not the key itself, so recovering the key requires a resolver lookup. Resolvers are documented in the [OAS SPECIFICATION](../../../forge/oas/oas/docs/oas/SPECIFICATION.md).

## Arsenal Capability Token (ACT) — compact form

ACTs are JWS-like compact tokens:

```
<header>.<payload>.<signature>
```

Each part is base64url without padding. The structure is compatible with JWT parsers for casual inspection but uses Ed25519 (`EdDSA`) exclusively.

**Header** (JSON):

```json
{
  "alg": "EdDSA",
  "typ": "openagent-act",
  "kid": "did:oas:acme:broker:main#sig-2026"
}
```

**Payload** (JSON):

```json
{
  "iss": "did:oas:acme:broker:main",
  "sub": "did:oas:acme:agent:WorkerBot",
  "par": "did:oas:acme:agent:RootBot",
  "aud": ["*"],
  "iat": 1712798000,
  "nbf": 1712798000,
  "exp": 1712884400,
  "scopes": ["openai:chat:invoke", "github:repo:read", "!github:pulls:merge"],
  "lineage": [
    "did:oas:acme:hmr:alice",
    "did:oas:acme:agent:RootBot",
    "did:oas:acme:agent:WorkerBot"
  ],
  "policies": ["acme:default", "acme:after-hours-restrict"],
  "jti": "01JE5XG9R8Q2T4K9ABY"
}
```

**Signature** is over `base64url(header) || '.' || base64url(payload)` using Ed25519 with the broker's signing key.

Fields:
- `iss` — broker DID that minted this token.
- `sub` — agent DID this token authorizes.
- `par` — immediate parent DID.
- `aud` — audience filter; `["*"]` means any service. Otherwise a list of service names.
- `iat`, `nbf`, `exp` — Unix timestamps (seconds).
- `scopes` — array of scopes, including negations (prefix `!`).
- `lineage` — full chain from human root to subject. Verifiers walk this.
- `policies` — policy identifiers evaluated at use time.
- `jti` — ULID unique per token; used for revocation.

Tokens are always under 1 KB in practice.

## Detached signature header

For request signing without a Bearer token, OpenAgent uses two headers:

```
X-OpenAgent-Did: did:oas:acme:agent:WorkerBot
X-OpenAgent-Signature: <base64url-signature>,t=<timestamp>,n=<nonce>
```

The signature is over a canonical string:

```
<method>\n<path-and-query>\n<timestamp>\n<nonce>\n<body-blake3-hex>
```

`body-blake3-hex` is the lowercase hex encoding of BLAKE3 over the raw request body. An empty body hashes to the empty-string BLAKE3. Timestamps older than 300 seconds are rejected. Nonces must be unique within the 300-second window; the SDK tracks them in a bounded LRU.

## Audit log entry

Audit entries are JSON with a stable key order (the chain hash depends on canonical JSON). The canonical form uses UTF-8 encoding, keys sorted lexicographically, no insignificant whitespace, and floats formatted with `ryu`.

```json
{
  "agent_did": "did:oas:acme:agent:WorkerBot",
  "decision": "allow",
  "entry_hash": "blake3:b1e4...",
  "id": "audit:0000017fe7b8c9a3",
  "kind": "credential.fetch",
  "lineage": [
    "did:oas:acme:hmr:alice",
    "did:oas:acme:agent:RootBot",
    "did:oas:acme:agent:WorkerBot"
  ],
  "prev_hash": "blake3:9f2a...",
  "reason": null,
  "request": {
    "byte_count": 1243,
    "method": "POST",
    "url_hash": "sha256:7c..."
  },
  "response": {
    "byte_count": 4118,
    "latency_ms": 824,
    "status": 200
  },
  "scope_held": true,
  "scope_required": "openai:chat:invoke",
  "service": "openai",
  "timestamp": "2026-04-11T08:14:22.431Z"
}
```

`entry_hash` is `blake3(canonical_json_without_entry_hash_field)`. `prev_hash` is the previous entry's `entry_hash` for the same agent, or `"blake3:0000..."` for the genesis entry.

Entry kinds: `auth.attempt`, `auth.success`, `auth.failure`, `scope.check`, `skill.decision`, `credential.fetch`, `delegate.create`, `delegate.revoke`, `wallet.sign`, `wallet.policy`, `policy.evaluate`, `admin.config`, `health.probe`.

## MCP handshake extension

OpenAgent extends the MCP `initialize` request's `clientInfo` with an `openagent` field:

```json
{
  "clientInfo": {
    "name": "claude-desktop",
    "version": "1.0.0",
    "openagent": {
      "did": "did:oas:acme:agent:ClaudeDesktop",
      "act": "eyJhbGciOiJFZERTQSIsInR5cCI6Im9wZW5hZ2VudC1hY3QifQ...",
      "proof": {
        "nonce": "n-0001",
        "signature": "<base64url>",
        "created": "2026-04-11T08:14:22Z"
      }
    }
  }
}
```

The `proof` field is optional. When present, it provides a fresh signature over `("mcp-init", nonce, created, act_jti)` proving the client holds the ACT's private key (not just the token). Servers can require proof for sensitive tool surfaces.

## Scope string format

Scopes are colon-delimited identifiers: `service:resource:action`. Each segment matches `[a-z0-9][a-z0-9\-]*`. A wildcard `*` is allowed in place of a segment. Negation is a leading `!`.

Examples:

- `openai:chat:invoke`
- `github:repo:read`
- `github:*:*` — all GitHub resources, all actions
- `*:*:*` — universal (rarely used)
- `!github:pulls:merge` — explicit negation

The full grammar is in [scope-grammar.md](scope-grammar.md).

## Versioning

Wire formats are versioned by the `typ` field (for ACTs) and the `kind` field (for audit entries). Adding new kinds is a minor-version change; altering an existing field's shape requires a new `typ` value and a migration period. OpenAgent guarantees that a 0.1.x reader accepts all 0.1.x writers for a rolling 12-month window.
