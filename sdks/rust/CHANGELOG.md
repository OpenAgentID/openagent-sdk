# Changelog

All notable changes to the `openagent-sdk` Rust crate are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-04-26

### Changed

- Documented `oas-sdk` as the required upstream Sigil-backed lineage verifier contract for privileged OpenAgent sessions, credentials, and scopes. AEGIS and Arsenal consume the OAS result rather than redefining lineage.

### Added

- Added `LineageAuthorityContext` and optional authority attachment on `VerifiedContext`. Callers can now use `require_privileged_authority()` to fail closed unless a production verifier has attached the OAS/Sigil authority result.
- Added `authority_context_from_oas()` to call OAS `verify_privileged_authority()` through resolver/source traits and normalize the result into runtime OpenAgent authority context with subject DID, root DID, path kind, authority source, generation, root kind, scopes, and optional org-root commitment.

## [0.1.0] - 2026-04-11

### Added

- Initial release of `openagent-sdk` — the developer-facing facade for the L1fe
  agent stack.
- `OpenAgent` struct with one-call `create_agent` and `from_parts` constructors.
- `OpenAgentBuilder` for advanced wiring of Arsenal clients, AEGIS plugin
  registries, and custom skill policies.
- `CreateAgentOptions` options bag for the boring 80% case.
- `identity` module wrapping `oas-sdk`:
  - `mint_human_root` for creating fresh HMR identities.
  - `derive_agent` for deriving child entities under a parent keypair.
  - `verify_lineage_chain` for offline lineage verification.
  - `ParsedDid` with `FromStr` / `Display` for ergonomic DID handling.
- `credentials` module wrapping `arsenal-sdk`:
  - `CredentialClient` with `ensure_session`, `request_token`, `get`, and
    `post` helpers.
  - Automatic capability-token base64 encoding for the proxy protocol.
- `verification` module wrapping `aegis-sdk`:
  - `Verifier` with `verify`, `authenticate`, `authorize`.
  - `VerifiedContext` with an `is_valid` convenience method that combines
    signature, lineage, revocation, and liveness status.
- `skills` module providing the `SkillsPolicy` trait, `AllowListPolicy` default
  implementation, and `SkillsPolicyHandle` facade — placeholder for the
  upcoming `openagent-skills-policy` crate.
- `errors::OpenAgentError` unified error type with `From` conversions for
  every wrapped layer (OAS, Arsenal, AEGIS).
- `sync::create_agent` blocking wrapper for CLI tooling.
- 25+ unit tests across modules and a `tests/facade.rs` integration suite that
  exercises the public surface end-to-end against in-memory backends.
- README with quickstart, builder examples, and feature matrix.
