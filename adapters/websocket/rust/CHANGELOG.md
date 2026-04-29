# Changelog

All notable changes to `openagent-ws` (Rust) will be documented in this file.

## [0.1.0] - 2026-04-11

### Added

- Initial release: WebSocket adapter for the OpenAgent Auth Protocol (OAAP).
- `OpenAgentWsHandler` for server-side 4-step OAAP handshake on accepted WebSocket connections.
- `OpenAgentWsClient` for client-side connect-and-authenticate in one call.
- `AuthenticatedSession` with `send`/`receive` supporting optional AES-256-GCM encryption.
- ECDH (X25519) session key derivation via HKDF-SHA256.
- JSON text frames for the handshake, with typed `PresentFrame`, `ChallengeFrame`, `ProveFrame`, `EstablishedFrame`, and `MessageFrame`.
- Replay protection via monotonically increasing sequence numbers.
- Ed25519 signature verification at both ends of the handshake.
- Per-step configurable handshake timeouts.
- Integration tests: full encrypted handshake, plaintext handshake, multi-message exchange, timeout behavior.
