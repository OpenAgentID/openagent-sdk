# OpenAgent SDK for Go

Identity and Agent Capability Token (ACT) verification for autonomous
agents. Verify-first: most services never mint an ACT — they verify one.

```go
verifier, err := openagent.NewVerifier(
    [][]byte{brokerPublicKey},      // raw 32-byte Ed25519 keys
    "arsenal:broker:prod-1",        // expected issuer
    "my-service",                   // this service's audience
)
claims, err := verifier.Verify(tokenBytes)
```

Or the fluent shape, mirroring the other SDKs:

```go
claims, err := openagent.Verify(tokenBytes).
    Issuer("arsenal:broker:prod-1").
    ForAudience("my-service").
    RequireScope(scope).
    TrustedKeys(brokerPublicKey).
    Run()
```

## Guarding routes

```go
mux := http.NewServeMux()
mux.Handle("/tools/calendar", openagent.RequireAct(verifier, calendarScope)(handler))
```

A missing, forged, expired, wrong-audience, or under-scoped token gets a
401 with the reason (`WWW-Authenticate: OpenAgent`); the route never runs.
Verified claims are available via `openagent.ClaimsFromRequest(r)`.

## Key custody

Everything derives deterministically from one 32-byte seed (Ed25519
signing keypair + X25519 encryption keypair):

```go
keys, _ := openagent.GenerateKeys()
_ = openagent.SaveSeed(keys, "agent.seed")      // owner-only (0600)
keys, _ = openagent.KeysFromSeedFile("agent.seed")
// or: openagent.KeysFromEnv("AGENT_SEED_HEX")
```

Note: Go custody uses BLAKE2b keyed derivation (the stdlib-adjacent keyed
primitive); the canonical cross-SDK derivation is BLAKE3. Go custody is
self-consistent; seeds moved to/from Rust/TS/Python custody should use the
canonical BLAKE3 derivation.

## Conformance

Gated by the same 13 canonical ACT vectors that gate Rust, TypeScript, and
Python (`conformance/vectors/arsenal/act-verify.json`):

```bash
go run ./cmd/run-vectors ../../conformance/vectors/arsenal/act-verify.json
```

The drift rule: Go verifies through its own spec-exact implementation of
the published format, and the vectors prove it agrees with the canonical
crate — the suite that exists so handwritten implementations never drift
again.

## Install

```bash
go get github.com/OpenAgentID/openagent-sdk-go
```

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](../../LICENSE-APACHE) or [MIT license](../../LICENSE-MIT), at your option.
