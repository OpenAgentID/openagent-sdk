# Changelog

## 0.1.0 (2026-04-11)

### Added

- SCIM 2.0 provisioning bridge trait definitions (`openagent-scim`)
- `ScimProvisioner` trait with create, replace, update, deprovision, find, list
- `AgentStore` trait for pluggable storage
- Deprovisioning hook traits: `DidRevoker`, `DelegationCascadeRevoker`, `ArsenalSessionInvalidator`
- `AuditSink` trait for lifecycle event emission
- SCIM resource types: `ScimAgentResource`, `ScimListResponse`, `ScimErrorResponse`
- OAS Agent <-> SCIM User mapping functions
- DID derivation, keypair fingerprint derivation, lineage depth computation
- 10 unit tests for mapping and type functions
