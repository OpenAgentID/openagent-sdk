# Changelog

## 0.8.1 — standalone One runtime

- Restore the self-contained One browser entry's 16,384-byte default-gzip gate, preserving all shape, colour, motion and public state functionality. Keep composed source maps with the smallest output from pinned compression profiles.
- Keep the private motion builder in a lexical scope; share lossless catalog path data, presentation intrinsics, held-pose construction and appearance validation. Keep mutable runtime state private to each head and retain deterministic DID-derived looks and seeded helpers.
- Give the standalone browser entry documented compact error codes while preserving validation guards and exception classes; retain descriptive errors in the full SDK.
- Serve the exact standalone module at `/one.js` with the existing CSP and asset-routing rules. Compare every allowed shape/colour and public status against the full renderer in Chromium, including disposal, motion limits and reduced motion.

## 0.8.0 — the One family, 2026-10-15

- Add the opt-in `one` character family: fourteen fun shapes (`star`, `heart`,
  `flower`, `cloud`, `droplet`, `squircle`, `diamond`, `clover`, `gumdrop`,
  `hexagon`, `egg`, `blob`, `peanut`, `bean`) in eighteen contrast- and
  colour-vision-gated agent colours (`color`), plus `charcoal` (Digital One, the
  black circle), every head with one bar for an eye drawn only from agent-eye
  geometry with its own eye style `agent-eye-v1`. The shapes, their eye
  placements, pivots, temperaments, default colours and never lists, and the
  palette are generated from the pinned Ones' library (`shapes.json` sha256
  894f801c…1767, `palette.json` 76fa2016…c991), never edited by hand. A DID
  selects a shape and a colour when no look is stored (`oneLookForDid`,
  `oneShapeForDid`, `oneColorForDid`); `nextOneLook(held, { group })` fills a
  team with the next free shape in its own colour, then free colours in team
  order, then the least held, in another group first; `getOneShapes`,
  `getOneColors`, `ONE_SHAPE_ORDER`, `ONE_DIGITAL`, `isOneShape`, `isOneColor`,
  `isOneKind` and `isOneColorAllowed` expose the library. The eleven never pairs
  (a shape in a colour that reads as a sign) are refused in options, stored
  appearance, identity documents, the light entry, the CLI and the HTTP API,
  never changed; `CharacterAppearance` gains `color` for the One family only, and
  a stored colour needs its shape. Autos stays the default; every existing
  family, kind, colour, stored profile and DID seed renders exactly as in 0.7.3.
- Draw Digital One as the black circle `#141b16` on every surface: the eye cut
  out to the surface on light; a chalk eye and a chalk rim at 44 % (1 CSS px
  inside the edge, 2 px from 96 px, never a device pixel) on dark. No agent is a
  circle and no agent is black. Each agent colour is one value on light and dark
  surfaces, with no dark tones; the line comes from the disc (paper on the six
  deep colours, ink on the twelve bright ones, at 4.5:1 or more) and a keyline in
  the colour's own hue is drawn on light surfaces only, exactly where the disc
  alone falls under 3:1, as an exact inset of the outline, never a clip. The
  shape's temperament paces its moves; the body squashes and hops about the
  shape's pivot; the eye is placed and limited by the library, holds a wide eye
  level in an agent shape, and stays at least ten units inside every shape in
  every frame of every move; no One shows a smile or mouth line at 24 px or
  smaller.
- List eye styles per family in the catalog (`live-v1` on the two-eyed families,
  `agent-eye-v1` on One) and refuse a style that belongs to another family in
  options, stored appearance, identity documents, the HTTP API and OpenAPI.
- Map the shared status timeline to One faces and moves: working reads along,
  reasoning glances up and ponders, typing taps, attention looks at the viewer,
  success smiles with a happy squint (40 px and up) or nods, paused dozes (a lid
  and slumped body at 64 px and up), error goes dizzy, speaking talks with an
  opaque mouth line under a full smile from an optional voice level. Idle with no
  content direction is the warm face, so needs-you is the only face that looks
  straight out. A blink at the viewer shuts tilted, never as a level bar. Every
  move withdraws a visible smile line before it moves the eye.
- Render One heads from 16 px (every other family keeps 32 px) in the SDK,
  animator, player, CLI and HTTP API, with the plan's size tiers.
- Render a decorative still glyph for servers, images and reduced motion, with
  no element identifiers: Digital One's eye is cut out of its disc with the
  even-odd rule. Stills carry `data-one-shape` and `data-one-color` for
  forced-colours styles and keep finish, eye placement and accessories in the
  descriptor without drawing them.
- Run live One heads on one shared, sleeping animation-frame ticker per window
  with one IntersectionObserver and one ResizeObserver: nothing moves at rest or
  out of view, one head per list and three per window move at once, ongoing work
  moves for at most five seconds in lists (`cadence: 'brief'`, each cluster
  measured first) or in clusters in headers (`cadence: 'repeat'`), and reduced
  motion holds every face still. Repaints never advance a move, so a head is
  never stranded as moving. `follow: true` lets an eye follow a fine pointer
  without counting as a move; a head takes over a still One rendered in its
  element. The animator exposes `frame.one` for DOM-free renderers.
- Add the light entry `@openagentid/sdk/one` (`renderOne`, `mountOne`, the shape
  and colour helpers) and `@openagentid/sdk/browser/one`, the live runtime alone
  with no DID hashing, and blank heads for ready-made agents (drawn in the
  shape they will get) and their First blink. `npm run size` enforces 16,384
  default-gzip bytes for the complete standalone One entry and 65 KB for the
  all-family browser bundle. Both entries include source maps.
- Add `typing`, `attention`, `paused` and `offline` statuses for every family,
  `theme: 'light' | 'dark'` and `label` rendering options, and `--theme` in the
  CLI. The HTTP API accepts `theme` (never `label`); OpenAPI 0.8.0 documents the
  family, its kinds and colours, its eye style, sizes, statuses and theme.
- Port agent-eye's pure geometry and motion to TypeScript with its provenance:
  the master (sha256 83cc379a…bba4), written by JR and contributed by its copyright
  holder L1fe Labs, Inc. under Apache-2.0 OR MIT, is a byte-identical test
  fixture; the port is compared with it and its containment check runs over
  every held face and every frame of every move, from every face and when a move
  cuts a smile or talk short.
- Compatibility: SDK 0.7.3 and earlier reject identity documents whose
  `avatarSkin` uses skin `one` or eye style `agent-eye-v1` (`IDENTITY_RESOLVE_FAILED`).
  Keep One looks (`{ shape, color }`) in the application's own agent records
  until every reader upgrades.
- Pin create-openagent 0.6.0 to SDK 0.8.0; its family picker lists One, and the
  public onboarding verifier checks the One family in the generated starter.
- One heads take gestures from their host: `play(gesture, { viewer? })` on the
  light entry's player plays `lookAtYou`, `nod`, `smile`, `wave`, `shrug` or
  `popIn` and returns to the held face, for arrivals (which take a motion slot,
  and wait up to 1.5 s for a head that is not yet in view) and a hero's tap ladder
  (`viewer: true`, at once). Nothing plays under reduced motion or out of view,
  and a head that needs the viewer only looks at them or nods.
- Typing repeats in headers and heroes like every ongoing state, one cluster every
  six to ten seconds, instead of back to back.
- One mover per group now holds without exception. A dropped move no longer
  glides to the held face beside the head that kept it waiting: it switches
  straight to it, one held face per group at a time. A cadence cut short keeps
  its slot while it settles. The viewer's own acts (a tap, a new colour, First
  blink) still skip the window's cap but wait for their group, so agents added
  together blink open one at a time. The next move in a group starts a beat
  (about 100 ms) after the last one ends, never in the same frame.
- The palette gates are the library's: every line at 4.5:1 or more on its disc,
  every disc or keyline at 3:1 or more on the four light surfaces and every disc
  at 3:1 or more on the six dark surfaces of the One app and website, and every
  colour at least CIEDE2000 25 from Digital One, 18 from One Humanoid's amber,
  12 from its glow and from the needs-you green, 10 from danger, from Google's
  logo, Material, 2014–15 and 2015 logo colours and from every other agent
  colour. The smallest colour-vision distance among Digital One and the first
  five colours is 17.4; the first eight and twelve keep 10.7 and 4.9. The HTTP API
  and OpenAPI 0.8.0 accept `color` and return `oneColor` on One descriptors; the
  CLI takes `--color`; the public onboarding verifier renders the shapes live.
  The hosted demo (`services/character-api/demo.*`) names the One kinds as
  people see them (Square, Drop, Digital One) and adds a colour control that
  offers only the colours the shape in use allows, passed to the player, the
  query and the body; its service test covers the kinds, the colours and the
  refusals over HTTP.

## 0.7.3 — current package compatibility, 2026-10-12

- Restore deterministic X25519 public keys from seeds with real WASM bindings;
  expose public-from-secret and retain recovery compatibility with 0.1.1's
  RFC 7748 base-point operation. Remove the random-key recovery fallback.

- Require Node 20.19+ to match abort-signal and integration runtime support.

- Read the receiver clock on every ACT verification; keep compatibility with
  crypto-wasm 0.1.1 and fix the WASM default clock in crypto-wasm 0.1.2.
- Preserve native Request method, headers, body and cancellation in credential
  proxy calls; align the exported SDK VERSION with its package version.
- Add explicit adapters for the shipped OAS, Arsenal, AEGIS and skills-policy
  contracts, with real-package integration examples and required trust context.
- Release HTTP, MCP, Claude hooks, SCIM and EAS 0.2.0 integrations with current
  SDK support, authenticated flows and fail-closed revocation/replay behavior.
  HTTP now requires authoritative key resolution and atomic nonce admission;
  EAS requires trusted attesters; SCIM requires actual identity provisioning.
- Update sdk-testing 0.1.2 and create-openagent 0.5.3; preserve Autos as the
  default, SpaceX and all existing families, colors, accessories and live state.
- Replace placeholder deployment handlers with complete ACT receivers and
  executable examples; add packed-package checks against SDK 0.7.2 and 0.7.3.
  OIDC 0.2.0 keeps its API and gains a full current-SDK authentication test.

## 0.7.2 — brighter character collection, 2026-10-12

- Repaint all 17 families / 62 kinds with brighter curated pigments and coordinated
  accents; preserve each family's silhouette, seasonal meaning and live eyes.
- Restore 35% of original pigment after plush lighting for clearer color on bodies
  and raised eye pods. Flat rendering uses the same updated family paints.
- Intentionally update rendered RGB values while retaining DID seeds, shape
  selection, geometry, expression state, accessories and avatar overrides.
- Pin create-openagent 0.5.2 to SDK 0.7.2; document the shared visual language and
  future person/mascot design direction. OIDC remains 0.2.0.

## 0.7.1 — refined character accessories, 2026-10-12

- Lighten glasses rims and temples, add subtle hinges, and give headphones a
  slimmer band with layered soft cushions and restrained highlights.
- Preserve fixed lens dimensions, eye-following frames, head-side connections,
  external headphone fit and stable face crops across every family and eye mode.
- Pin create-openagent 0.5.1 to SDK 0.7.1. Appearance, identity, animation and
  authentication contracts are unchanged; OIDC remains 0.2.0.

## 0.7.0 — shared character material and head-fitted accessories, 2026-10-12

- Default all 17 families and 62 kinds to soft plush material; keep flat vector
  material selectable and add optional raised live-eye placement.
- Fit headphones outside each actual head, reserve their avatar framing, and keep
  glasses at fixed dimensions while their gaze-following lenses connect to head
  sides. Preserve the mounted live eyes, expression state and animation timeline.
- Carry strict finish/eyePlacement choices through stored profiles, SVG/JSON API,
  CLI, browser exports, hosted demo and the generated starter; keep accessories
  independent and reject malformed or misplaced appearance selectors.
- Recommend SDK 0.7.0 and create-openagent 0.5.0. Identity/authentication contracts
  and OIDC 0.2.0 stay unchanged. Exact-source remote qualification, npm publication
  and hosted/Orbit acceptance remain separate delivery evidence.

## 0.6.0 — independent character accessories, 2026-10-12

- Add transparent glasses and headphones as independent, combinable accessories
  on every family and kind. Autos remains the default with no accessories.
- Keep accessory art anchored to the face and inside avatar crops while live
  eye nodes, status, blinking and expression transitions continue unchanged.
- Carry strict accessory choices through SDK/profile validation, SVG/JSON API,
  CLI, browser player, hosted demo and the generated starter; reject unknown or
  duplicate choices. Appearance choices never grant identity permissions.
- Verify all kinds, face crops, real signed starter status and additive/removal
  behavior. Production Orbit adoption is tracked separately.

## 0.5.0 — character families and face avatars, 2026-10-12

- Add twelve original crafted families and Halloween, Thanksgiving and Christmas,
  each with multiple distinct character kinds: 17 families and 62 kinds total.
  Autos remains the default; every family uses the shared live-v1 eye expressions.
- Frame the upper face by default in SDK SVGs, the browser player, HTTP API,
  CLI and profile fallback. Add explicit full-character rendering. Preserve
  Autos/SpaceX identity selection and eye animation continuity on appearance changes.
- Expose the catalog and kind/framing controls through the CLI, starter and hosted
  demo; extend strict profile validation and the public OpenAPI contract.
- Qualify family/kind rendering, circular face-mask bounds, live status continuity,
  isolated SVG paint references, reduced motion and real starter request status.
  This source change does not itself establish production Orbit rollout.

## 0.4.0 — public developer tooling, 2026-10-11

- Add a Node-only persistent local identity authority with real Ed25519 keys,
  explicit receiver-controlled public identity trust, bounded issued challenges,
  signature verification, durable replay prevention and local revocation.
  Reuse the existing identity verifier without a mandatory Life service or
  private repository dependency.
- Expand `oaid` with workspace initialization, agent creation/export/trust/revoke,
  challenge/proof commands, local verification, diagnostics and character SVGs.
- Add the working create-openagent 0.2 starter and public-package qualification;
  retire unsupported generator selectors with explicit migration errors.
- Correct first-run documentation and facade configuration guidance. The new
  local authority uses private persistent single-host storage; it does not claim
  distributed storage or grant access outside the receiving application's policy.

## 0.3.0 — live expression state, 2026-10-11

- Add portable status snapshots and incremental updates for all eighteen
  expressions. Reasoning selects thoughtful; blocked/error selects concerned.
  Explicit expression overrides remain available across Autos and SpaceX.
- Add a clock-driven animator and mounted browser SVG player. Interrupted
  transitions preserve eye position and velocity, while identity-seeded blinking
  and gaze keep their timeline. Respect system reduced motion and cleanly stop
  animation and listeners on disposal or hidden documents.
- Keep the DOM player in explicit browser subpaths so Node imports do not gain
  a DOM type requirement. Publish a self-contained browser module, a public status catalog and mirrored
  OpenAPI contract; update the hosted demo to exercise state updates in place.
  Preserve default Autos, optional SpaceX, existing DID/body/color derivation,
  profile overrides and all authentication/authorization behavior.
- Add state, interpolation, invalid-input and real browser/HTTP qualification
  coverage. Only @openagentid/sdk changes to 0.3.0; OIDC stays at 0.2.0.

## 0.2.2 — IAM avatar compatibility, 2026-10-11

- Accept literal IAM agent-instance ULIDs for character and Glyph rendering;
  preserve the assigned DID, deterministic seed, selected skin and expression.
- Export `isAgentAvatarDid` from root, characters and glyph for display-only
  consumer classification. Identity/authentication validators remain unchanged.
- Strictly validate uppercase 128-bit ULIDs and render opaque Glyph v2 digests;
  preserve the existing Autos/SpaceX defaults, overrides and Glyph reference
  vectors. Update OpenAPI and add independent seed/API regression coverage.

## 0.2.1 — animated agent characters, 2026-10-11

- Export characters and character-api subpaths: deterministic Autos/SpaceX
  skins, eleven shapes, sixteen shared expressions and animated/static live eyes.
- Add the public Fetch character API, strict OpenAPI 3.1 contract, CORS,
  streaming input limits, ETags and safe SVG responses.
- agentAvatar now defaults agent principals to Autos. Select body/face through
  avatarSkin and eyes through avatarExpression or runtime expression/state;
  avatarSkin:null retains OAS Glyph. HTTPS overrides take precedence.
- Preserve the existing OAS Glyph encoding and non-agent default avatars.

### 0.2.0 self-rooted agent identities — 2026-10-11

- Support explicitly authorized self-rooted agents and their signed descendants
  with nullable owner and an explicit root policy binding. Preserve real key
  purposes/signatures, current root/grant revocation, bounded lifetimes and
  atomic challenge/replay checks. No human owner is fabricated.
- Recheck self-root policy in verification HTTP/CLI, OATS and OIDC; bind OIDC
  grants to the exact root mode and authorization ID/revision. Retain owned and
  legacy-DID flows and document full service access under normal authorization.

### 0.2.0 artifact correction

- Resolve npm's executable symlink when detecting the CLI entry point, so the
  installed `oaid` command executes and propagates successful/refused exits.
- Use the patched Vitest 4.1.11 development runner and coverage tool.
- Require explicit authoritative DID key purposes: authentication for possession
  proofs and capabilityDelegation for delegations; reject absent or wrong purposes.

## 0.2.0 — release candidate, 2026-10-11

- Verify real agent signatures, ordered owner delegations, authoritative owner
  binding, revocation and one-use possession challenges; add HTTP verification
  handler, HTTPS verification client and `oaid verify` CLI.
- Render OAS Glyph SVGs locally or through a safe SVG endpoint; support
  authenticated-service-managed HTTPS avatar overrides and legacy DID reading.
- Add verified OATS evidence ingestion with explicit trusted attesters,
  exact DID/credential binding, strict dates/values/types and duplicate refusal.
- Export the new subpaths, use `openagent` for new identity namespaces, and
  correct the optional OAS dependency to its published 1.x family.
- Consolidate provider-neutral OIDC discovery/JWKS doctor as `oaid oidc doctor`.
  Publication and live hosted acceptance remain pending.

All notable changes to `@openagent/sdk` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-04-26

### Added

- **Verify-first ACT surface.** `act.verify(token).issuer(...).forAudience(...).requireScope(...).trustedKeys(...).run()` verifies Agent Capability Tokens through the canonical Rust crate compiled to WASM (`@openagent/crypto-wasm`) - envelope decode, version/algorithm checks, Ed25519 signature verification *before* any claim check, temporal checks with leeway, and issuer/audience/scope policy. TypeScript carries none of the format rules, so it cannot drift from the specification. The binding is injected once at startup via `setActCryptoBinding()`; verifier misconfiguration and token failures report distinctly (`OpenAgentError` vs `VerificationError` carrying the canonical reason).
- **Verification middleware.** `withAct(config, handler)` guards fetch-standard handlers (Next.js route handlers, Hono, Workers), and `requireActExpress(config)` guards Express routes - a request with a missing, forged, expired, wrong-audience, or under-scoped token gets a 401 with the reason and never reaches the application.
- **Key custody** (`keys` namespace). `keys.generate()` mints an identity; everything derives deterministically from one 32-byte seed - the Ed25519 signing keypair and an X25519 encryption keypair via the same BLAKE3 context-separated derivation as Arsenal's `identity_loader`, so a seed moves between the Rust and TypeScript SDKs and restores the same keys. `keys.saveSeed()` writes owner-only (0600) seed files in Arsenal's format; `keys.fromSeed()`, `keys.fromSeedHex()`, `keys.fromSeedFile()`, and `keys.fromEnv()` restore.

### Changed

- **Breaking. Package renamed from `@openagent/sdk` to `@openagentid/sdk`.** The `@openagent` npm scope is squatted by a third party; the project now publishes under the `@openagentid` scope, matching the GitHub org OpenAgentID. Consumers must update dependency names and imports. Effective with the first npm publish under the new scope.
- **Breaking. The silent stub fallback is removed.** Until now the SDK
  silently substituted fake implementations - `StubIdentityProvider` minted
  unsigned "signatures", `StubVerificationClient` accepted any `stub:` token,
  and a fallback Arsenal client echoed deterministic proxy URLs - whenever a
  protocol client was missing from `OpenAgentConfig.clients`. A production
  deployment with a misconfigured peer would sign and verify with fake
  cryptography without anyone having chosen that. The subsystems are now
  optional at construction and **fail closed at use**: `createAgent`,
  `loadAgent`, `authenticate`, `credentialsFor`, and the escape hatches throw
  a `ConfigError` naming the missing client, the package a real one comes
  from (`@openagent/oas-sdk`, `@openagent/arsenal-sdk`,
  `@openagent/aegis-sdk`), and the testing package for unit tests. The stub
  exports (`StubIdentityProvider`, `StubVerificationClient`) are gone from
  this package; equivalent in-memory backends now live in
  **`@openagent/sdk-testing`** behind an explicit import that cannot sneak
  into a dependency graph unnoticed, plus a `createTestingConfig()` helper
  that wires all three for tests.
- Added a root GitHub-installable package wrapper so
  `npm install github:OpenAgentID/openagent-sdk` resolves to the TypeScript
  facade before npm registry publication is available.
- `extractBearerToken()` now accepts the canonical `Authorization: OpenAgent <token>` form in addition to Bearer, `X-OpenAgent-Token`, and `oa_token`, so SDK behavior matches the HTTP auth protocol docs.
- Documented the OAS SDK dependency as the required Sigil-backed lineage verifier contract for privileged OpenAgent sessions, ACTs, credentials, and scopes. Local identity remains portable, but privileged authority must fail closed when the OAS verifier cannot prove finalized Sigil lineage.
- chore: prepare packages for first npm publish (publishConfig, license files, READMEs, root package marked private)

### Added

- Added `LineageAuthorityContext` to `AuthContext` so production verifiers can attach the OAS/Sigil authority result. `VerifyRequestOptions` can now require privileged authority, and the stub verifier fails closed when that option is requested.
- Added a verification test proving the offline stub rejects privileged authority requests instead of pretending local identity is enough.
- Added `PrivilegedAuthorityVerificationClient` and `PrivilegedAuthorityVerifier` so runtime request verification can wrap an AEGIS verifier, call an OAS-backed authority verifier when `requirePrivilegedAuthority` is set, attach normalized authority context, and fail closed on malformed subject, root, path-kind, or scope results.

## [0.1.1] - 2026-07-31

### Fixed

- Fixed license copyright holder (L1fe Labs, Inc.) and added copyright footers to all READMEs. No functional changes.

## [0.1.0] - 2026-04-11

### Added

- Initial public API surface:
  - `OpenAgent` singleton facade with `configure()`, `createAgent()`,
    `loadAgent()`, `authenticate()`, and `runtime()` entry points.
  - `OpenAgentRuntime` class for multi-runtime scenarios.
  - `OpenAgentInstance` with `did`, `document`, `skillsPolicy()`,
    `withSkillsPolicy()`, `credentialsFor()`, and `identity()` methods.
- Identity module (`src/identity.ts`):
  - `IdentityProvider` interface wrapping `@oas/sdk`.
  - `StubIdentityProvider` for offline development and tests.
  - Runtime-validated `IdentityDocument` and `SignedAssertion` types.
- Credentials module (`src/credentials.ts`):
  - `ArsenalClient` interface wrapping `@arsenal/sdk`.
  - `CredentialHandle` with a drop-in `fetch` that injects scoped credentials
    via the Arsenal proxy. Lazy refresh at `expiresAt - 30s`.
  - First-class streaming (SSE, chunked responses) via native `Response`.
- Verification module (`src/verification.ts`):
  - `VerificationClient` interface wrapping `@aegis/sdk`.
  - `StubVerificationClient` for offline development and tests.
  - `extractBearerToken()`, `assertScopes()`, `assertAncestor()` helpers.
- Skills module (`src/skills.ts`):
  - `SkillsPolicy` interface with immutable `grant`/`revoke`.
  - `InMemorySkillsPolicy` with exact and wildcard-suffix matching.
  - `denyAllSkills` / `allowAllSkills` presets.
- Error hierarchy (`src/errors.ts`):
  - Root `OpenAgentError` with stable `ErrorCode` enum.
  - Specialized `ConfigError`, `InputValidationError`, `IdentityError`,
    `CredentialError`, `VerificationError`, `SkillDeniedError`.
  - `wrapError()` and `getErrorMessage()` helpers.
- Configuration (`src/config.ts`):
  - Zod schemas for DIDs, scopes, provider ids, and `CreateAgentInput`.
  - `resolveConfig()` with sensible defaults.
- Full unit test suite with Vitest (errors, config, identity, credentials,
  verification, skills, agent — 60+ tests).
- `tsup` ESM + CJS dual build with per-module entry points.
- TypeScript strict mode with `noUncheckedIndexedAccess` enabled.
- Runtime support: Node 20+, Bun, Deno, browsers, Cloudflare Workers.
- `README.md` with three-line happy path and escape-hatch documentation.
- `INTEGRATION_NOTES.md` tracking expected API shapes for `@oas/sdk`,
  `@arsenal/sdk`, and `@aegis/sdk` until those SDKs are finalized.
