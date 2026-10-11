# OpenAgentID 0.2.0 release contents

Status: candidate; not published. This release uses the existing canonical
`OpenAgentID/openagent-sdk` repository and existing npm package names.

| Package | Published baseline | Candidate | Contents |
| --- | --- | --- | --- |
| `@openagentid/sdk` | 0.1.1 | 0.2.0 | Existing SDK, identity verification API/client, OAS Glyph, verified OATS, `oaid` CLI |
| `@openagentid/oidc` | 0.1.1 | 0.2.0 | Registered-client OIDC provider, signing/discovery/JWKS, PKCE code flow, LifeID owner federation, fail-closed legacy bridge |

Other `@openagentid` packages keep their existing versions. No standalone CLI,
new repository, private hosted-service code, signing key, credential, test
fixture or account data is part of the npm shipment. Each tarball contains
compiled ESM/CommonJS, type declarations, source maps, package metadata,
README, changelog and both license texts. The SDK additionally contains the
Node CLI executable. Release evidence records the full file manifest and hashes
of the exact built tarballs before publication.

## Behavior and migration

- New identities use `did:oas` and default namespace `openagent`. Legacy
  `did:l1fe` remains literal during parsing and signature verification.
- Every successful identity verdict proves key possession, an authorized
  person/org root, signed delegations, current revocation and expiry. Proof
  verification additionally consumes its server-issued challenge atomically.
- Glyphs are deterministic SVGs. `avatarOverride` accepts a changeable HTTPS
  image URL; clearing it restores the identity-derived avatar. The v1 profile
  matches independent upstream Rust vectors. The documented v2 avatar profile
  supports opaque legacy identifiers and does not claim key-payload decoding.
- OATS verifies signed evidence, issuer authority, subject/issuer owner chains
  and revocation before applying the existing five-component scoring contract.
  It supplies the concrete OAS Ed25519Signature2020/JCS verifier and an explicit
  verified adapter boundary for other supported evidence profiles.
- The OIDC provider requires protected real signing keys, rotating cookie
  keys, durable shared storage, registered clients and authoritative verification
  callbacks. ID tokens and UserInfo expose agent DID, kind, owner and lineage.
  Code/PKCE, consent, owner changes, expiry, replay and revocation are enforced.
- LifeID federation accepts a signed human token only for the exact proven
  owner and organization. WorkOS registration and hosted deployment remain
  consumer/operator configuration; this release does not modify either.
- Legacy OIDC derivation and exchange no longer fabricate successful keys,
  DIDs or ACT text. Existing callers must provide real key-custody derivation
  and authorized capability-broker hooks. This is a deliberate migration from
  unsafe 0.1.x success behavior.
- The CLI supplies `oaid verify`, `oaid glyph` and `oaid oidc doctor`. Doctor
  verifies discovery/JWKS configuration and reports the separate login-flow
  requirement; it does not represent a completed agent login.

The useful legacy claim normalization and discovery/CLI behavior from
`l1felabs/openagentid` are consolidated here. Its fixed-seed local acceptance
fixtures and separate private SDK scaffolding are not production identity
authorities and are not republished.

## Release gates

Each PR must have green CI and Iris Core Review at its exact head, routed by
Hans. Qualification includes real generated signing keypairs, an actual HTTP
OIDC issuer/RP code exchange, strict negative cases, independent Glyph vectors,
OAS evidence signatures, and installed-tarball ESM/CommonJS/CLI checks.

Show the exact package file lists, versions and hashes to the user before
publishing. Publish only the reviewed/qualified 0.2.0 artifacts with authorized
npm access. Hosted LifeID federation and Genesis/Blinds consumer acceptance
must be reported separately from an npm library release.
