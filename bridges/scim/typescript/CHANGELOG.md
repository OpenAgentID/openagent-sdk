# Changelog

All notable changes to `@openagentid/scim` are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each date is the UTC day npm published that
version.

## [Unreleased]

- Develop and test against `@openagentid/sdk` 0.8.0 and Vitest 4.1.11; CI also tests the package against the SDK built from the same commit.
- Ship the verbatim Apache License, Version 2.0 text in `LICENSE-APACHE`.

## [0.2.1] - 2026-10-17

- Accept `@openagentid/sdk` 0.8.0 beside 0.7.x (peer range `^0.7.2 || ^0.8.0`). No API change: the
  package's typecheck, tests and build are qualified against a packed SDK 0.8.0 as well as the published 0.7.2.

## [0.2.0] - 2026-10-12

- Require actual identity provisioning and authority-backed scope changes. Fail closed on missing authentication/revocation callbacks, retain inactive records for retry and revoke on deactivation. Remove placeholder DIDs/key fingerprints and add current SDK Ed25519 lifecycle tests.
- Atomically reserve usernames before minting identities, enforce uniqueness on store writes and retain ambiguous operations for reconciliation. Add real-key concurrent-router and failed-creation/commit recovery tests; custom stores must implement the reservation contract.
- Validate creation inputs against the installed SDK before invoking its authority; invalid scopes return 400 and release the unused reservation so corrected requests can retry.

## [0.1.1] - 2026-08-01

### Fixed

- Fixed license copyright holder (L1fe Labs, Inc.) and added copyright footers to all READMEs. No functional changes.

## [0.1.0] - 2026-08-01

### Added

- SCIM 2.0 provisioning bridge for OpenAgent (`@openagent/scim`)
- 9 SCIM endpoints: CRUD on `/Users`, plus `/ServiceProviderConfig`, `/Schemas`, `/ResourceTypes`
- OpenAgent agent extension schema (`urn:openagent:scim:1.0:Agent`) with parentDid, conformanceLevel, scopes, lineageDepth, createdVia, keypairFingerprint
- SCIM filter parser supporting `eq`, `ne`, `co`, `sw`, `ew`, `pr`, `gt`, `ge`, `lt`, `le` with `and`/`or` compound filters
- SCIM PATCH operations (`add`, `replace`, `remove`) with extension-prefixed path support
- 1-based SCIM pagination with configurable max page size
- Deprovisioning cascade: DID revocation + delegation tree cascade + Arsenal session invalidation + audit event
- Pluggable storage interface with in-memory default
- Bearer token authentication
- Framework-agnostic WHATWG Request/Response API
- Comprehensive test suite (67 tests)

### Changed

- **Breaking:** the package is `@openagentid/scim`; the source previously used the `@openagent/scim` name, which this project never published because a third party holds the `@openagent` npm scope. Dependency names and imports use `@openagentid/*`.
