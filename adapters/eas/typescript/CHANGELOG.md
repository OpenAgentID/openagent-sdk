# Changelog

All notable changes to `@openagentid/anchor-eas` are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each date is the UTC day npm published that
version.

## [Unreleased]

- Develop and test with Vitest 4.1.11; install from the lockfile in CI.
- Ship the verbatim Apache License, Version 2.0 text in `LICENSE-APACHE`.
- Link the npm page to this repository: `repository`, `homepage` and `bugs` in `package.json`.

### Security

- Require zod `^4.6.7` (was `^3.23.8`). zod before 4.6.6 can exhaust memory when it validates an oversized constrained collection (GHSA-mrhx-c7xc-m3w5, high), and no 3.x release carries the fix. Schemas exported by this package are now zod 4 schemas: code that composes them with its own schemas must use zod 4 as well (`z.infer` types are unchanged).

## [0.2.0] - 2026-10-12

- Route native Node imports and requires through the maintained CommonJS dependency path, while preserving browser ESM and matching declarations.
- Require an explicit trusted-attester allowlist; schema and recipient alone do not establish lineage authority.
- Recognize EAS native revocation and expiration, and refuse mismatched subjects, unsafe block numbers and invalid authority data.
- Remove the encoder's Node Buffer requirement and expose the maintained EAS SDK's actual signer type.
- Exercise publish, resolution and native revocation against the released EAS contracts on a real local EVM.

Migration: pass `trustedAttesters` to every `EasAnchorResolver`. Use only addresses your application authorizes to attest lineage roots.
