# Changelog

## Unreleased — eyes and label only, 2026-10-13

- Remove the trailing OpenAgentID mark from the Continue as Agent button and
  its stylesheet, including the loading pulse that lived in its space. The
  button is now the dark eye window and the exact label with balanced padding;
  loading remains discernible through `aria-busy`, the progress cursor and the
  eyes thinking, with no dimension change on click. No public API change.

## Unreleased — eyes-only Continue as Agent window, 2026-10-13

- Replace the random character in the button's 32px window with a pair of
  bright live eyes in the dark: the real `@openagentid/sdk` player renders one
  fixed plain character whose body the stylesheet never paints, so no body,
  face silhouette, accessory or colored skin is visible. The random seed now
  only varies eye timing.
- Add idle choreography on a slow timer: the eyes glance around the window,
  tilt and squint through SDK expressions, with bounded wrapper translation
  and tilt so the movement reads at actual size, and natural pauses. They look
  at the viewer on hover or keyboard focus (tracked separately), think while
  `onContinue` runs, and react to success or failure. Idle glances stop under
  reduced motion, in hidden tabs and on dispose; SDK eye-group transforms are
  never overridden.
- Drop the `skin`, `shape`, `finish`, `eyePlacement` and `accessories`
  appearance options and the family-selection exports; `appearance.did` remains.
  The unpublished 0.3.0 version is kept. Review page, verifier and docs updated.

## 0.3.0 — Continue as Agent button and standalone self-hosting, 2026-10-13

- Add `@openagentid/oidc/button`, a framework-neutral browser entry that mounts
  the canonical Continue as Agent control: fixed silhouette, typography, exact
  label and official OpenAgentID mark, with a bounded 32px avatar slot rendered
  by the real `@openagentid/sdk` character generator and live player. Each mount
  draws one random decorative seed and year-round family that stay stable; a
  host may show an already chosen agent without implying authentication.
- The required `onContinue` callback is the only action; it receives the button
  only, never the decorative seed, and the control invents no issuer, redirect,
  state or nonce and makes no network requests. Async callbacks set `aria-busy`,
  ignore duplicate activation, keep the label and dimensions fixed, recover from
  rejection with an accessible status and `onError`, and dispose safely while
  pending. Motion follows the system reduced-motion preference.
- Ship a static `@openagentid/oidc/button.css` with light/dark/auto themes,
  medium/large sizes, full-width, visible focus and a forced-colors outline.
  Declare `@openagentid/sdk` as an optional peer; the browser entry is separate
  from the Node provider graph and is not re-exported through the core entry.
- Add a self-contained review page under `examples/continue-as-agent` and the
  packed-archive Chromium verifier `tools/public-onboarding/verify-button.mjs`.
- Add a regression proving a standalone server with no `lifeId`/`requireLifeId`
  configuration completes the real-key self-rooted PKCE, token, ID token and
  UserInfo flow with zero federation requests. The README now walks through
  that standalone configuration and interaction first, with LifeID federation
  for owned agents as a clearly optional section. Lead the package description
  with self-hosted agent OIDC. Provider protocol behavior is unchanged.
- The button verifier asserts the SDK player's public status/expression mapping
  (`neutral` until a host supplies a status; reasoning, success and error map to
  thoughtful, happy and concerned) and samples real expression transitions.
  `OAID_EXPECTED_SDK_VERSION` lets a registry-consumer run assert the supported
  minimum published SDK instead of the source version; verifier only.

### 0.2.0 self-rooted identity support — 2026-10-11

- Add explicit server opt-in for authoritative self-rooted agent authentication, preserving LifeID authentication for owned identities.
- Publish the root discriminator, self authorization ID/revision and `owner: null` in signed ID tokens and UserInfo; preserve compatibility with historical owned callback results.
- Validate bounded, distinct lineage DIDs and bind every OIDC grant to the original root mode/DID, policy authorization/revision or LifeID owner. Current policy withdrawal, revocation and binding changes deny existing grants.
- Add real-key HTTP issuer/RP flows for self roots, delegated descendants and legacy DIDs, plus current-policy and malformed-root boundary tests. Self login issues no application permissions or tenant membership.

### 0.2.0 qualification correction

- Use the patched Vitest 4.1.11 development runner and coverage tool.
- Accept the existing `agent:instance` DID kind and verify its full RP flow.

## 0.2.0 — 2026-10-11

- Add a maintained OIDC provider adapter with registered clients, real private signing JWKs, discovery/public JWKS, authorization code, mandatory PKCE S256, signed ID tokens and UserInfo.
- Require cryptographic agent possession and signed owner-chain callbacks, authoritative revocation/owner rechecks, durable production storage, persistent grant owner bindings and explicit cookie signing keys.
- Add LifeID human JWT federation through trusted JWKS, exact issuer/audience/expiry checks and proven owner/organization matching; preserve literal legacy DIDs.
- Remove legacy dummy keys, unsigned token responses and fabricated ACTs; require real identity-custody and capability-broker callbacks. Require human JWT audience and expiry and correct the OAS SDK peer range.
- Add real RSA/Ed25519 and HTTP relying-party tests covering discovery, code/PKCE, signatures, replay, owner mismatch and revocation. Node minimum is 20.19; production hosting/LifeID registration is a consumer deployment responsibility.


All notable changes to `@openagent/oidc` (TypeScript) will be documented in this file.

## [Unreleased]

### Changed

- **Breaking:** package renamed from `@openagent/oidc` to `@openagentid/oidc`. The `@openagent` npm scope is squatted by a third party; the project now publishes under the `@openagentid` scope, matching the GitHub org OpenAgentID. Consumers must update dependency names and imports. Effective with the first npm publish under the new scope.

## [0.1.1] - 2026-07-31

### Fixed

- Fixed license copyright holder (L1fe Labs, Inc.) and added copyright footers to all READMEs. No functional changes.

## [0.1.0] - 2026-04-11

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
