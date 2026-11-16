# Changelog

All notable changes to `@openagentid/sdk-testing` are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each date is the UTC day npm published that
version.

## [Unreleased]

- Develop and test against `@openagentid/sdk` 0.8.0 and Vitest 4.1.11; CI also tests the package against the SDK built from the same commit.
- Ship the verbatim Apache License, Version 2.0 text in `LICENSE-APACHE`.
- Link the npm page to this repository: `repository`, `homepage` and `bugs` in `package.json`.

### Security

- Require zod `^4.6.7` (was `^3.23.8`). zod before 4.6.6 can exhaust memory when it validates an oversized constrained collection (GHSA-mrhx-c7xc-m3w5, high), and no 3.x release carries the fix. Schemas exported by this package are now zod 4 schemas: code that composes them with its own schemas must use zod 4 as well (`z.infer` types are unchanged).

## [0.1.3] - 2026-10-17

- Accept `@openagentid/sdk` 0.8.0 beside 0.7.x (peer range `^0.7.2 || ^0.8.0`). No API change: the
  package's typecheck, tests and build are qualified against a packed SDK 0.8.0 as well as the published 0.7.2.

## [0.1.2] - 2026-10-12

- Support current SDK ^0.7.2 with installed-package typechecking and runtime fixture tests; retain explicit test-only imports and stub-token boundary.
