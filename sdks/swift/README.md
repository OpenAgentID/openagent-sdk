# OpenAgentSDK for Swift

Identity and Agent Capability Token (ACT) verification for autonomous
agents on Apple platforms and Linux — verify-first, like the other SDKs.

```swift
let verifier = try ACT.Verifier(
    trustedKeys: [brokerPublicKey],   // raw 32-byte Ed25519 keys
    expectedIssuer: "arsenal:broker:prod-1",
    expectedAudience: "my-service"
)
let claims = try verifier.verify(tokenBytes)
```

Verification follows the normative procedure of
[act/SPECIFICATION.md](https://github.com/OpenAgentID/act) in order:
envelope decode (scoped CBOR decoder owned by this package, vector-gated —
no third-party codec dependency), version/algorithm checks, Ed25519
signature verification (swift-crypto) *before* any claim check, temporal
checks with leeway, and issuer/audience/scope policy with the non-widening
rule.

## The façade

```swift
let agent = try await Agent.create(name: "my-agent")
let session = try await agent.authenticate(baseURL: URL(string: "https://api.example.com")!)
// session.authorizationHeader == "OpenAgent <token>"
```

## Key custody

Everything derives deterministically from one 32-byte seed (Ed25519
signing keypair + X25519 encryption keypair):

```swift
let keys = try Keys.generate()
try Keys.saveSeed(keys, to: seedURL)              // owner-only (0600)
let restored = try Keys.fromSeedFile(seedURL)
// or: Keys.fromEnv("AGENT_SEED_HEX")
```

Swift custody uses HMAC-SHA256 keyed derivation; the canonical cross-SDK
derivation is BLAKE3. Swift custody is self-consistent; seeds moved
to/from Rust/TS/Python custody should use the canonical BLAKE3 derivation.

## Conformance

Gated by the same 13 canonical ACT vectors that gate Rust, TypeScript,
Python, and Go (`conformance/vectors/arsenal/act-verify.json`) — executed
by `VectorTests` on every `swift test` run. The drift rule: Swift verifies
through its own spec-exact implementation, and the vectors prove it agrees
with the canonical crate.

## Add as a dependency

```swift
.package(url: "https://github.com/OpenAgentID/openagent-sdk", from: "0.1.0")
```

(The Swift package lives at `sdks/swift` in the repository; point the
dependency at the package directory.)

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](../../LICENSE-APACHE) or [MIT license](../../LICENSE-MIT), at your option.
