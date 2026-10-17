# Changelog

All notable changes to `create-openagent` are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each date is the UTC day npm published that
version.

## [Unreleased]

- Ship the verbatim Apache License, Version 2.0 text in `LICENSE-APACHE`.
- `npm test` builds the package first (`pretest`), so the suite runs from a clean checkout.

## [0.6.0] - 2026-10-17

- Pin SDK 0.8.0. The family picker lists the One family (coloured discs with one
  bar for an eye) beside the existing families, from the SDK catalog; the real
  signed-request status, expression controls and selected wearables carry over
  when switching to and from it.

## [0.5.3] - 2026-10-12

- Pin SDK 0.7.3 with current component adapters, fresh ACT verification clocks
  and native Request preservation. Keep the existing signed-request and live
  avatar starter flows.

## [0.5.2] - 2026-10-12

- Pin SDK 0.7.2 for brighter family palettes and pigment-preserving plush material;
  retain the real signed-request, receiver and live expression controls.

## [0.5.1] - 2026-10-12

- Pin SDK 0.7.1 for refined glasses and cushioned headphones; retain the existing
  local signer, receiver, live status and appearance controls.

## [0.5.0] - 2026-10-12

- Pin SDK 0.7.0 and expose soft plush/flat finish and on-face/raised eye controls
  across every family, preserving wearables and real verified-request state.
- Keep the persisted signer/receiver, restart/replay/revocation behavior and
  loopback-only transport unchanged; qualify the generated HTTP controls with
  the same packed SDK used by browser acceptance.

## [0.4.0] - 2026-10-12

- Pin SDK 0.6.0 and add combinable glasses/headphones controls that preserve the
  real receiver status, selected character family and animated eye nodes.

## [0.3.0] - 2026-10-12

- Give every starter selector an inset arrow and room for its label, with a
  native-control fallback for forced colors.
- Pin SDK 0.5.0 and populate family/kind choices from its catalog, including all
  holiday families. Keep Autos default, face framing, real verified-request state
  and stable animated eye nodes across appearance changes.

## [0.2.0] - 2026-10-12

- Generate a complete local identity and animated-avatar application using SDK
  0.4.0, real signing keys and issued-challenge verification.
- Add strict CLI parsing, true noninteractive `--yes`, help/version and tests
  of the generated application.
- Breaking pre-1.0 change: replace the incomplete 0.1.x template/deployment
  selectors with the supported default `starter`. Refuse obsolete flags
  explicitly; preserve existing generated projects and legacy template source.

## [0.1.1] - 2026-08-01

### Fixed

- Fixed license copyright holder (L1fe Labs, Inc.) and added copyright footers to all READMEs. No functional changes.

## [0.1.0] - 2026-08-01

- Initial release of `create-openagent` CLI scaffolding tool
- 4 project templates: agent, mcp-server, web-dashboard, full-stack
- Interactive prompts via @clack/prompts
- CLI flags for non-interactive mode (--template, --deploy, --adapter, --bridge)
- Auth adapter selection: HTTP, WebSocket, gRPC
- Enterprise bridge options: OIDC, SCIM
- Deploy target selection: Cloudflare, Vercel, AWS, Docker, Local
- Optional Bioagentic entity classification integration
- Optional Fabrics routing integration
- Shared template files: tsconfig, .gitignore, .env.example
