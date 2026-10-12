# Changelog

## 0.7.3 — current package compatibility, 2026-10-12

- Restore deterministic X25519 public keys from seeds with real WASM bindings;
  expose public-from-secret and retain recovery compatibility with 0.1.1's
  RFC 7748 base-point operation. Remove the random-key recovery fallback.

- Align runtime metadata and current setup guides with Node 20.19+; replace
  obsolete error-code, automatic-retry and universal HTTP-status documentation.

- Read the receiver clock on every ACT verification; keep compatibility with
  crypto-wasm 0.1.1 and fix the WASM default clock in crypto-wasm 0.1.2.
- Preserve native Request method, headers, body and cancellation in credential
  proxy calls; share the shipped SDK VERSION with CLI version output and help.
- Add explicit adapters for the shipped OAS, Arsenal, AEGIS and skills-policy
  contracts, with real-package integration examples and required trust context.
- Release HTTP, MCP, Claude hooks, SCIM and EAS 0.2.0 integrations with current
  SDK support, authenticated flows and fail-closed revocation/replay behavior.
  HTTP now requires authoritative key resolution and atomic nonce admission;
  EAS supports native Node imports/requires and requires trusted attesters; SCIM requires actual identity provisioning.
- Update sdk-testing 0.1.2 and create-openagent 0.5.3; preserve Autos as the
  default, SpaceX and all existing families, colors, accessories and live state.
- Replace placeholder deployment handlers with complete ACT receivers and
  executable examples; add packed-package checks against SDK 0.7.2 and 0.7.3.
  OIDC 0.2.0 keeps its API and gains a full current-SDK authentication test.

## Unreleased — current developer documentation, 2026-10-12

- Refresh the documentation entry, core concepts, architecture and API/HTTP
  guidance around the published SDK 0.7.2, create-openagent 0.5.2 and OIDC 0.2.0.
- Add the complete public CLI signer/receiver flow, explicit local trust,
  durable challenge/replay/revocation and single-host storage boundary; document
  portable verification, OATS and current browser families/live state.
- Remove mandatory human-root/Sigil, automatic-client/ACT issuance, invented
  facade methods and unsupported request-type/performance claims. Preserve
  actual legacy authority interfaces; a Base backend migration is not implied.
- Replace unsupported credential, audit/compliance, delegation, skill, MCP,
  wallet and harness recipes with actual exports and explicit host/broker
  responsibilities; distinguish binary CBOR ACT from identity JWTs and preserve
  component-specific audit/custody boundaries. Separate creation-input, exact
  facade and canonical ACT scope contracts; correct Rust README feature flags.
- Clarify private integration dependency requirements, face/full rendering,
  appearance independence and authorized status updates. Documentation only;
  package versions, application code and provider state are unchanged.

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

- Qualification correction: reserve interrupted eye-center motion and additional circular-mask stroke clearance for tall headwear; fixed-frame centering is covered through full blinks.
- Clarify expanded full-character framing and distinguish animator eye coordinates
  from the final SVG viewBox.

## 0.6.0 — independent character accessories, 2026-10-12

- Add transparent glasses and headphones as independent, combinable accessories
  on every family and kind. Autos remains the default with no accessories.
- Keep accessory art anchored to the face and inside avatar crops while live
  eye nodes, status, blinking and expression transitions continue unchanged.
- Carry strict accessory choices through SDK/profile validation, SVG/JSON API,
  CLI, browser player, hosted demo and the generated starter; reject unknown or
  duplicate choices. Appearance choices never grant identity permissions.
- Align recommended installation and starter commands with SDK 0.6.0 and
  create-openagent 0.4.0 so the first-run flow includes accessories.
- Verify all kinds, face crops, real signed starter status and additive/removal
  behavior. Production Orbit adoption is tracked separately.

## 0.5.0 — character families and face avatars, 2026-10-12

- Inset every hosted-demo and generated-starter selector arrow by 12px, reserve
  space for its label, and retain native selectors in forced-color mode.
- Add twelve original crafted families and Halloween, Thanksgiving and Christmas,
  each with multiple distinct character kinds: 17 families and 62 kinds total.
  Autos remains the default; every family uses the shared live-v1 eye expressions.
- Frame the upper face by default in SDK SVGs, the browser player, HTTP API,
  CLI and profile fallback. Add strictly typed full-character rendering. Preserve
  Autos/SpaceX identity selection and eye animation continuity on appearance changes.
- Expose the catalog and kind/framing controls through the CLI, starter and hosted
  demo; extend strict profile validation and the public OpenAPI contract. Check
  the starter's catalog-populated controls in its generated HTTP regression test.
- Qualify family/kind rendering, circular face-mask bounds, live status continuity,
  isolated SVG paint references, reduced motion and real starter request status.
  This source change does not itself establish production Orbit rollout.

## Unreleased — provisioning documentation, 2026-10-12

- Rewrite the agent creation guide around SDK 0.4.0's real local self-root
  provisioning, explicit receiver trust and persistent identity. Document the
  separately configured provider facade and Life integration requirements;
  remove implicit ACT issuance, unsupported refresh/load options and invented
  provisioning timings. Make the local examples directly runnable as Node 20
  JavaScript modules. Documentation only; package versions are unchanged.

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
- Qualify exact source commits and exercise hostile Host headers over native
  HTTP, without relying on Fetch's forbidden-header normalization.
- Correct first-run documentation and facade configuration guidance. The new
  local authority uses private persistent single-host storage; it does not claim
  distributed storage or grant access outside the receiving application's policy.
- Put the working starter first in the public README and identify Life-hosted
  integrations as optional for standalone applications.

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

- Render established IAM `did:oas:agent-instance:<canonical ULID>` identifiers
  through Autos, SpaceX and the public character/Glyph APIs without rewriting
  the assigned DID or deriving it from an unrelated agent ID.
- Export `isAgentAvatarDid` for consumer display selection. Strictly refuse
  noncanonical ULIDs, trailing whitespace and non-agent inputs; keep identity,
  proof, verification, OATS and OIDC admission unchanged.
- Encode IAM ULIDs as opaque full-DID Glyph v2 digests with no invented
  namespace. Preserve existing character seeds and upstream Glyph vectors.
- Add independent remote BLAKE3 vectors, API/installed-package regression
  checks and the mirrored OpenAPI contract. OIDC remains at 0.2.0.

## 0.2.1 — animated agent characters, 2026-10-11

- Add an open, deterministic character SDK and public Fetch API with OpenAPI
  3.1, animated SVGs, CORS, bounded inputs and conditional GET/HEAD caching.
- Make Autos the default agent skin; provide SpaceX with eight geometric
  shapes. Both skins share sixteen live-eye expressions, height-based blinking
  and bounded gaze. Skin selection is independent of expression and identity.
- Add versioned avatarSkin and preferred avatarExpression profile fields;
  preserve HTTPS overrides and explicit OAS Glyph selection with avatarSkin:null.
- Add the deployable Node service and interactive preview, reduced-motion
  controls, independent remote BLAKE3 vectors and real HTTP regression checks.
- Publish the preceding SDK/OIDC 0.2.0 identity release; character work remains
  a separate SDK release. OIDC stays at 0.2.0.

### 0.2.0 self-rooted agent identities — 2026-10-11

- Support explicitly authorized self-rooted agents and their signed descendants
  with nullable owner and an explicit root policy binding. Preserve real key
  purposes/signatures, current root/grant revocation, bounded lifetimes and
  atomic challenge/replay checks. No human owner is fabricated.
- Recheck self-root policy in verification HTTP/CLI, OATS and OIDC; bind OIDC
  grants to the exact root mode and authorization ID/revision. Retain owned and
  legacy-DID flows and document full service access under normal authorization.

## 0.2.0 — release candidate, 2026-10-11

- Add a signing OIDC provider adapter with registered relying parties, S256
  PKCE, discovery/JWKS and LifeID owner federation; remove successful
  placeholder exchange/key derivation behavior from the existing bridge.
- Add signature, signed owner-chain, revocation and replay verification,
  a framework-neutral HTTP handler, remote SDK client and `oaid verify` CLI.
  Bind remote verdict DID and expiry to the submitted challenge proof.
  Require authoritative DID authentication and capability-delegation key
  relationships for possession proofs and signed delegations respectively.
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
  OAS dependencies to the canonical anchor-authority API Git revision.
  Use the patched Vitest 4.1.11 test runner for both npm release packages.
  Verify OIDC code/UserInfo flows for persistent agents and agent instances.
  Align the WASM verifier expression with the Rust 1.99 CI formatter and
  propagate test errors without weakening the auth-protocol Clippy policy.
  Format the Rust SDK/conformance runner and regenerate the locked OAS graph
  remotely without dropping any anchor conformance coverage.
  Keep all nine upstream Glyph fixtures in their dedicated SDK parity suite,
  separate from the generic 222-vector schema; publish failing runner logs
  and hidden conformance reports in CI while enforcing the Cargo lockfile.
- Consolidate the useful legacy claim/discovery/CLI behavior into this
  canonical repository and document the free Open Software core versus Life's
  hosted integration boundaries. Production authorities, hosted acceptance,
  exact-head CI/review and npm publication remain release gates.

