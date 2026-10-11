# Changelog

## 0.2.0 — release candidate, 2026-10-11

- Add a signing OIDC provider adapter with registered relying parties, S256
  PKCE, discovery/JWKS and LifeID owner federation; remove successful
  placeholder exchange/key derivation behavior from the existing bridge.
- Add signature, signed owner-chain, revocation and replay verification,
  a framework-neutral HTTP handler, remote SDK client and `oaid verify` CLI.
  Bind remote verdict DID and expiry to the submitted challenge proof.
- Add deterministic OAS Glyph SVG avatars/endpoint and a changeable HTTPS
  avatar override. Read legacy `did:l1fe` identities without rewriting them;
  default new namespaces to `openagent`.
- Add mandatory verified OATS ingestion, strict evidence validation and the
  reference five-component score/90-day decay/confidence algorithm, with a
  concrete OAS Ed25519/JCS evidence verifier.
- Add independent upstream Rust Glyph conformance vectors and locked SDK/OIDC
  CI on Depot; retain the existing language and cryptographic conformance gates.
  Keep direct Git installs consistent with the SDK dependencies and CLI.
  Run the installed CLI through npm's symlink and require command output and
  refusal exit codes during artifact qualification.
  Repair Swift setup, remove unnecessary private-auth gates and pin conformance
  OAS dependencies to the existing canonical SDK Git revision.
- Consolidate the useful legacy claim/discovery/CLI behavior into this
  canonical repository and document the free Open Software core versus Life's
  hosted integration boundaries. Production authorities, hosted acceptance,
  exact-head CI/review and npm publication remain release gates.
