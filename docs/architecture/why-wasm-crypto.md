# Crypto implementations and conformance

The public TypeScript developer path does not require a WASM package. Local
Ed25519 custody/signing uses jose and Node cryptography; portable identity proof
verification uses jose/native crypto; avatar hashing/rendering uses public
JavaScript modules. The browser player is a self-contained ESM bundle.

## The optional shared crypto surface

`crates/openagent-crypto-wasm` compiles Rust primitives and ACT verification to
WebAssembly for consumers that explicitly select that integration. The
TypeScript ACT facade requires an initialized compatible binding through
`setActCryptoBinding`; key helpers have their separate `setKeyCryptoBinding`
contract. Missing bindings fail closed. Installing the base SDK or supplying an
endpoint does not initialize those integrations automatically.

The Rust ACT path uses its canonical protocol dependencies natively. It does
not load a browser WASM module. Other language modules also have their own actual
runtime/dependency requirements; identical package versions or API names are not
proof of identical behavior.

## What establishes parity

The repository's [conformance suite](../../conformance/) compares supported
verification behavior against shared vectors. Cryptographic primitives and wire
formats still require exact canonical serialization, key/algorithm checks,
issuer/audience binding, time rules and trust policy. Sharing a primitive does
not remove those requirements.

Use the relevant module's build/initialization instructions when selecting an
optional crypto integration. Do not substitute a signature stub when a binding
or private dependency is unavailable. The public
[developer-tooling path](../developer-tooling.md) is the supported first-run
route using only public npm dependencies.

No performance or audit certification is implied by this page. Benchmark claims
must identify the actual artifact, runtime, input and retained measurements.
