# Changelog

All notable changes to `openagent-oidc` (Rust) will be documented in this file.

## [0.1.0] - 2026-04-11

### Added

- `OidcBridge` with three core flows:
  - Flow 1: Human JWT -> Agent DID (derive agent under human lineage)
  - Flow 2: Agent ACT -> Bearer JWT (wrap for OAuth2-only services)
  - Flow 3: RFC 8693 Token Exchange
- Multi-provider support (auto-detects provider from JWT `iss` claim)
- OIDC discovery with per-issuer caching (`.well-known/openid-configuration`)
- JWKS fetching with caching and rotation-aware refresh
- JWT validation (signature, issuer, audience, expiry, clock skew)
- Deterministic HMR identifier derivation from OIDC subject claims
- Scope mapping (OIDC roles/scopes -> Arsenal capability scopes)
- Configuration types with builder pattern and validation
- Comprehensive error types with `thiserror`
