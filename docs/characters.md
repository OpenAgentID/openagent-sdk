# OpenAgent characters

An agent has a stable DID, a body/face **skin**, a preferred **avatar expression**,
and optional runtime **status/expression state**.
Autos is the default skin: a simple vertical capsule character. SpaceX is the
second skin: circle, pebble, squircle, capsule, triangle, hexagon, cloud or
droplet. Changing skin preserves identity and the selected expression.

Both skins share `live-v1` eyes: two white rounded pill bars. Blinking shrinks
each bar's height about its center; gaze moves both around the face. Eighteen
expressions adjust the same bars: neutral, attentive, surprised, excited, happy,
laughing, angry, sad, scared, suspicious, confused, curious, proud, shy,
unimpressed, sleepy, thoughtful and concerned. Expressions never select a
different body or color. Peeps are persistent agents, not an avatar skin;
the skin names remain Autos and SpaceX.

## SDK

```ts
import {
  generateCharacter, renderCharacterSvg, getCharacterSkins,
  getCharacterExpressions, getCharacterStatuses, parseCharacterState, agentAvatar,
} from '@openagentid/sdk';

const did = 'did:oas:openagent:agent:preview';
const autos = generateCharacter(did); // Autos, neutral, animated, size 512
const spacex = generateCharacter(did, {
  skin: 'spacex', skinVersion: 1, eyeStyle: 'live-v1',
  shape: 'cloud', expression: 'curious', size: 256,
});
const staticSvg = renderCharacterSvg(did, {
  skin: 'autos', expression: 'happy', animated: false,
  state: { status: 'reasoning', blink: 0.4, gaze: { x: 0.3, y: -0.2 } },
});
// Runtime reasoning resolves to thoughtful, overriding the happy preference.
const explicitPose = generateCharacter(did, {
  expression: 'happy',
  state: { status: 'reasoning', expression: 'curious' },
}); // curious: an explicit runtime expression overrides status
const current = parseCharacterState({ status: 'blocked' });
// Immutable full state: status blocked, expression concerned, blink 0, gaze 0/0.
```

`generateCharacter` returns the DID, skin, skinVersion, eyeStyle, selected shape,
expression, color, size, animation choice, normalized eye state and SVG.
`getCharacterSkins()` returns the immutable versioned catalog with each skin's
supported shapes and expressions. `getCharacterExpressions()` lists shared IDs.
`getCharacterStatuses()` returns immutable `{status,expression}` mappings:
every expression maps to itself, plus the runtime aliases below.
These exports are also available through `@openagentid/sdk/characters`.
State parsing/catalog exports are available through
`@openagentid/sdk/character-state` as well.

| Status | Expression |
| --- | --- |
| idle | neutral |
| listening | attentive |
| reasoning | thoughtful |
| working | attentive |
| speaking | happy |
| success | happy |
| blocked | concerned |
| error | concerned |

Stateless resolution is **`state.expression` → `state.status` mapping → outer
`options.expression` → neutral**. `parseCharacterState(input, fallbackExpression?)`
returns a full immutable `{status,expression,blink,gaze}`. Without an explicit
status, status defaults to the fallback expression or neutral. The character
descriptor always exposes the resolved top-level `expression`; its `state`
keeps normalized blink/gaze and retains status/expression only when supplied
there, preserving old snapshots when these fields are omitted. Unknown or
malformed state fields, including null, are rejected before resolution even
when a higher-priority field would hide them. Status is presentation state,
not evidence that an agent is actually working, listening or authorized.

Agent and agent-instance DIDs are supported, including literal legacy
`did:l1fe` identifiers. SDK 0.2.2 also renders the established IAM format
`did:oas:agent-instance:<ULID>` with exactly 26 uppercase Crockford base32
characters and a first character from `0` through `7`. For example,
`did:oas:agent-instance:01ARZ3NDEKTSV4RRFFQ69G5FAV` is a public ULID fixture.
`isAgentAvatarDid(value)` is exported from the root, characters and glyph
modules so consumers can classify supported **display input** consistently.
It does not establish identity authority. `didSchema`, identity documents,
proof verification and OIDC admission remain unchanged. Preserve the trusted
producer's literal DID; never derive one from a handle or a separate agent ID.
Validation refuses other entity kinds, malformed ULIDs and normalization. Deterministic
body/color selection uses BLAKE3 over the exact UTF-8 string
`oaid-character-v1\0${skin}\0${did}`; the DID is never rewritten. Shape overrides
must belong to their skin. Expression, size, gaze and blink do not affect the
identity-derived body/color seed. The viewBox is always 512 by 512.

## Profiles and Orbit

Persist body/face appearance separately from preferred expression:

```json
{
  "avatarSkin": { "skin": "autos", "skinVersion": 1, "eyeStyle": "live-v1" },
  "avatarExpression": "curious",
  "avatarOverride": null
}
```

These optional fields are validated by `identityDocumentSchema`. Shape is an
optional `avatarSkin` field; runtime status/expression/blink/gaze are presentation state, not
identity claims. Hosts authorize profile edits through their existing owner
and agent policy. The open renderer cannot edit a profile.

`agentAvatar(did, profile, options)` returns an HTTPS override when present,
otherwise a self-contained SVG data URL. Agents with no explicit skin use
Autos. Clearing an override restores the selected skin. Setting
`avatarSkin:null` explicitly selects the existing OAS Glyph; non-agent defaults
and Glyph codewords remain unchanged. Runtime `options.expression` overrides
the preferred profile expression. `options.state.expression` takes precedence
over `options.state.status`, which takes precedence over that outer preference.

For reduced motion, request `animated:false` and update poses deliberately.
Animated SVG uses synchronized SMIL for blinking and gaze, without scripts,
external assets or fonts. No remote image is fetched by the renderer.

## Live state player

For browser consumers that receive changing agent state, mount the SDK player
on a dedicated element instead of treating one SVG data URL as a stateful
controller. Use the existing authenticated host/runtime channel to obtain
status updates; this renderer creates no new authentication or messaging path.

```ts
import { mountCharacter } from '@openagentid/sdk/character-player';

const element = document.getElementById('agent-avatar');
if (!element) throw new Error('Missing agent avatar element');
const player = mountCharacter(element, did, {
  skin: 'autos', reducedMotion: 'system', transitionMs: 420,
});

player.update({ status: 'reasoning' }); // thoughtful; clears a prior explicit override
player.update({ expression: 'curious' }); // overrides the current reasoning status
player.update({ expression: null }); // restores reasoning → thoughtful
player.setAppearance({ skin: 'spacex' }); // same DID/state, new skin; clears old shape
player.setAppearance({ shape: null }); // restore the identity-selected shape
player.setReducedMotion(true);
const snapshot = player.getState(); // full immutable status/expression/blink/gaze
// On host/component cleanup:
player.dispose();
```

Player options extend `CharacterOptions` with `reducedMotion:boolean|'system'`
(default `'system'`) and `transitionMs` (default 420ms). The controller also
supports `setReducedMotion(boolean|'system')` and
`setAppearance({skin?,shape?:Shape|null,size?})`. Changing skin without an
explicit shape clears the prior shape; an explicit null shape restores the
identity default. Updates preserve the literal DID and identity-derived color
selection for the selected skin. `update({expression:null})` is a **controller
reset command**; null is not a valid expression in the stateless SDK/HTTP
snapshot. Hosts persist profile preferences separately and call `dispose()`
when the avatar is removed.

## Clock-driven frames without a DOM

Native apps, harnesses and other non-DOM clients can use
`createCharacterAnimator` from the SDK root or
`@openagentid/sdk/character-animation`. Importing the animator or player does
not access a DOM; only mounting the browser player requires an element.

```ts
import { createCharacterAnimator } from '@openagentid/sdk/character-animation';

const animator = createCharacterAnimator(did, {
  skin: 'autos', expression: 'neutral', state: { status: 'idle' },
  transitionMs: 420, reducedMotion: false,
  now: () => performance.now(), // substitute the native host's monotonic clock
});
animator.update({ status: 'reasoning' });
const target = animator.getState(); // reasoning/thoughtful target; not an interpolated pose
const frame = animator.sample(); // current eye geometry, blink and gaze on this clock
animator.update({ expression: 'curious' });
animator.update({ expression: null }); // restore the current status mapping
animator.setReducedMotion(true); // immediate target pose, no ambient motion
```

`sample(atMs?)`, `update(state,atMs?)` and `setReducedMotion(boolean,atMs?)`
accept optional explicit timestamps or use the injected `now()` function.
Every timestamp must be finite, nonnegative and nondecreasing across calls.
The host owns sampling and drawing; the animator starts no timer or DOM loop.
`transitionMs` is an approximate settling time,80–2000ms, default420ms.
State transitions preserve current position and velocity when interrupted.
Reduced motion or `animated:false` uses the target pose immediately and
suppresses ambient blink/gaze.

`getState()` and `update()` expose immutable **target state**. A sampled frame's
`status`/`expression` identify that target, while its geometry can still be
settling. `frame.eyes` contains the already blink-adjusted rectangle geometry
and rotation centers in the512×512 viewBox; do not apply blink a second time.
Apply the sampled normalized gaze as a shared translation of
`20 * frame.gaze.x`, `14 * frame.gaze.y` to both eyes, preserving their
relative centers and the stationary body. Sampled blink/gaze include ambient
motion; they are not profile preferences or proof of actual agent activity.
As with the browser player, status updates arrive through the host's existing
authorized runtime channel, and null clears only the controller's explicit
expression override.

## Public HTTP API

Mount `createCharacterApiHandler()` from `@openagentid/sdk/character-api` in any
Fetch-compatible server. Default base path is `/v1/characters`; a validated
`basePath` option supports another mount. The Node service and interactive
preview in `services/character-api` provide a deployable reference.

| Method | Path | Result |
| --- | --- | --- |
| GET / HEAD | `/v1/characters/skins` | Versioned skin/shape/expression catalog |
| GET / HEAD | `/v1/characters/statuses` | Shared runtime status-to-expression mappings |
| GET / HEAD | `/v1/characters/:did` | Character descriptor and SVG |
| GET / HEAD | `/v1/characters/svg/:did` | `image/svg+xml` |
| POST | `/v1/characters/generate` | Descriptor from a JSON request |
| GET / HEAD | `/v1/characters/openapi.json` | OpenAPI 3.1 document |
| OPTIONS | Any supported route | Public CORS preflight |

The reference service also mounts the existing `GET/HEAD /v1/glyph/svg/:did`
handler for explicit OAS Glyph avatars. This preserves the SDK's canonical
Glyph renderer and caching behavior.

For a running local reference service:

```sh
OAID_CHARACTER_API=http://localhost:8080
curl "$OAID_CHARACTER_API/v1/characters/skins"
curl "$OAID_CHARACTER_API/v1/characters/statuses"
curl "$OAID_CHARACTER_API/v1/characters/svg/did%3Aoas%3Aopenagent%3Aagent%3Apreview?skin=spacex&shape=cloud&expression=curious&animated=false"
curl "$OAID_CHARACTER_API/v1/characters/did%3Aoas%3Aopenagent%3Aagent%3Apreview?status=reasoning&expression=happy"
curl "$OAID_CHARACTER_API/v1/characters/generate" \
  -H 'Content-Type: application/json' \
  --data '{"did":"did:oas:openagent:agent:preview","skin":"autos","expression":"happy","state":{"status":"reasoning","expression":"curious"}}'
```

GET options: `skin`, `skinVersion`, `eyeStyle`, `shape`, `expression`, `status`, `size`,
`animated`, `blink`, `gazeX`, `gazeY`. POST takes the corresponding SDK options,
with `state:{status?,expression?,blink?,gaze?:{x,y}}`. GET `status` is
`state.status`; GET `expression` remains the outer preferred-expression
fallback, so `status=reasoning&expression=happy` resolves to thoughtful.
Use POST `state.expression` for an explicit runtime expression override.
Gaze coordinates must be supplied together.
Size is an integer 32–2048; blink is 0–1; each gaze coordinate is -1–1.
Unknown fields, duplicate query parameters, unsupported versions, malformed
JSON/DIDs and incompatible shape/skin combinations are refused.
The `/skins`, `/statuses` and `/openapi.json` catalogs accept no query options.
They support GET, HEAD, validators, conditional 304 and public CORS preflight.

The body limit is 16 KiB, the URL limit 8192 bytes and the DID limit 512
characters. GET/HEAD representations have strong ETags and conditional 304
responses. Public CORS applies to successful, error and conditional responses;
POST/error responses use `no-store`. SVG responses carry a restrictive CSP and
`nosniff`. The exact contract is in [OpenAPI](character-api.openapi.json).

The HTTP API renders a supplied **snapshot**; it does not hold runtime state,
subscribe to status changes or persist a profile preference. Consumers supply
fresh snapshots through their existing authorized host channel, or update a
mounted SDK player. The API itself remains public stateless decoration.

Generation is free, public presentation. It proves no key possession, owner
chain, revocation status, identity registration or authority. Use the separate
[identity verifier](identity-verification.md) when authentication is required.

## Versioning and release

SDK 0.2.1 adds this character API after the separately reviewed 0.2.0 identity
release. OIDC remains 0.2.0. Skin version 1 and eye style `live-v1` are explicit
so future skins or eye designs can be added without changing existing avatars.
Only the current catalog is accepted today. Canonical Glyph generation stays
available through `oasGlyph`, `glyphEndpoint` and `oaid glyph`.
