# Security Policy

## Reporting a vulnerability

Report suspected vulnerabilities privately. Do not open a public issue for an
unpatched vulnerability.

- **GitHub:** this repository's **Security** tab → **Report a vulnerability**
  opens a private advisory visible only to you and the maintainers.
- **Email:** <security@openagent.id>.

Include the affected package and version (or commit), the impact and the
security boundary it crosses, minimal reproduction steps or a proof of concept,
and any disclosure constraints or known exploitation. Never send private keys,
production credentials or personal data unless the maintainers arrange a secure
transfer.

We acknowledge reports within 3 business days and provide a remediation plan or
a reasoned rejection within 14. We coordinate disclosure timing and researcher
credit once a fix is available, and publish fixed versions through the release
workflow described in [docs/RELEASING.md](docs/RELEASING.md).

## Supported versions

Security fixes ship in the latest release of each package in the release set
(`@openagentid/sdk` and its companion packages, see the
[README](README.md#packages)). Upgrade to the latest release to receive them.

## Scope

This repository builds identity and credential infrastructure. The following
are always in scope and treated as high severity:

- Forgery or bypass of token signatures, lineage proofs, or verification steps
- Errors that let a verifier accept a malformed, expired, revoked, wrong-audience
  or under-scoped token
- Disclosure of private key material, seeds, or credentials
- Authorization or tenant-isolation bypasses
- Vulnerabilities in dependencies with a reachable exploit path

Reports about third-party services, social engineering, or denial of service
that requires excessive traffic are out of scope.

## Verifying a release

Releases from 0.8.1 on are published from GitHub Actions with npm provenance:
`npm view @openagentid/sdk@<version> dist.attestations` names this repository,
the release workflow and the commit, and `npm audit signatures` checks the
attestations of an installed tree. Each GitHub release attaches the npm tarballs
and their integrity hashes.

## Cryptographic notice

Signing and verification use Ed25519; hashing uses BLAKE3; CBOR is used for
wire encoding. If you believe you have found a weakness in how these are
composed, please include a proof-of-concept against the conformance vectors
where possible - it shortens triage considerably.
