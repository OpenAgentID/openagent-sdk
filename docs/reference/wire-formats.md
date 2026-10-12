# Wire-Format Boundaries

OpenAgentID has distinct signed formats. Use the exact implementation and
version for the boundary you verify; do not reinterpret one token as another
because both identify an agent. This page describes the public TypeScript
SDK 0.7.3 and separate OIDC 0.2.0 integration.

| Surface | Wire representation | Verification authority |
| --- | --- | --- |
| Identity possession/delegation | Compact signed JWTs inside `{token, delegations}` | Exact authoritative DID keys/purposes, current root/revocation, issued nonce and atomic replay |
| Canonical ACT | Binary CBOR capability envelope and signed claims bytes | Canonical ACT verifier with trusted issuer/key/audience/time/required-scope policy |
| OIDC | Provider authorization code, signed ID tokens, opaque access tokens and UserInfo | Registered issuer/client keys, PKCE, nonce, current identity binding and provider storage |
| OATS OAS attestation | Signed VC JSON using the supported Ed25519/JCS proof profile | Trusted issuer assertion keys, both current identities and credential revocation |
| Audit receipts | Component-specific record and hash-chain serializer | Host-selected durable custody and trusted checkpoints |

## Exact DIDs

New local identities use `did:oas:<namespace>:agent:<identifier>`. The general
shared validator supports its OAS entity-kind variants and readable legacy
`did:l1fe:<kind>:<identifier>` form. `agent:instance` is a compound kind.
The proof's issuer/subject, key controller and result remain exact literal DIDs;
normalizing a legacy method or deriving a DID from an unrelated ID changes the
principal.

Local `OpenAgentWorkspace` identifies its real Ed25519 key with
`base58(BLAKE3(raw32BytePublicKey)[0:26])` as the identifier, without a multibase
prefix. Other supported opaque DID identifiers need not be this key-derived
form. A key fingerprint is not the recoverable public key; the authoritative
resolver/trust pin provides the actual method.

Proof subject DIDs use the shared validator, not arbitrary DID URLs with query
or fragment. A protected JWT `kid` names an authorized verification-method ID,
which may include its `#` method fragment. Avatar-only compatibility for literal
IAM identifiers does not broaden authentication schemas or create an alias.

## Possession and delegation JWT

The SDK takes `{token: string, delegations: readonly string[]}`. `token` is a
possession JWT; delegations are signed root-first links. A direct approved self
root has an empty chain. All accepted JWTs have protected `alg` (Ed25519/EdDSA
or RSA/RS256) and exact authoritative `kid`, plus required integer Unix
`iat`, `nbf`, `exp` and unique `jti`.

| Field | Possession | Delegation |
| --- | --- | --- |
| Protected `typ` | `oaid-proof+jwt` | `oaid-delegation+jwt` |
| `iss` | Exact agent DID | Exact parent DID |
| `sub` | Same exact agent DID | Exact child DID |
| `aud` | Exact service audience string; arrays refused | Same |
| Key purpose | `authentication` | `capabilityDelegation` |
| Additional possession claims | Receiver-issued `nonce`, `kind: 'agent'` | Not possession evidence |

The verifier checks signed bytes before trusting claims, current root/owner or
self authorization, every delegated lifetime and revocation, then atomically
consumes the issued challenge/proof ID. It never accepts embedded keys or a
caller-selected `jku` as authority. [Full contract](../identity-verification.md).

The Fetch verification handler accepts JSON containing **only** `{proof}`
with `Content-Type: application/json`. The chosen service fixes audience and
resolves the previously issued nonce. It does not derive challenge authority
from an echoed header. Successful `no-store` responses contain `{identity}`;
see the current [verification handler](../../sdks/typescript/src/verification-api.ts).

## Canonical ACT is binary CBOR

The SDK `act.verify(tokenBytes)` receives a `Uint8Array`, not a
`header.payload.signature` JWT. Its actual compiled `act_verify` binding
verifies the canonical ACT envelope's version/algorithm and original signed
claims bytes, then checks time, expected issuer/audience and required scopes.
Supply raw trusted 32-byte Ed25519 public keys and the actual initialized
binding; no unsigned/mock fallback is permitted.

The returned `ActClaims` has `jti`, `sub`, `iss`, `aud`, `iat`, `nbf`, `exp`,
`tenant_id` and `scope`, with optional `cnf`, `delegation` and `ext`. These
JavaScript result names do not define a new JSON signing format. Wildcard
matching belongs to the canonical verifier's grant policy; requests remain
literal. Do not invent wildcard audience acceptance, negation rules or a
universal token-size/interoperability guarantee from an illustrative payload.

Use the [actual TypeScript ACT API](../../sdks/typescript/src/act.ts),
[WASM binding source](../../crates/openagent-crypto-wasm/src/lib.rs),
[canonical ACT repository](https://github.com/OpenAgentID/act) and committed
[conformance vectors](../../conformance/vectors) for byte-level implementation.
An OIDC bridge can transport signed ACT bytes separately (for example encoded
as `actB64`); that does not turn the underlying ACT into a JWT.

## OAS VC and audit records

The concrete OATS verifier supports the OAS `Ed25519Signature2020` baseline:
remove top-level `proof`, JCS serialize the remaining complete credential,
verify Ed25519 `proofValue` encoded as `z`-prefixed base58btc, and enforce
assertion purpose/context/date/ID plus current issuer/subject/revocation.
It is not a universal JSON-LD normalization suite. [Normative profile](../oats.md).

Skills-policy invocation receipts and harness audit records have different
field names, hash algorithms and serialization. Their exact component source
is normative for those records; the unified SDK emits no universal automatic
`credential.fetch`/wallet/compliance schema or signed audit export.
[Audit responsibilities](../guides/audit-and-compliance.md).

## MCP and HTTP are explicit adapters

The repository's separate MCP adapter carries `_meta.openagent.identity` on a
tool call as `{did, proof, nonce?, context?}`; its verifier interprets the
opaque proof under a real host policy. It does not mount an
`OpenAgent.authenticateHandshake` method or define an automatic
`clientInfo.openagent` initialization proof. [Actual integration](../guides/mcp-integration.md).

Older standalone/HTTP adapter sessions use different schemes and storage
contracts. The local starter and Fetch verification handler do not implement a
universal `X-OpenAgent-Signature` detached-request format or in-memory LRU
replay authority. Use the chosen adapter's exact implementation, durable
replay and permission contract. Version compatibility is tested for actual
packages/formats, not guaranteed as an invented rolling window for every
reader/writer.
