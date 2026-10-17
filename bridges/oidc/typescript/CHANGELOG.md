# Changelog

All notable changes to `@openagentid/oidc` are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each date is the UTC day npm published that
version.

## [Unreleased]

- Accept `@openagentid/sdk` 0.8.0 beside 0.7.x in the optional SDK peer range (`^0.7.2 || ^0.8.0`).
  No API change; typecheck, tests and both builds are qualified against a packed SDK 0.8.0 too.
- Develop and test against `@openagentid/sdk` 0.8.0.
- Ship the verbatim Apache License, Version 2.0 text in `LICENSE-APACHE`.

## [0.3.0] - 2026-10-13

The Continue as Agent button and standalone self-hosting.

- Add `@openagentid/oidc/button`, a framework-neutral browser entry that mounts
  the canonical Continue as Agent control: fixed silhouette, typography and the
  exact label, with balanced padding around a dark 32px window. In the window
  the real `@openagentid/sdk` player renders a pair of bright live eyes: one
  fixed plain character whose body the stylesheet never paints, so no body, face
  silhouette, accessory or colored skin is visible. The random seed varies only
  the eye timing. `appearance.did` lets a host show an already chosen agent
  without implying authentication.
- The eyes move on a slow timer: they glance around the window and tilt and
  squint through SDK expressions, with bounded wrapper translation and tilt so
  the movement reads at actual size, and natural pauses. They look at the
  viewer on hover or keyboard focus (tracked separately), think while
  `onContinue` runs, and react to success or failure. Idle glances stop under
  reduced motion, in hidden tabs and on dispose; SDK eye-group transforms are
  never overridden.
- The required `onContinue` callback is the only action; it receives the button
  only, never the decorative seed, and the control invents no issuer, redirect,
  state or nonce and makes no network requests. Async callbacks set `aria-busy`
  and the progress cursor, ignore duplicate activation, keep the label and
  dimensions fixed, recover from rejection with an accessible status and
  `onError`, and dispose safely while pending.
- Ship a static `@openagentid/oidc/button.css` with light/dark/auto themes,
  medium/large sizes, full-width, visible focus and a forced-colors outline.
  Declare `@openagentid/sdk` as an optional peer (`^0.7.2`); the browser entry
  is separate from the Node provider graph and is not re-exported through the
  core entry.
- Add a self-contained review page under `examples/continue-as-agent` and the
  packed-archive Chromium verifier `tools/public-onboarding/verify-button.mjs`.
  The verifier asserts the SDK player's public status/expression mapping
  (`neutral` until a host supplies a status; reasoning, success and error map to
  thoughtful, happy and concerned) and samples real expression transitions.
  `OAID_EXPECTED_SDK_VERSION` lets a registry-consumer run assert the supported
  minimum published SDK instead of the source version; verifier only.
- Add a regression proving a standalone server with no `lifeId`/`requireLifeId`
  configuration completes the real-key self-rooted PKCE, token, ID token and
  UserInfo flow with zero federation requests. The README walks through that
  standalone configuration and interaction first, with LifeID federation for
  owned agents as an optional section. Provider protocol behavior is unchanged.

## [0.2.0] - 2026-10-11

- Add a maintained OIDC provider adapter with registered clients, real private signing JWKs, discovery/public JWKS, authorization code, mandatory PKCE S256, signed ID tokens and UserInfo.
- Require cryptographic agent possession and signed owner-chain callbacks, authoritative revocation/owner rechecks, durable production storage, persistent grant owner bindings and explicit cookie signing keys.
- Add LifeID human JWT federation through trusted JWKS, exact issuer/audience/expiry checks and proven owner/organization matching; preserve literal legacy DIDs.
- Remove legacy dummy keys, unsigned token responses and fabricated ACTs; require real identity-custody and capability-broker callbacks. Require human JWT audience and expiry and correct the OAS SDK peer range.
- Add real RSA/Ed25519 and HTTP relying-party tests covering discovery, code/PKCE, signatures, replay, owner mismatch and revocation. Node minimum is 20.19; production hosting/LifeID registration is a consumer deployment responsibility.
- Use the patched Vitest 4.1.11 development runner and coverage tool.
- Accept the existing `agent:instance` DID kind and verify its full RP flow.

### Self-rooted identity support

- Add explicit server opt-in for authoritative self-rooted agent authentication, preserving LifeID authentication for owned identities.
- Publish the root discriminator, self authorization ID/revision and `owner: null` in signed ID tokens and UserInfo; preserve compatibility with historical owned callback results.
- Validate bounded, distinct lineage DIDs and bind every OIDC grant to the original root mode/DID, policy authorization/revision or LifeID owner. Current policy withdrawal, revocation and binding changes deny existing grants.
- Add real-key HTTP issuer/RP flows for self roots, delegated descendants and legacy DIDs, plus current-policy and malformed-root boundary tests. Self login issues no application permissions or tenant membership.

## [0.1.1] - 2026-08-01

### Fixed

- Fixed license copyright holder (L1fe Labs, Inc.) and added copyright footers to all READMEs. No functional changes.

## [0.1.0] - 2026-08-01

### Added

- `OidcBridge` class with three core flows:
  - Flow 1: Human JWT -> Agent DID (derive agent under human lineage)
  - Flow 2: Agent ACT -> Bearer JWT (wrap for OAuth2-only services)
  - Flow 3: RFC 8693 Token Exchange
- Multi-provider support with auto-detection from JWT `iss` claim
- Single-provider shorthand constructor
- OIDC discovery with per-issuer caching
- JWKS fetching with caching and rotation-aware refresh
- JWT validation via `jose` (runtime-agnostic: Node, Bun, Deno, browsers, Workers)
- Deterministic HMR identifier derivation from OIDC subject claims
- Scope mapping (OIDC roles/scopes -> Arsenal capability scopes)
- Zod schema validation for all configuration and request types
- Comprehensive error types with error codes

### Changed

- **Breaking:** the package is `@openagentid/oidc`; the source previously used the `@openagent/oidc` name, which this project never published because a third party holds the `@openagent` npm scope. Dependency names and imports use `@openagentid/*`.
