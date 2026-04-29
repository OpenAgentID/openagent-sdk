# Changelog — openagent-auth-protocol

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
