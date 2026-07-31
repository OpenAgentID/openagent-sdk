# Changelog

All notable changes to the `openagent-sdk` Rust crate are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-04-26

### Added

- **Verify-first ACT surface** (`act` module). `act::verify(&token).issuer(...).for_audience(...).require_scope(...).trusted_keys(...).run()` wraps the canonical `agent-capability-token` verifier in the SDK's fluent style; every rule lives in the canonical crate. With the `axum` feature, `act::axum_support::ActPolicy` + `ActContext` extractor guard Axum routes: a missing, forged, expired, wrong-audience, or under-scoped token gets a 401 with `WWW-Authenticate: OpenAgent` and the route never runs.

### Changed

- **Breaking. The `aegis` / `arsenal` / `full` Cargo features are real now.**
  They were no-ops that always linked every wrapped SDK; declaring
  `features = ["arsenal"]` changed nothing. The features now gate both the
  dependencies and the modules: a build without them neither compiles
  `credentials` / `verification` nor links the crates, so a verifier-only
  consumer pays for nothing it does not use. `OpenAgent::from_parts` takes
  the gated parameters conditionally, the builder's `with_arsenal_client` /
  `with_aegis_*` setters exist only with their features, and calls into a
  disabled subsystem fail closed with a config error. CI verifies both the
  default and all-features configurations; facade integration tests require
  `--all-features`.
- **Breaking.** Arsenal dependencies pin to `^2.0.0`. Arsenal 2.0 requires an
  OAS DID for agent identities (`AgentIdentityLoader` constructors take the
  DID as their first argument) and mints the canonical ACT wire format; test
  fixtures and any consumer constructing identities must construct the DID
  first. `oas-did` joins the dev-dependencies for exactly that.
- **Breaking.** The AEGIS dependencies are renamed to `openagent-aegis-core`
  and `openagent-aegis-sdk`, tracking the upstream rename (the bare names are
  taken on crates.io by unrelated third parties). The public re-export
  changes with them: `openagent_sdk::aegis_sdk` is now
  `openagent_sdk::openagent_aegis_sdk`, and `use aegis_*::` paths become
  `use openagent_aegis_*::`. The peer TypeScript packages move under the
  `@openagent` scope as `@openagent/oas-sdk`, `@openagent/arsenal-sdk`, and
  `@openagent/aegis-sdk`, replacing the broken `@oas/sdk` peer declaration
  (a package that never existed) and the `@arsenal/sdk` / `@aegis/sdk`
  names.
- Updated repository metadata and git dependencies to target the
  `OpenAgentID` GitHub organization for source-based installs. Those
  repositories are private during the identity-stack consolidation, so an
  install resolves only for callers whose git credentials carry organization
  access.
- Documented `oas-sdk` as the required upstream Sigil-backed lineage verifier contract for privileged OpenAgent sessions, credentials, and scopes. AEGIS and Arsenal consume the OAS result rather than redefining lineage.
- Added explicit OAS, Arsenal, and AEGIS git dependency versions so Cargo
  package staging can validate the Rust SDK manifest while retaining
  source-based installs from the OpenAgentID repositories.
- Verification: `cargo package --allow-dirty --no-verify` now reaches the
  expected crates.io availability check for `aegis-core ^0.2.0`, and
  `cargo check` passes.

### Known issues

- The `cargo package` check above is where a naming collision will bite. A
  publish resolves every dependency from a registry, and `aegis-core`,
  `aegis-policy` and `aegis-sdk` are already taken on crates.io by unrelated
  third parties. Publishing this SDK as written would resolve `aegis-core`
  against a foreign crate, so those three names must be changed before any
  release, and `cargo add aegis-*` must never appear in documentation.

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
