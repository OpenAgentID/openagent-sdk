# Changelog

## [0.1.0] - 2026-04-11

### Added

- Initial implementation of the Weave/libp2p OAAP adapter.
- `WeaveAuthBehaviour` — libp2p `NetworkBehaviour` for protocol `/openagent/auth/1.0.0`.
- `CborCodec` — length-prefixed CBOR framing implementing `request_response::Codec`.
- `WeaveTransport` — `AuthTransport` implementation bridging OAAP to libp2p via command channel.
- `HandshakeHandler` — orchestrates initiator and responder sides of the 4-step handshake.
- `PeerAuthStore` — thread-safe per-peer authentication state tracking with GC.
- `WeaveAuthConfig` — configurable timeouts, max message sizes, session TTL.
- Full integration test: 4-step handshake over libp2p in-memory transport.
- Error rejection test: responder sends structured error on invalid PRESENT.
