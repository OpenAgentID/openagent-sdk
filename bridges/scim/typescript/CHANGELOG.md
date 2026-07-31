# Changelog

## Unreleased

- **Breaking:** package renamed from `@openagent/scim` to `@openagentid/scim`. The `@openagent` npm scope is squatted by a third party; the project now publishes under the `@openagentid` scope, matching the GitHub org OpenAgentID. Consumers must update dependency names and imports. Effective with the first npm publish under the new scope.

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
