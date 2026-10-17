# OpenAgentID 0.8.0: the One family

SDK 0.8.0 adds an eighteenth character family, `one`: fourteen fun shapes in
eighteen colours for agents, and Digital One, the black circle, for One itself.
Every head wears One's single-line eye, with its own eye style `agent-eye-v1`.
It is opt-in. Autos stays the default family, and every existing family, kind,
colour, accessory, finish, eye placement, stored profile and DID seed renders
exactly as in 0.7.3.

```ts
import { generateCharacter } from '@openagentid/sdk';
import { mountCharacter } from '@openagentid/sdk/browser';

// A still glyph for server rendering, static images and reduced motion.
const { svg } = generateCharacter(agent.did, { skin: 'one', size: 44, state: { status: 'working', gaze: { x: 0.4, y: 0.1 } } });

// A live head: still at rest, a short move when its state changes.
const player = mountCharacter(element, agent.did, { skin: 'one', size: 44, label: agent.name, state: { gaze: { x: 0.4, y: 0.1 } } });
player.update({ status: 'attention' });                         // looks straight at the viewer, once
player.setAppearance({ shape: 'star', color: 'lemon' });        // the viewer picked a look; the head waves
```

Hosts that draw only Ones can use the light entry instead:

```ts
import { renderOne, oneLookForDid } from '@openagentid/sdk/one';   // server: stills, DID defaults, blank heads
import { mountOne } from '@openagentid/sdk/browser/one';          // client: the standalone live runtime

const look = agent.look ?? oneLookForDid(agent.did);               // { shape: 'flower', color: 'bubblegum' }
element.innerHTML = renderOne({ did: agent.did, ...look, size: 44, label: agent.name, state });
const head = mountOne(element, { ...look, size: 44, label: agent.name, state }); // replaces the still
head.play('popIn');                                                // an arrival, once the head is in view
```

## What is new

- **The `one` family.** Fifteen kinds: the fourteen agent shapes `star`,
  `heart`, `flower`, `cloud`, `droplet`, `squircle` (Square), `diamond`,
  `clover`, `gumdrop`, `hexagon`, `egg`, `blob`, `peanut` and `bean`, plus
  `charcoal` (Digital One, One itself). An agent shape is worn in one of eighteen
  colours (`color`): `berry`, `lime`, `blush`, `jade`, `periwinkle`, `cherry`,
  `indigo`, `mint`, `bubblegum`, `apricot`, `sky`, `lemon`, `grape`, `lavender`,
  `watermelon`, `lagoon`, `orchid` and `aqua`, in team order. Eleven never pairs
  (a shape in a colour that would turn it into a sign: the Star or Gumdrop in
  Cherry or Watermelon, the Drop in Cherry, Watermelon or Berry, the Diamond in
  Lemon, Lime or Apricot, the Cloud in Sky) are refused everywhere, so there are
  241 looks. Every shape has a default colour and a temperament that paces its
  moves. The shapes and the palette come from the pinned library
  (`shapes.json` sha256 `894f801c…1767`, `palette.json` `76fa2016…c991`), and
  the SDK's data is generated from it, never edited by hand.
- **Digital One is the black circle on every surface.** `#141b16`, with its eye
  cut out to the surface on light, and chalk `#f2f1ea` with a 1 CSS px chalk rim
  at 44 % on dark (2 px from 96 px, never reduced to a device pixel). He is never
  chalk-inverted, never a shape and never a colour; no agent is a circle and no
  agent is black.
- **Who wears what.** `oneLookForDid(did)` (with `oneShapeForDid` and
  `oneColorForDid`) gives an agent's default look from the DID: the same seed
  every character uses, bytes 4–7 for the shape and bytes 0–3 for the colour,
  stepped past the shape's never colours. `nextOneLook(held, { group })` fills
  a team with the next shape nobody has, in that shape's own colour, so the
  first fourteen agents are the site's characters; then free colours in team
  order, then the least held, in another group first. `getOneShapes()`,
  `getOneColors()`, `ONE_SHAPE_ORDER`, `ONE_DIGITAL`, `isOneShape`,
  `isOneColor`, `isOneKind` and `isOneColorAllowed(shape, color)` expose the
  library. `CharacterAppearance` gains `color`, for the One family only: with a
  shape and no colour the shape's own colour applies; with neither, the DID's
  look. A stored colour needs its shape.
- **One palette on every surface.** Each colour is one value on light and dark
  surfaces; there are no dark tones. The line comes from the disc, never from
  the surface: paper on the six deep colours, ink on the twelve bright ones, at
  4.5:1 or more so that a 16 px head on a 1× screen still renders at 3:1. Bright
  colours carry a 1 CSS px keyline in their own hue on light surfaces, exactly
  where the disc alone falls under 3:1, drawn as an exact inset of the outline,
  never a clip. Every colour keeps CIEDE2000 25 from Digital One, 18 from One
  Humanoid's amber, 12 from its glow and from the needs-you green, 10 from
  danger, from Google's colours and from every other agent colour.
- **Its own eye style.** The family's catalog entry lists `eyeStyles:
  ['agent-eye-v1']`; the two-eyed families keep `live-v1`. Each family accepts only
  its own eye style, in options, stored appearance, identity documents, the HTTP
  API and OpenAPI. Future eye geometries receive new identifiers.
- **Faces for live state.** The shared status timeline drives the One faces:
  working reads along, reasoning glances up and ponders, typing taps, attention
  looks at the viewer, success smiles with a happy squint, paused dozes, error
  goes dizzy, speaking talks with an opaque mouth line. With no content
  direction, idle is the warm face, so needs-you stays the only face that looks
  straight out. A One never shows anger, sadness or fear. In every shape the eye
  is placed and limited by the library and stays at least ten units inside the
  edge in every frame of every move; no One shows a smile or mouth line at 24 px
  or smaller, where the line under the bar reads as "!".
- **Heads from 16 px.** One heads render at 16–2048 px in the SDK, animator,
  player, CLI and HTTP API, with the plan's tiers (XS 16–20 holds faces only);
  every other family keeps 32–2048.
- **The light One entry.** `@openagentid/sdk/one` (`renderOne`, `mountOne`, the
  shape and colour helpers) for bundlers and servers, and
  `@openagentid/sdk/browser/one`, the live runtime alone. Neither loads another
  family's art or a schema library, and the browser runtime never hashes a DID.
  `renderOne` is byte-identical to `generateCharacter` for the family.
- **Blank heads and First blink.** A ready-made agent that has not been added
  is a blank head (`color: 'blank'`), drawn in the shape it will get (or the
  Square): presentation only, never stored or assigned. Given its colour, it
  plays First blink.
- **Pointer follow.** `follow: true` lets a header or hero head's eye follow a
  fine pointer: eye only, never a counted move.
- **Gestures from the host.** `play(gesture, { viewer? })` on the light entry's
  player plays `lookAtYou`, `nod`, `smile`, `wave`, `shrug` or `popIn`, then
  returns to the held face: arrival moments that take a motion slot, and a hero's
  tap ladder that starts at once. Nothing plays under reduced motion or out of
  view, and a head that needs the viewer only looks at them or nods.
- **Four new statuses for every family:** `typing` and `attention` (attentive),
  `paused` and `offline` (sleepy). The existing statuses and their order are
  unchanged.
- **`theme: 'light' | 'dark'`** renders surface-specific treatment, today only
  for the One family (keylines on light surfaces only; Digital One's chalk eye
  and rim on dark). It is a rendering option in the SDK, CLI (`--theme`) and
  HTTP API, never stored appearance.
- **`label`** names a character for assistive technology. A One head is
  decorative without it; other families keep their generic title. The public
  HTTP API does not accept labels. Shape and colour names belong in pickers
  only, never in a name.
- **Calm live motion.** One heads share one ticker per window that sleeps at
  rest, one IntersectionObserver and one ResizeObserver. A head moves only when
  its state changes and it is in view; ongoing work moves for at most five
  seconds in lists (`cadence: 'brief'`, each cluster measured before it is
  scheduled) or in clusters in headers and heroes (`cadence: 'repeat'`). One head
  per list moves at a time and at most three per window. Reduced motion holds
  every face still. The body squashes and hops about each shape's own pivot.
- **Still glyphs without identifiers.** Stills carry no element identifier:
  Digital One's eye is cut out of its disc with the even-odd rule, and matches the
  live head pixel for pixel. Every still carries `data-one-shape` and
  `data-one-color` for forced-colours and increased-contrast styles, and a paused
  head at 64 px and up is drawn with the slumped body the live head holds.
- **`frame.one`** from `createCharacterAnimator` gives native and test clients
  the One pose and drawn geometry on their own clock.

## Compatibility

This is a minor release. New union members (`'one'`, the One kinds,
`'agent-eye-v1'` and the four statuses) can make an exhaustive `switch` over
`CharacterSkin`, `CharacterShape`, `CharacterEyeStyle` or `AvatarStatus`
incomplete; add the new cases. Descriptors gain a `theme` field (default `light`)
and, for the One family's agents, `oneColor`, the colour id behind the drawn
`color`.

**Older readers reject One appearances in identity documents.** SDK 0.7.3 and
earlier validate `avatarSkin` against their own closed catalog, so an identity
document whose `avatarSkin` has `skin: 'one'` or `eyeStyle: 'agent-eye-v1'` fails
to parse there as a whole, with `IDENTITY_RESOLVE_FAILED`. Until every reader of
a document runs 0.8.0 or later, store an agent's One look in the application's
own agent record (`{ shape: 'star', color: 'lemon' }`, as the One app's plan
does) and render it with `shape` and `color`; do not write it into shared
identity documents. Closed consumer schemas must likewise admit the new skin,
kinds, colours and eye style before storing them.

The packages in this repository that declare `@openagentid/sdk` now accept
`^0.7.2 || ^0.8.0` and are qualified against a packed 0.8.0 as well as the
published 0.7.2: `@openagentid/http` 0.2.1, `@openagentid/mcp` 0.2.1,
`@openagentid/claude-agent` 0.2.1, `@openagentid/scim` 0.2.1,
`@openagentid/sdk-testing` 0.1.3, the deployment templates (0.2.1) and the
`@openagentid/oidc` source, whose widened range is released after 0.3.0. They
were published with the SDK, so an application installs SDK 0.8.0 beside them. `@openagentid/anchor-eas` does
not depend on the SDK and is unchanged.

The OpenAPI contract is version 0.8.0: the One kinds in every `shape` enum, the
`color` parameter and property, and `oneColor` on descriptors.

## Bundle sizes — 0.8.1 correction

The original 0.8.0 release used a 20 KB gate for the One browser entry.
The 0.8.1 repair restores the original 16,384-byte requirement below;
the published 0.8.0 artifact is unchanged.

Measured with zlib's default gzip level after `npm run build`; `npm run size`
enforces the budgets in CI. Both browser bundles are minified, with source maps.

| Entry | Default-gzip budget |
| --- | --- |
| `@openagentid/sdk/browser` (every family) | 65 KB |
| `@openagentid/sdk/browser/one` (the complete live One runtime) | 16,384 bytes |

The One limit includes every cold-load runtime byte, all fourteen shapes,
the eighteen colours and Digital One. It does not rely on shared application
imports or deferred downloads. `npm run size` reports the exact built output.
Lossless catalog sharing and pinned compression preserve the complete runtime;
[compact errors](browser-one-errors.md) preserve validation and exception classes.

## Provenance

The One head is drawn only from agent-eye, One's animated mark. agent-eye is
written by JR and is copyright L1fe Labs, Inc., which contributes it to this
repository under Apache-2.0 OR MIT. The SDK ports its pure geometry and motion
functions to TypeScript in `sdks/typescript/src/agent-eye.ts`; the
byte-identical master (sha256
`83cc379a706b86899c56b41813030a721110071dbcd11274ebdc146a40b8bba4`) is a test
fixture, and the port is checked against it. The shape library and the agent
palette (`sdks/typescript/test/fixtures/ones-shapes`) are L1fe Labs' Ones'
library of 16 October 2026, contributed under the same licence; the generated
module is compared with them. See
[the One family](characters.md#the-one-family).

## Packages

| Package | Version | Contents |
| --- | --- | --- |
| `@openagentid/sdk` | `0.8.0` | The One family (shapes, colours, Digital One), the light One entry, four statuses, theme and label in ESM/CommonJS, browser, CLI and character API |
| `create-openagent` | `0.6.0` | Existing real-key starter pinned to SDK 0.8.0; its family picker lists One |
| `@openagentid/http`, `mcp`, `claude-agent`, `scim` | `0.2.1` | SDK peer range `^0.7.2 \|\| ^0.8.0` |
| `@openagentid/sdk-testing` | `0.1.3` | SDK peer range `^0.7.2 \|\| ^0.8.0` |
| `@openagentid/oidc` | after `0.3.0` | SDK peer range `^0.7.2 \|\| ^0.8.0`; 0.3.0 (2026-10-13) carries the Continue as Agent button with `^0.7.2` |

Published to npm on 2026-10-17; tag `v0.8.0`.
