# Why a WASM Crypto Core

OpenAgent ships its crypto in a single WebAssembly module compiled from Rust. Both the TypeScript and Rust SDKs call into the same module (the Rust SDK skips the wasm-bindgen layer and links natively, but the source is identical). This page explains why — and why it's not "just because Rust is cool."

## The problem we're solving

OpenAgent needs to produce and verify identity material across runtimes. Today the public facade is Rust and TypeScript. Future bindings can graduate only if they reuse the same audited primitives and conformance vectors. We need a cryptographic implementation that:

1. **Produces identical bytes on every platform.** A DID fingerprint is a hash of a public key; if one implementation does the hash slightly differently, DIDs don't round-trip between languages. This is a hard correctness requirement, not a nice-to-have.
2. **Is auditable.** The crypto is the root of trust. If every binding ships its own implementation, auditors have to review each one. That's expensive and error-prone.
3. **Is performant everywhere.** Agents make lots of signatures. A 50ms Ed25519 sign from a slow implementation adds up quickly.
4. **Is pure.** No C dependencies, no OpenSSL drift, no "works on my platform" linker surprises.

A WASM core solves all four.

## Why not pure JavaScript?

The first thing you try is "just use `@noble/ed25519` or the WebCrypto API." Both are excellent libraries and for many projects they're the right answer. They're not the right answer here for three reasons:

1. **Parity.** The Rust SDK would still need its own implementation. Now you have two implementations to audit and two chances to diverge on an edge case. Our goal is exactly one.
2. **Performance.** Ed25519 in JavaScript is tolerable but not great; BLAKE3 in JavaScript is *slow* compared to native. For agents that produce thousands of signatures per second (common for streaming API calls), the JS implementations become a bottleneck.
3. **Feature coverage.** FROST threshold signatures, HKDF-SHA256 expand operations with specific context strings, and the BLAKE3 keyed-hash mode are not all well-covered in the JS ecosystem. We'd end up stitching together three libraries and writing our own tests for the stitches.

WASM compiled from Rust gives us one codebase, audited once, fast everywhere (WASM Ed25519 benchmarks within 20% of native), with all the primitives we need in one place.

## Why not pure native per platform?

The alternative at the other end is "ship native bindings for each language." Rust for Rust, Go for Go, C++ for Python, etc. This is how libsodium ships. It has its place.

The problem is the matrix. Every platform × every language × every OS × every architecture is a build configuration. Someone breaks the Windows ARM64 build and you find out six weeks later when a user files an issue. Prebuilt binaries help but the distribution story is a nightmare, especially for edge runtimes (Cloudflare Workers, Vercel Edge, Deno Deploy) that can't load native binaries at all.

WASM sidesteps this entirely. One artifact, runs everywhere WASM runs — which, in 2026, is everywhere. Node, browsers, Deno, Bun, Cloudflare Workers, Fastly, iOS via WASMer, Android via WAsm3. The build-and-ship story is "one file, drop it in the package."

## The Rust SDK cheats (sort of)

The Rust SDK does not actually load the WASM module; it compiles the same source code natively and skips the WASM boundary. This gives Rust consumers the full native speed of Ed25519 (around 15μs per sign on modern x86) without the WASM overhead (around 20μs). For the TypeScript SDK, the WASM boundary is the cost of getting the same bytes as Rust produces, and that cost is small enough to be invisible.

The important property is that **the source code is one tree**. The WASM and native builds are two outputs of the same `cargo build`. They are guaranteed to produce identical bytes given identical inputs because they are the same code, minus the FFI glue.

## Audit surface

From an auditor's perspective, OpenAgent's crypto is:

- One Rust crate (`openagent-crypto-wasm`), around 4,000 lines of code.
- Depends on `ed25519-dalek` (audited by Trail of Bits), `blake3` (official BitTorrent implementation, audited), `hkdf` (RustCrypto project, audited), and `frost-core` (audited by NCC Group).
- Compiled to WASM with `wasm-bindgen`, which is widely used and well-understood.
- All primitive choices are well-known and peer-reviewed: Ed25519 (RFC 8032), HKDF-SHA256 (RFC 5869), BLAKE3 (IETF draft), FROST (CFRG draft).

An auditor reads the Rust implementation once and future bindings inherit the same reviewed primitive boundary. Compare that to auditing separate crypto implementations per language and the win is immediate.

## What about WASI and WIT?

OpenAgent's crypto module is not a WASI component; it's a wasm-bindgen module because that's the common-denominator target for JavaScript. The Omega runtime elsewhere in L1fe uses full WASI 0.2 components, but the crypto core doesn't need any system access, so staying on wasm-bindgen keeps the distribution simple.

Future versions may move to WIT / WASI once the component model is ubiquitous across every runtime we target. It's on the roadmap, but it's a footnote — the crypto works fine today.

## Performance numbers

From the `openagent-crypto-wasm` benchmarks (Apple M3 Pro, Node 20):

| Operation | Native Rust | WASM (JS host) | Pure JS (noble) |
|---|---|---|---|
| Ed25519 sign | 15μs | 20μs | 120μs |
| Ed25519 verify | 40μs | 55μs | 210μs |
| BLAKE3 1KB | 1.2μs | 1.8μs | 18μs |
| HKDF-SHA256 | 3μs | 5μs | 22μs |
| FROST 2-of-3 sign | 280μs | 340μs | N/A |

WASM is within 2x of native, and 5-15x faster than pure JS for the primitives OpenAgent uses most. The absolute numbers are all small enough that they're rarely the bottleneck — network latency to a broker dominates by three orders of magnitude — but the parity guarantee is what really matters.

## The tradeoff we accept

WASM is not free. There is a small startup cost to load the module (~10-30ms) and a small memory overhead (~2 MB for the compiled code). We accept these tradeoffs because they're measured in milliseconds and megabytes, not seconds and gigabytes, and in return we get a crypto core that's one codebase, one audit, and byte-identical across every language we ship.

If you're building something where those tradeoffs are unacceptable — an embedded firmware target, a 64 KB memory environment — you can skip the WASM layer entirely and use `openagent-crypto` (the pure Rust crate) directly. It's the same code, without wasm-bindgen.
