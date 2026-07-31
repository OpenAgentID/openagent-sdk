# Changelog — openagent-auth-protocol

## [Unreleased] - 2026-07-31

### Changed

- **Breaking. The crate is rebuilt as the transport-agnostic type layer for
  the OpenAgent Core Protocol.** The normative protocol document is
  `openagents/openagent.id/OPENAGENT-CORE-SPEC.md` (abstract messages in
  Section 15); this crate implements it and no longer defines a protocol of
  its own. The identity flow is `IdentityChallenge` -> `IdentityProof` ->
  `IdentityVerified`: an `openagent-challenge-v1` object (64-hex nonce,
  `Z`-suffix seconds timestamp, origin, optional realm), a signature over
  its JCS-canonical (RFC 8785) bytes, and a session-issuing response.
- **Breaking.** The OAAP 4-step mutual-authentication vocabulary is retired:
  `PresentMessage` / `ChallengeMessage` / `ProveMessage` /
  `EstablishedMessage`, the `AuthMessage` tagged union, the embedded lineage
  push, ephemeral key exchange, and BLAKE3 tuple hashing are gone. Lineage
  presentation is deliberately not part of this flow: the agent proves key
  possession and the *server* resolves the DID and evaluates lineage with
  its own trust policy - a protocol that lets the caller push its own proofs
  trades server-side verification for caller-side assertion.
- The two error enums that disagreed with each other (`AuthProtocolError`
  and `OaapError`) - the immediate cause of the crate not compiling at
  all - are unified into a single `AuthProtocolError`.
- The `openagent-http` adapter (Rust) is rebuilt to the same model:
  framework-agnostic challenge/prove handlers, Axum well-known routes, an
  extractor implementing the reactive `401` + `WWW-Authenticate` challenge
  flow, and an HTTP client. The `@openagent/http` TypeScript adapter is
  rebuilt likewise, including a shape-scoped JCS canonicalizer for the
  challenge object.
- `openagent-weave` is marked INFORMATIVE (Phase 2) per the specification;
  it is mid-migration and excluded from CI until its port lands.

## 0.1.0 (2026-04-11)

- Initial release.
- 4-step mutual authentication handshake: PRESENT, CHALLENGE, PROVE, ESTABLISHED.
- Transport-agnostic `AuthTransport` trait for adapter implementations.
- Wire message types (`PresentMessage`, `ChallengeMessage`, `ProveMessage`, `EstablishedMessage`).
- `AuthMessage` tagged union for generic transport dispatch.
- `SessionStore` trait with `InMemorySessionStore` reference implementation.
- `Session` type with state machine (AwaitingProof -> Established -> Closed).
- Handshake utilities: nonce generation, challenge payload (BLAKE3), discovery document builder.
- `ConformanceLevel` (L0/L1/L2) and `DiscoveryDocument` types.
- `AuthProtocolError` hierarchy covering all failure modes.
