# OpenAgent SDK for Kotlin

Identity and Agent Capability Token (ACT) verification for autonomous
agents on the JVM — verify-first, like the other SDKs.

```kotlin
val verifier = Act.Verifier(
    listOf(brokerPublicKey),          // raw 32-byte Ed25519 keys
    "arsenal:broker:prod-1",          // expected issuer
    "my-service",                     // this service's audience
)
val claims = verifier.verify(tokenBytes)
```

Verification follows the normative procedure of
[act/SPECIFICATION.md](https://github.com/OpenAgentID/act) in order:
envelope decode (scoped CBOR decoder owned by this package — no codec
dependency), version/algorithm checks, Ed25519 signature verification
(JDK EdDSA) *before* any claim check, temporal checks with leeway, and
issuer/audience/scope policy with the non-widening rule.

## Guarding Ktor routes

```kotlin
install(ActAuth) {
    verifier = myVerifier
    scopes = listOf(Scope.parse("tools:calendar:invoke"))
}
```

A missing, forged, expired, wrong-audience, or under-scoped token gets a
401 with the reason (`WWW-Authenticate: OpenAgent`); the route never runs.
Verified claims land in `call.attributes[ActClaimsKey]`.

## Key custody

Everything derives deterministically from one 32-byte seed (Ed25519
signing keypair + X25519 encryption keypair, public derivation via
BouncyCastle):

```kotlin
val keys = Keys.generate()
Keys.saveSeed(keys, seedPath)              // owner-only (0600)
val restored = Keys.fromSeedFile(seedPath)
// or: Keys.fromEnv("AGENT_SEED_HEX")
```

Kotlin custody uses SHA-256 keyed derivation; the canonical cross-SDK
derivation is BLAKE3. Kotlin custody is self-consistent; seeds moved
to/from Rust/TS/Python custody should use the canonical BLAKE3 derivation.

## Conformance

Gated by the same 13 canonical ACT vectors that gate Rust, TypeScript,
Python, Go, and Swift (`conformance/vectors/arsenal/act-verify.json`) —
executed by `VectorTest` on every `./gradlew test` run. The drift rule:
Kotlin verifies through its own spec-exact implementation, and the vectors
prove it agrees with the canonical crate.

## Use

```kotlin
dependencies {
    implementation("id.openagent:openagent-sdk:0.1.0")
}
```

Build and test:

```bash
./gradlew build
```

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](../../LICENSE-APACHE) or [MIT license](../../LICENSE-MIT), at your option.
