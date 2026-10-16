# Changelog

## 0.2.1 — 2026-10-15

- Accept `@openagentid/sdk` 0.8.0 beside 0.7.x (peer range `^0.7.2 || ^0.8.0`). No API change: the
  package's typecheck, tests and build are qualified against a packed SDK 0.8.0 as well as the published 0.7.2.

## 0.2.0 — 2026-10-12

- Require actual identity provisioning and authority-backed scope changes. Fail closed on missing authentication/revocation callbacks, retain inactive records for retry and revoke on deactivation. Remove placeholder DIDs/key fingerprints and add current SDK Ed25519 lifecycle tests.
- Atomically reserve usernames before minting identities, enforce uniqueness on store writes and retain ambiguous operations for reconciliation. Add real-key concurrent-router and failed-creation/commit recovery tests; custom stores must implement the reservation contract.
- Validate creation inputs against the installed SDK before invoking its authority; invalid scopes return 400 and release the unused reservation so corrected requests can retry.

## Unreleased

- **Breaking:** package renamed from `@openagent/scim` to `@openagentid/scim`. The `@openagent` npm scope is squatted by a third party; the project now publishes under the `@openagentid` scope, matching the GitHub org OpenAgentID. Consumers must update dependency names and imports. Effective with the first npm publish under the new scope.

## [0.1.1] - 2026-07-31

### Fixed

- Fixed license copyright holder (L1fe Labs, Inc.) and added copyright footers to all READMEs. No functional changes.

## 0.1.0 (2026-04-11)

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
