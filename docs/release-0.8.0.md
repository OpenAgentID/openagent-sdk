# OpenAgentID 0.8.0: the One family

SDK 0.8.0 adds an eighteenth character family, `one`: a round disc with one bar
for an eye, in twelve agent colours plus Digital One, with its own eye style
`agent-eye-v1`. It is opt-in. Autos stays the default family, and every existing
family, kind, colour, accessory, finish, eye placement, stored profile and DID
seed renders exactly as in 0.7.3.

```ts
import { generateCharacter } from '@openagentid/sdk';
import { mountCharacter } from '@openagentid/sdk/browser';

// A still glyph for server rendering, static images and reduced motion.
const { svg } = generateCharacter(agent.did, { skin: 'one', size: 44, state: { status: 'working', gaze: { x: 0.4, y: 0.1 } } });

// A live head: still at rest, a short move when its state changes.
const player = mountCharacter(element, agent.did, { skin: 'one', size: 44, label: agent.name, state: { gaze: { x: 0.4, y: 0.1 } } });
player.update({ status: 'attention' });   // looks straight at the viewer, once
player.setAppearance({ shape: 'teal' });  // the viewer picked a colour; the head waves
```

Hosts that draw only Ones can use the light entry instead:

```ts
import { renderOne } from '@openagentid/sdk/one';          // server: stills, DID defaults, blank heads
import { mountOne } from '@openagentid/sdk/browser/one';  // client: the live runtime, 15.1 KB gzipped

element.innerHTML = renderOne({ did: agent.did, color: 'teal', size: 44, label: agent.name, state });
const head = mountOne(element, { color: 'teal', size: 44, label: agent.name, state }); // replaces the still
head.play('popIn');                                      // an arrival, once the head is in view
```

## What is new

- **The `one` family.** Thirteen kinds: `blue`, `red`, `sky`, `green`, `yellow`,
  `pink`, `plum`, `teal`, `lime`, `mint`, `lilac`, `coral` and `charcoal`
  (Digital One, One itself). Without a kind, a DID selects one of the twelve
  colours, never charcoal. `getOneColors()`, `oneColorForDid(did)` and
  `nextOneColor(held, { group })` expose the palette, the DID default and
  first-free assignment; from the thirteenth agent, colours repeat least-held
  first and, given groups, in another group first.
- **Its own eye style.** The family's catalog entry lists `eyeStyles:
  ['agent-eye-v1']`; the two-eyed families keep `live-v1`. Each family accepts only
  its own eye style, in options, stored appearance, identity documents, the HTTP
  API and OpenAPI. Future eye geometries receive new identifiers.
- **Faces for live state.** The shared status timeline drives the One faces:
  working reads along, reasoning glances up and ponders, typing taps, attention
  looks at the viewer, success smiles with a happy squint, paused dozes, error
  goes dizzy, speaking talks with an opaque mouth line. With no content
  direction, idle is the warm face, so needs-you stays the only face that looks
  straight out. A One never shows anger, sadness or fear.
- **Heads from 16 px.** One heads render at 16–2048 px in the SDK, animator,
  player, CLI and HTTP API, with the plan's tiers (XS 16–20 holds faces only);
  every other family keeps 32–2048.
- **The light One entry.** `@openagentid/sdk/one` (`renderOne`, `mountOne`, the
  palette helpers) for bundlers and servers, and `@openagentid/sdk/browser/one`,
  the live runtime alone. Neither loads another family's art or a schema
  library. `renderOne` is byte-identical to `generateCharacter` for the family.
- **Blank heads and First blink.** A ready-made agent that has not been added
  is a blank head (`color: 'blank'`): presentation only, never stored or
  assigned. Given its colour, it plays First blink.
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
- **`theme: 'light' | 'dark'`** renders surface-specific tones, today only for
  the One family (lifted Blue, Plum and Coral; no keylines on dark surfaces).
  It is a rendering option in the SDK, CLI (`--theme`) and HTTP API, never
  stored appearance.
- **`label`** names a character for assistive technology. A One head is
  decorative without it; other families keep their generic title. The public
  HTTP API does not accept labels.
- **Calm live motion.** One heads share one ticker per window that sleeps at
  rest, one IntersectionObserver and one ResizeObserver. A head moves only when
  its state changes and it is in view; ongoing work moves for at most five
  seconds in lists (`cadence: 'brief'`, each cluster measured before it is
  scheduled) or in clusters in headers and heroes (`cadence: 'repeat'`). One head
  per list moves at a time and at most three per window. Reduced motion holds
  every face still.
- **Still glyphs without identifiers.** Stills carry no element identifier:
  Digital One's eye is cut out of its disc with the even-odd rule, and matches the
  live head pixel for pixel. Every still carries `data-one-color` for forced-colours
  and increased-contrast styles, and a paused head at 64 px and up is drawn with
  the slumped body the live head holds.
- **`frame.one`** from `createCharacterAnimator` gives native and test clients
  the One pose and drawn geometry on their own clock.

## Compatibility

This is a minor release. New union members (`'one'`, the One kinds,
`'agent-eye-v1'` and the four statuses) can make an exhaustive `switch` over
`CharacterSkin`, `CharacterShape`, `CharacterEyeStyle` or `AvatarStatus`
incomplete; add the new cases. Descriptors gain a `theme` field (default `light`).

**Older readers reject One appearances in identity documents.** SDK 0.7.3 and
earlier validate `avatarSkin` against their own closed catalog, so an identity
document whose `avatarSkin` has `skin: 'one'` or `eyeStyle: 'agent-eye-v1'` fails
to parse there as a whole, with `IDENTITY_RESOLVE_FAILED`. Until every reader of
a document runs 0.8.0 or later, store an agent's One colour in the application's
own agent record (a colour id such as `teal`, as the One app's plan does) and
render it with `shape` or `color`; do not write it into shared identity
documents. Closed consumer schemas must likewise admit the new skin, kinds and
eye style before storing them.

The packages in this repository that declare `@openagentid/sdk` now accept
`^0.7.2 || ^0.8.0` and are qualified against a packed 0.8.0 as well as the
published 0.7.2: `@openagentid/http` 0.2.1, `@openagentid/mcp` 0.2.1,
`@openagentid/claude-agent` 0.2.1, `@openagentid/scim` 0.2.1,
`@openagentid/sdk-testing` 0.1.3, the deployment templates (0.2.1) and the
unreleased `@openagentid/oidc` changes. Publish them with the SDK, so an
application can install SDK 0.8.0 beside them. `@openagentid/anchor-eas` does
not depend on the SDK and is unchanged.

The OpenAPI contract is version 0.8.0.

## Bundle sizes

Measured with zlib's default gzip level after `npm run build`; `npm run size`
enforces the budgets in CI.

| Entry | 0.7.3 | 0.8.0 | Budget |
| --- | --- | --- | --- |
| `@openagentid/sdk/browser` (every family) | 63.1 KB | 62.9 KB | 65 KB |
| `@openagentid/sdk/browser/one` (the live One runtime) | — | 15.1 KB | 16 KB |

The all-family bundle is smaller than in 0.7.3 although it now carries the One
family: avatar DID parsing no longer loads the schema library. The light entry
meets the One app's script budget for animated heads (16 KB, AVATARS.md §4.2).

## Provenance

The One head is drawn only from agent-eye, One's animated mark. agent-eye is
written by JR and is copyright L1fe Labs, Inc., which contributes it to this
repository under Apache-2.0 OR MIT. The SDK ports its pure geometry and motion
functions to TypeScript in `sdks/typescript/src/agent-eye.ts`; the
byte-identical master (sha256
`83cc379a706b86899c56b41813030a721110071dbcd11274ebdc146a40b8bba4`) is a test
fixture, and the port is checked against it. See
[the One family](characters.md#the-one-family).

## Packages

| Package | Version | Contents |
| --- | --- | --- |
| `@openagentid/sdk` | `0.8.0` | The One family, the light One entry, four statuses, theme and label in ESM/CommonJS, browser, CLI and character API |
| `create-openagent` | `0.6.0` | Existing real-key starter pinned to SDK 0.8.0; its family picker lists One |
| `@openagentid/http`, `mcp`, `claude-agent`, `scim` | `0.2.1` | SDK peer range `^0.7.2 \|\| ^0.8.0` |
| `@openagentid/sdk-testing` | `0.1.3` | SDK peer range `^0.7.2 \|\| ^0.8.0` |
| `@openagentid/oidc` | unreleased | SDK peer range `^0.7.2 \|\| ^0.8.0` beside its unreleased Continue as Agent changes |

Source qualification, npm publication and any hosted rollout are verified
separately; this file describes release contents, not publication status.
