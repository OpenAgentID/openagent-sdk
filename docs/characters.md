# OpenAgent characters

An agent has a stable DID, a body/face **skin**, a preferred **avatar expression**,
and optional runtime **status/expression state**.
Autos is the default family: a simple vertical capsule character. The catalog
contains 18 families and 75 distinct kinds, including [the One family](#the-one-family).
Changing family or kind preserves
identity, current status and expression. The API keeps the field names `skin`
for family and `shape` for kind.

All two-eyed families share `live-v1` eyes: two white rounded pill bars. Blinking shrinks
each bar's height about its center; gaze moves both around the face. Eighteen
expressions adjust the same bars: neutral, attentive, surprised, excited, happy,
laughing, angry, sad, scared, suspicious, confused, curious, proud, shy,
unimpressed, sleepy, thoughtful and concerned. Expressions never select a
different body or color. Peeps are persistent agents, not an avatar skin;
Autos and SpaceX retain their names. The One family has its own eye style,
`agent-eye-v1`: agent-eye's single bar, driven by the same state (status,
expression, blink and gaze). Each family's catalog entry lists its eye styles,
and a stored style that belongs to another family is refused.

## Families and kinds

| Family (`skin`) | Kinds (`shape`) |
| --- | --- |
| Autos (default) | standard, slender, wide |
| SpaceX | circle, pebble, squircle, capsule, triangle, hexagon, cloud, droplet |
| Fold | standard, kite, fan |
| Sprig | standard, bud, leaf |
| Ripple | standard, drop, wave |
| Halo | standard, comet, satellite |
| Purl | standard, mitt, hood |
| Prism | standard, crystal, obelisk |
| Coil | standard, spring, bellows |
| Kiln | standard, vase, teapot |
| Wisp | standard, flame, curl |
| Relay | standard, radio, beacon |
| Cairn | standard, tower, arch |
| Tuft | standard, pom, bear |
| Halloween | pumpkin, ghost, bat, witch-hat, candy-corn |
| Thanksgiving | turkey, acorn, squash, pie, corn |
| Christmas | light, tree, snowman, ornament, gift |
| One | blue, red, sky, green, yellow, pink, plum, teal, lime, mint, lilac, coral, charcoal |

These are distinct silhouettes with shared eyes. Holiday selection is explicit;
there is no date-based switch of an agent's appearance. Omit `shape` to choose
a stable kind from the DID within the selected family. The twelve crafted
families and three holiday families use curated material palettes. Autos and
SpaceX preserve their original DID-selected shapes and colors. The One family's
kinds are colours, and an omitted kind selects one of its twelve agent colours.

## Finish, eye placement and wearables

All 17 two-eyed families and their 62 kinds share `finish: 'plush' | 'flat'` and
`eyePlacement: 'face' | 'raised'`. Defaults are soft plush and on-face eyes.
The plush finish adds bounded SVG material shading and texture; flat uses the
vector material. Raised placement puts the same two live-v1 bars on soft pods
above the head. Both placements support all eighteen expressions, shared gaze
and height-based blinking. These choices do not change the literal DID,
identity-selected shape/color, preferred expression or current activity state.

Glasses and headphones remain optional, independent and combinable through
`accessories: ['glasses', 'headphones']`. Fixed-size transparent glass lenses
follow the live gaze, with temples connecting to the sides of the head; blinking
and expression changes never resize the lenses. Headphones sit outside the actual
head. Avatar framing reserves room for the selected wearables and raised eyes
at every allowed gaze, so the crop does not change during animation. Removing
headphones or changing eye placement may change the framing once.

Unknown or malformed selectors, null values, duplicate query parameters and
unrecognized fields are refused. `finish` and `eyePlacement` belong in appearance
options or `avatarSkin`, never in `state`. Omitted stored fields remain omitted;
the renderer resolves them to plush/face. The descriptor always includes their
resolved values. The One family keeps these selections without drawing them.

## Face framing

Every renderer defaults to `view: 'avatar'`, a square crop around the eyes and
upper head. Tall Autos therefore show their face rather than shrinking their
whole body into a profile circle. Clients can apply their usual circle or
rounded-square mask. Choose `view: 'full'` for a full-character illustration.
The face anchor and crop are package-owned per kind; clients never need to
calculate eye offsets. `view` belongs to rendering options, not persisted
`avatarSkin` or live state. `agentAvatar` uses the same crop as the live player.

## The One family

`skin: 'one'` draws an agent as One: a round disc with one bar for an eye, in its
own colour. Every frame comes from agent-eye's geometry (see
[Provenance](#provenance-of-agent-eye)); the eye style is `agent-eye-v1`. Autos
stays the default family; an app opts into One per agent, by stored appearance
or render options.

```ts
import { generateCharacter, nextOneColor, oneColorForDid } from '@openagentid/sdk';
import { mountCharacter } from '@openagentid/sdk/browser';

// The agent's colour: given once, when the agent is created, and kept until the user changes it.
const color = nextOneColor(team.map(agent => ({ color: agent.color, group: agent.group })), { group: 'team' });

// Without a stored colour, the DID selects one of the twelve.
oneColorForDid(agent.did);

// A still glyph for server rendering, static images and reduced motion.
const { svg } = generateCharacter(agent.did, { skin: 'one', shape: color, size: 44, theme: 'light',
  state: { status: 'working', gaze: { x: 0.4, y: 0.1 } } });

// A live head in a list row, named from the agent's own name.
const player = mountCharacter(element, agent.did, { skin: 'one', shape: color, size: 44, label: `${agent.name}, agent`,
  state: { gaze: { x: 0.4, y: 0.1 } } });
player.update({ status: 'attention' });
```

Hosts that draw only Ones can use the light entry instead, which has no other
family's art and no schema library (see [The light One entry](#the-light-one-entry)):

```ts
import { renderOne } from '@openagentid/sdk/one';           // server: stills and DID defaults
import { mountOne } from '@openagentid/sdk/browser/one';   // client: the live runtime, 15.1 KB gzipped

const html = renderOne({ did: agent.did, color, size: 44, label: `${agent.name}, agent`, state });
const head = mountOne(element, { color, size: 44, label: `${agent.name}, agent`, state }); // takes over the still
head.update({ status: 'success' });
```

### Kinds and colours

The family's kinds are colours. The twelve agent colours come in a fixed default
order, chosen so that small teams get the most distinct colours first. Each has
one identity value; Blue, Plum and Coral are lifted on dark surfaces. Light
colours carry a keyline (a ring inside the disc's edge in a darker tone of its
own hue) on light surfaces so the head always reaches 3:1 against them.

| Kind (`shape`) | Picker name | Light disc | Keyline | Dark disc | Eye |
| --- | --- | --- | --- | --- | --- |
| `blue` | Blue | `#3253e6` | — | `#5366fd` | `#fbfaf6` |
| `red` | Red | `#e51e59` | — | `#e51e59` | `#fbfaf6` |
| `sky` | Sky | `#6fc9fe` | `#3889b6` | `#6fc9fe` | `#141b16` |
| `green` | Green | `#0e9076` | — | `#0e9076` | `#fbfaf6` |
| `yellow` | Yellow | `#ffe93f` | `#908207` | `#ffe93f` | `#141b16` |
| `pink` | Pink | `#f85fa0` | `#cd4882` | `#f85fa0` | `#141b16` |
| `plum` | Plum | `#890f8e` | — | `#a94cac` | `#fbfaf6` |
| `teal` | Teal | `#0aaead` | `#3b8f8e` | `#0aaead` | `#141b16` |
| `lime` | Lime | `#a9c21a` | `#798a28` | `#a9c21a` | `#141b16` |
| `mint` | Mint | `#3df0b0` | `#21946b` | `#3df0b0` | `#141b16` |
| `lilac` | Lilac | `#b183f4` | `#9068ca` | `#b183f4` | `#141b16` |
| `coral` | Coral | `#fa8f77` | `#bd624e` | `#f29782` | `#141b16` |
| `charcoal` | (Digital One) | `#141b16` ink | — | `#f2f1ea` chalk | knocked out |

`charcoal` is Digital One, One itself: ink on light surfaces and chalk on dark
ones, with its eye knocked out of the disc so the surface shows through. It is
never a DID default and is never assigned by `nextOneColor`.

A **blank head** (`color: 'blank'` in the light entry) is a ready-made agent that
has not been added yet: the surface's ink at 10 % for the disc and a muted eye
(`#5a6256` light, `#a9b2a2` dark), still and looking toward its name. It is
presentation only: not a catalog kind, never stored, never a DID default and
never assigned. When the agent is added, give the same head its colour with
`setAppearance({ color })`: it plays **First blink**, the disc washing to its
colour while the eye opens for the first time (a glance at you at 40 px and up,
then a look toward its name). Under reduced motion it simply appears in colour.

- **Gates.** Every eye reaches 3:1 on its disc; every silhouette reaches 3:1 on
  the four light and four dark surfaces of the One app; colours stay at least
  CIEDE2000 25 from Digital One, 15 from One Humanoid's amber, 12 from the
  needs-you green, 10 from the danger reds and 10 from Google's logo, Material,
  2014–15 and 2015 logo colours. Under simulated protanopia, deuteranopia and
  tritanopia the smallest distance among Digital One and the first five colours
  is above 13, the first eight about 10, and all twelve above 8. The unit tests
  check all of these.
- **Shared with the One website and the One app.** Red, Yellow, Blue and Green
  are the four Ones that the One website and the One app draw, with identical
  values. The first five's colour-vision floor (13.4) is Yellow beside Digital
  One's chalk on dark surfaces under tritanopia; both values are fixed, so no
  other colour can raise it.
- **The DID default** is `order[u32le(seed[0..4]) mod 12]`, where the seed is the
  family seed every character uses, BLAKE3 over `oaid-character-v1\0one\0<did>`.
  It is display only: the colour neither identifies nor authenticates an agent.
- **`nextOneColor(held, { group })`** returns the first colour in the default
  order that nobody in `held` has. When all twelve are held it returns the
  least-held colour; among those, with `group`, one whose holders all sit in
  other groups (a team or a company, say), so repeats stay apart for as long as
  possible; ties go by the order. `held` lists colours or `{ color, group }`
  holders for every agent of the same scope; a holder without a group never
  counts as another group. Unknown colours and malformed holders are refused.
  Store the result: a colour derived on the fly would shift whenever an earlier
  agent leaves.
- **`getOneColors()`** returns the twelve in order with their picker names, light
  and dark tones and temperament. Picker names belong in a colour picker only:
  never use a colour as an agent's name.
- **Colour is identity, never status.** A One keeps its colour in every state.

### Faces

The status timeline that drives every family drives the One faces. Activity
statuses show their own face; an explicit expression override, or an expression
status, shows that expression's face.

| Status | Face | When it starts | While it lasts |
| --- | --- | --- | --- |
| `idle` | looks toward its content; warm at the viewer with no content direction | glance | still |
| `reasoning` | ponders: up, narrowed, tilted | a quick glance up, then ponder | brief ponder drift |
| `working` | reads toward the work, narrowed | read-along | brief read-along |
| `typing` | looks down at its work | keystrokes | brief keystrokes |
| `attention` | the only face looking straight at the viewer, centred and a touch wide | a little hop and a wide look | still |
| `success` | warm: a slight tilt | a squinting smile (40 px and up) or nod | still |
| `paused` | dozes (below 64 px) or closes its lid, body slumped (64 px and up) | doze-off | still |
| `error` | sheepish, looking down and away | dizzy | still |
| `speaking` | warm, at the viewer | — | talks with a mouth line when a voice level is supplied (64 px and up) |
| `listening` | at the viewer, a touch wide | glance | still |
| `blocked` | looks up, waiting its turn | glance | still |
| `offline` | looks away | glance | still |

Leaving reasoning plays a short "aha"; leaving a paused or offline face wakes
up. Expression faces use the same channels: happy is the warm face, sleepy the
doze, thoughtful the ponder, sad the sheepish face. One never shows anger or
fear: `angry` is a level, narrowed eye and `scared` a startled glance away.
No held face shows a smile, a mouth or an eye so narrow it reads as a dot.

- **The smile** is agent-eye's SMILE curve, exactly, while the eye narrows into a
  happy squint (openness 0.42 at 40–52 px, 0.6 at 64 px and up), turned toward its
  content and tilted 10°: a tall bar over the line would read as "!" on a
  coloured disc.
- **Talking** narrows the eye to 0.6 under a full smile, facing the viewer. The
  mouth line appears only while there is voice and is always fully opaque (0.45
  to 1 of agent-eye's mouth), so a quiet syllable never flickers like a status
  light; the head blinks only in pauses longer than 600 ms.
- **Blinks** at the viewer shut tilted by 7°, so for those frames a disc never
  shows a centred, level bar that reads as a No Entry sign.
- **Containment.** When any move starts while a smile line shows, the line is
  withdrawn over 120 ms first, so the eye never comes within 6 units of it.

**Content direction.** For the One family, `state.gaze` is where the head's
content is, and a One at rest looks there. Pass the direction of the row's name
(`{ x: 0.4, y: 0.1 }` in a left-to-right list), or `{ x: 0, y: 0.3 }` for a
centred header looking down at its thread. With no content direction
(`{ x: 0, y: 0 }`, a hero), idle and neutral show the warm face at the viewer
(tilted 5°, a touch narrowed), so a head that needs you, centred, upright and a
touch wide, is never mistaken for one at rest. A negative `x` mirrors every face
for right-to-left content. Give list rows a content direction so that a head
needing attention is the only one looking at the viewer.

**States the host composes.** The One app's plan has four states that are not
SDK statuses. Render them with these statuses and content directions:

| App state | Status | `state.gaze` | Notes |
| --- | --- | --- | --- |
| Queued ("Up next") | `blocked` | the row's direction | The same face as the plan: looking up the list, waiting its turn. |
| Stopped (by the user) | `idle` | `{ x: 0.3, y: 0.5 }` | Down at the card; the eye is at rest openness rather than the plan's 0.92. |
| Muted (call) | `idle` | `{ x: -0.35, y: 0.6 }` | Toward the Mute control; rest openness rather than 0.9. |
| Mic off (call) | `idle` | `{ x: 0, y: 0.5 }` | Toward the hint below; exactly the plan's face. |

**Size tiers** follow the rendered size: up to 20 px holds faces only and
settles state changes over 160 ms; 24–36 px moves the face; 40–52 px adds a
little body; 64 px and up is fully expressive. One heads render from 16 px (every
other family from 32 px). Each colour paces its moves with one of four
temperaments (quick, bouncy, neat, slow; Digital One is dry), a second cue
besides colour. Tempo paces the gaps between read-along jumps; the jumps
themselves keep agent-eye's saccade speed.

### The still glyph

`generateCharacter`, `renderCharacterSvg`, `agentAvatar`, `renderOne`, the CLI and
the HTTP API render a One as a still glyph of its held face: no animation,
script, style, font, external reference or element identifier, in a
`-100 -100 200 200` viewBox, for server rendering, images and reduced motion. The
SVG never embeds animation, because an embedded animation cannot follow the
viewer's reduced-motion setting; motion comes from the live player or the
animator. `animated` is still reported in the descriptor as the motion choice for
live renderers.

- **Decorative by default.** Without `label`, the SVG is `aria-hidden`. With
  `label` (1–200 characters of plain text, normally the agent's own name, never
  a colour word) it is `role="img"` with that name and a matching title.
- **Digital One** cuts its eye out of the disc with the even-odd rule (the bar as
  drawn, its stroke included), so stills need no mask and no identifier: any
  number of identical heads can share a page. The live head draws the same eye
  through a mask with a per-head identifier; the browser verifier checks that the
  two match pixel for pixel.
- **`theme`** selects light (default) or dark surface tones and drops keylines
  on dark surfaces. It is presentation only, never stored appearance.
- **`size`** (16–2048) sets the keyline width (one pixel, two at 96 px and up)
  and the tier; pass the displayed size where possible. A paused head at 64 px
  and up is drawn with its slumped body, exactly as the live head holds it, so a
  server-rendered head never jumps when the live head takes over; the root is
  `overflow="visible"` for that lean.
- **`view`** is accepted; a One is the whole head in both views.
- **Finish, eye placement and accessories** are kept in the descriptor and the
  stored appearance, so switching back to another family restores them, but a
  One does not draw them: the head is agent-eye's geometry and nothing else.
- **Hooks for host styles:** `data-one-disc`, `data-one-keyline`, `data-one-eye`
  and `data-one-mouth` on the drawn parts (a still Digital One has no eye element:
  its eye is a hole in `data-one-disc`); `data-one-color`, `data-one-face` and
  `data-one-tier` on every root, and `data-moving` on live heads while they move.

Hosts that support forced colours or increased contrast can style those hooks.
Coloured Ones become `Canvas` discs with a `CanvasText` ring and eye; Digital One
becomes a `CanvasText` disc whose eye shows the `Canvas` surface (the rules leave
its live mask alone):

```css
@media (forced-colors: active) {
  [data-one-color] { forced-color-adjust: none; }
  [data-one-color]:not([data-one-color="charcoal"]) [data-one-disc] {
    fill: Canvas; fill-opacity: 1; stroke: CanvasText; stroke-width: 2px; vector-effect: non-scaling-stroke;
  }
  [data-one-color]:not([data-one-color="charcoal"]) [data-one-keyline] { stroke: none; }
  [data-one-color]:not([data-one-color="charcoal"]) :is([data-one-eye], [data-one-mouth]) { fill: CanvasText; stroke: CanvasText; }
  [data-one-color="charcoal"] [data-one-disc] { fill: CanvasText; }
}
@media (prefers-contrast: more) {
  [data-one-color]:not([data-one-color="charcoal"]):not([data-one-color="blank"]) [data-one-disc] {
    stroke: color-mix(in srgb, currentColor 60%, transparent); stroke-width: 2px; vector-effect: non-scaling-stroke;
  }
}
```

### Live One heads

`mountCharacter` with `skin: 'one'`, or `mountOne` from the light entry, renders
a live head with five to seven SVG nodes. Every One head in a window shares one
requestAnimationFrame ticker that runs only while a head moves, one
IntersectionObserver and one ResizeObserver; there are no per-head frame loops,
and nothing ticks at rest. A One head replaces a still One already rendered in
its element (a server-rendered head, say); otherwise mount into an empty element.

- **A head moves only when its state changes** (or the viewer changes its
  colour, which plays a small wave at 40 px and up), and only while at least
  60 % of it is in view and the page is not scrolling. A head that changes state
  out of view plays the change when it comes into view.
- **`cadence: 'brief'`** (default) suits lists and cards: ongoing work moves for
  at most five seconds after the state starts or the head comes into view (each
  next cluster is drawn and measured before it is scheduled).
  **`cadence: 'repeat'`** suits headers and heroes: a cluster every six to ten
  seconds for every ongoing state (working, reasoning and typing alike), resting
  after a minute without viewer input.
- **One mover per group, three per window** (two below 600 px wide). `group`
  names a row group; by default it is the nearest list container (`ul`, `ol`,
  `role=list`, `listbox`, `grid`, `feed`, `tree` or `table`). A higher-priority
  move (attention, then error, then success) cuts an ongoing cadence short: the
  cut head settles in 160 ms while keeping its slot, and the move starts after it,
  so two heads never move in one group. A move that cannot start within 1.5 s is
  dropped and the head switches straight to its held face, without moving to it;
  a group's held faces switch one at a time. The next move in a group starts a
  beat (about 100 ms) after the last one ends, never in the same frame. The
  viewer's own acts (a tap, a new colour, First blink) are not held to the
  window's cap, but they wait for their group the same way: two heads added
  together blink open one after the other.
  Recolouring, a theme switch or a size change mid-move never strands a head as
  moving: repaints do not advance its timeline, so the move ends on the ticker and
  frees its slot.
- **`follow: true`** lets the eye follow a fine pointer within 240 px of a head of
  40 px and up (headers and heroes) while it is at rest, warm or listening. Eye
  only: it is not counted as a mover and starts no move; the head returns to its
  held face 1.6 s after the pointer stops.
- **Reduced motion** (`reducedMotion: 'system'` or `true`) holds every face still
  and swaps faces at once. Approval and money surfaces should mount their heads
  with `reducedMotion: true`, so they only ever hold the attention face.
- **`voiceLevel: () => number`** (0–1, read every frame) lets a speaking head of
  64 px and up talk with a mouth line, blinking only in pauses. Without it, a
  speaking head holds its warm face.
- **`setAppearance({ shape, theme, size, label })`** (`color` in the light entry)
  recolours, changes surface tones, size or name without resetting the state;
  switching to or from another family keeps the status, expression and wearables.
- **`play(gesture, { viewer? })`** (the light entry's player) plays a gesture the
  host chooses, then returns to the held face: `lookAtYou` (square to the viewer
  and a blink; Digital One adds a dry chuckle), `nod`, `smile`, `wave`, `shrug`
  (up and aside, the body tipped) and `popIn` (an arrival: the eye shut, a pop up
  and a landing as it opens wide; the head does not grow from nothing, because the
  host already shows its still). Hosts use it for arrival moments (`popIn` on a
  first screen, `lookAtYou` once after a page loads, `wave` the first time an
  empty thread shows) and, with `{ viewer: true }`, for a hero's tap ladder: a tap
  starts at once, an arrival takes a motion slot like a state change and is
  dropped after 1.5 s without one. `lookAtYou` and `nod` play from 24 px, the
  others from 40 px. Nothing plays under reduced motion, in a hidden document or
  out of view; an arrival asked as the head mounts waits up to 1.5 s for it to
  come into view. A head whose status is `attention`, or that is speaking, only
  looks at you or nods. It returns whether the gesture was accepted. Never use it
  on approval or money surfaces.
- **Digital One's rainbow** is the host's job. The SDK draws no rainbow:
  Eureka's rainbow belongs to agent-eye's own `<agent-eye>` element, which the
  SDK never registers. A hero that offers it can swap in that element, as the One
  app prototype does.

### The light One entry

`@openagentid/sdk/one` is the One family on its own, for bundlers and servers:
`renderOne(options)`, `mountOne(element, options)`, `getOneColors`,
`oneColorForDid`, `nextOneColor` and `ONE_KINDS`, with no other family's art and
no schema library. `@openagentid/sdk/browser/one` is the live runtime alone,
self-contained and minified for a browser: `mountOne` and the palette helpers.

- **`renderOne({ did?, color?, size?, theme?, label?, expression?, state? })`**
  returns exactly the SVG of `generateCharacter(did, { skin: 'one', shape: color, ... })`.
  A colour or an agent DID is required; without a colour the DID selects one. A
  blank head needs no DID.
- **`mountOne(element, { color, size?, theme?, label?, expression?, state?, animated?,
  reducedMotion?, cadence?, group?, voiceLevel?, follow? })`** mounts a live head
  and returns `update`, `setAppearance({ color?, theme?, size?, label? })`,
  `play(gesture, { viewer? })`, `setReducedMotion`, `getState` and `dispose`. It takes the head's colour (the
  stored one, or `oneColorForDid(did)` on the server), so the browser never hashes
  a DID.
- **Budgets** (`npm run size`, run in CI): the live runtime is at most 16 KB
  gzipped (15.1 KB in 0.8.0), the One app's script budget for animated heads; the
  all-family browser bundle stays at most 65 KB gzipped (62.9 KB in 0.8.0, 63.1 KB
  in 0.7.3).

### Provenance of agent-eye

The One head is agent-eye, One's animated mark. agent-eye is written by JR and is
copyright L1fe Labs, Inc., which contributes it to this repository under its
Apache-2.0 OR MIT licence for SDK 0.8.0. `sdks/typescript/src/agent-eye.ts` ports
the master's pure geometry and motion functions (bar and mouth geometry,
containment, eases, blink and smile curves) line for line, without its
`<agent-eye>` custom element, so importing the SDK never touches a DOM. The
byte-identical master, sha256
`83cc379a706b86899c56b41813030a721110071dbcd11274ebdc146a40b8bba4`, is kept in
`sdks/typescript/test/fixtures/agent-eye/` with its provenance record, and the
tests compare the port with it and run the master's containment check over every
held face and every frame of every move, from every face and when a move cuts a
smile or talk short: the eye stays within radius 89 of 100 and the smile at least
6 units from the eye. The faces, moves and palette follow the One app's avatar
plan of 15 October 2026, with three deliberate differences: the smile's eye
squints (openness 0.42–0.6) rather than staying open, talking holds a full smile
over an eye at 0.6 with an opaque mouth rather than the plan's smile of 0.35
(which would bring a full mouth within 6 units of the eye), and idle with no
content direction is the warm face rather than the mark at rest.

## SDK

```ts
import {
  generateCharacter, renderCharacterSvg, getCharacterSkins,
  getCharacterExpressions, getCharacterStatuses, parseCharacterState, agentAvatar,
} from '@openagentid/sdk';

const did = 'did:oas:openagent:agent:preview';
const autos = generateCharacter(did); // Autos, plush, on-face eyes, face crop, neutral, animated, size 512
const spacex = generateCharacter(did, {
  skin: 'spacex', skinVersion: 1, eyeStyle: 'live-v1',
  shape: 'cloud', finish: 'flat', eyePlacement: 'raised', expression: 'curious', size: 256,
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

`generateCharacter` returns the DID, skin, skinVersion, eyeStyle, finish,
eyePlacement, selected shape, accessories, expression, color, view, size,
animation choice, normalized eye state and SVG.
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
| typing | attentive |
| attention | attentive |
| paused | sleepy |
| offline | sleepy |

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
must belong to their skin. Expression, finish, eye placement, accessories, size, gaze and blink do not
affect the identity-derived body/color seed. Full illustrations start with a 512 by 512
viewBox and expand when raised eyes or exterior accessories need space. Avatar
viewBoxes frame each kind's face and selected wearables without changing their geometry.

## Profiles and Orbit

Persist body/face appearance separately from preferred expression:

```json
{
  "avatarSkin": { "skin": "autos", "skinVersion": 1, "eyeStyle": "live-v1", "finish": "plush", "eyePlacement": "face", "accessories": ["glasses"] },
  "avatarExpression": "curious",
  "avatarOverride": null
}
```

These optional fields are validated by `identityDocumentSchema`. Shape, finish, eyePlacement and accessories are
optional `avatarSkin` fields; runtime status/expression/blink/gaze are presentation state, not
identity claims. Hosts authorize profile edits through their existing owner
and agent policy. The open renderer cannot edit a profile.

**One heads in shared identity documents.** SDK 0.7.3 and earlier validate
`avatarSkin` against their own closed catalog, so a document whose `avatarSkin`
has `skin: 'one'` (or `eyeStyle: 'agent-eye-v1'`) fails to parse there as a whole
(`IDENTITY_RESOLVE_FAILED`). Until every reader of a document runs SDK 0.8.0 or
later, keep an agent's One colour in the application's own agent record (a colour
id such as `teal`, as the One app plans) and render it with `shape` or `color`,
rather than writing it into identity documents that older readers resolve.

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
player.setAppearance({ skin: 'christmas', shape: 'snowman' }); // keep status and eye timeline
player.setAppearance({ finish: 'flat', eyePlacement: 'raised' }); // same state and wearables
player.setAppearance({ view: 'full' }); // illustration; use avatar for profile faces
player.setAppearance({ shape: null }); // restore the identity-selected shape
player.setReducedMotion(true);
const snapshot = player.getState(); // full immutable status/expression/blink/gaze
// On host/component cleanup:
player.dispose();
```

Mount the player into an empty element: it appends its SVG and does not adopt
markup already there (a One head is the exception: it replaces a still One
rendered in the element). Player options extend `CharacterOptions` (including
`theme` and `label`) with `reducedMotion:boolean|'system'` (default `'system'`)
and `transitionMs` (default 420ms). One heads also take `cadence:'brief'|'repeat'`,
`group`, `voiceLevel` and `follow` ([Live One heads](#live-one-heads)); other
families ignore them. The controller also
supports `setReducedMotion(boolean|'system')` and
`setAppearance({skin?,shape?:Shape|null,size?,view?,finish?,eyePlacement?,accessories?,theme?,label?:string|null})`. Changing skin without an
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
and rotation centers in the shared 512×512 eye coordinate space; the renderer
transforms that space into the selected character framing. Do not apply blink a
second time.
Apply the sampled normalized gaze as a shared translation of
`20 * frame.gaze.x`, `14 * frame.gaze.y` to both eyes, preserving their
relative centers and the stationary body. Sampled blink/gaze include ambient
motion; they are not profile preferences or proof of actual agent activity.
As with the browser player, status updates arrive through the host's existing
authorized runtime channel, and null clears only the controller's explicit
expression override.

For the One family, each frame also carries `frame.one`: the face, size tier,
pose channels and drawn geometry (eye transform, bar path and stroke width,
mouth rectangle, body transform) in the head's `-100 -100 200 200` box. Draw
`one.geometry` rather than `frame.eyes`. The animator plays the same moves as the
browser player on the injected clock, with seeded randomness, so a given DID and
clock replay exactly; it starts each move as soon as the state changes, since a
single head has no other heads to wait for. `cadence` and `voiceLevel` are
animator options too; pointer follow and First blink belong to browser heads.
One animators accept sizes from 16 px. Reduced motion or `animated:false` holds
the face still.

## Public HTTP API

Mount `createCharacterApiHandler()` from `@openagentid/sdk/character-api` in any
Fetch-compatible server. Default base path is `/v1/characters`; a validated
`basePath` option supports another mount. The Node service and interactive
preview in `services/character-api` provide a deployable reference.

| Method | Path | Result |
| --- | --- | --- |
| GET / HEAD | `/v1/characters/skins` | Versioned skin/shape/expression catalog |
| GET / HEAD | `/v1/characters/accessories` | Independent glasses/headphones catalog |
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

GET options: `skin`, `skinVersion`, `eyeStyle`, `finish`, `eyePlacement`, `shape`,
`view`, `accessories`, `expression`, `status`, `size`, `theme`,
`animated`, `blink`, `gazeX`, `gazeY`. POST takes the corresponding SDK options,
with `state:{status?,expression?,blink?,gaze?:{x,y}}`. Neither accepts `label`:
the public API renders decorative heads and never echoes caller text. GET `status` is
`state.status`; GET `expression` remains the outer preferred-expression
fallback, so `status=reasoning&expression=happy` resolves to thoughtful.
Use POST `state.expression` for an explicit runtime expression override.
Gaze coordinates must be supplied together.
Size is an integer 16–2048 for the One family and 32–2048 for every other
family; blink is 0–1; each gaze coordinate is -1–1. `eyeStyle` must be the
selected family's own (`agent-eye-v1` for One, `live-v1` otherwise).
Unknown fields, duplicate query parameters, unsupported versions, malformed
JSON/DIDs and incompatible shape/skin combinations are refused.
The `/skins`, `/accessories`, `/statuses` and `/openapi.json` catalogs accept no query options.
GET accessories use comma-separated IDs; POST uses a unique array. Both normalize
to catalog order; omitted or empty selections mean no accessories.
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

## CLI

```sh
oaid avatar skins
oaid avatar accessories
oaid avatar did:oas:openagent:agent:preview --skin halloween --shape pumpkin --status reasoning --output pumpkin.svg
oaid avatar did:oas:openagent:agent:preview --skin christmas --shape tree --view full --output tree.svg
oaid avatar did:oas:openagent:agent:preview --skin one --shape teal --theme dark --status working --size 64 --output teal.svg
```

`oaid avatar skins` prints the same family/kind catalog as the SDK and open API.
No login, network service or API key is needed for character generation.

## Versioning and release

SDK 0.8.0 adds the One family with its own eye style `agent-eye-v1`, the light
`@openagentid/sdk/one` entry, the `typing`, `attention`, `paused` and `offline`
statuses, and the `theme` and `label` rendering options. It is a minor release:
Autos stays the default, and every existing family, kind, colour, stored profile
and DID seed renders as before. Exhaustive `switch` statements over the skin,
kind, eye style or status unions need the new cases. Identity documents that
store a One appearance do not parse in SDK 0.7.3 and earlier (see
[Profiles and Orbit](#profiles-and-orbit)). See the
[0.8.0 release contents](release-0.8.0.md).

SDK 0.7.0 makes plush the shared default material, refines gaze-following glasses
and external headphones, and adds raised eye placement. This is an intentional
pre-1.0 visual update: pass `finish:'flat'` for vector material. Framing now
includes the selected exterior wearables and raised eyes. Stored appearance v1
and live-v1 stay current, with two optional selectors; literal DIDs, the seed and
identity authentication stay unchanged. Existing closed consumer profile schemas
must admit the optional fields before saving them. See the
[0.7.0 release contents](release-0.7.0.md).


SDK 0.5.0 adds the expanded families and makes face framing the default across
SVG generation, live players, HTTP, CLI and profile fallbacks. This is an
intentional pre-1.0 visual change: existing calls now show the face. Pass
`view:'full'` to keep full-body framing. Autos/SpaceX DID selection, stored
appearance v1, live-v1 expression geometry and authentication behavior are
unchanged; Autos eyes now sit at the top of the head in either view. See the
[0.5.0 release contents](release-0.5.0.md).


SDK 0.2.1 adds this character API after the separately reviewed 0.2.0 identity
release. OIDC remains 0.2.0. Skin version 1 and eye style `live-v1` are explicit
so future skins or eye designs can be added without changing existing avatars.
Only the current catalog is accepted today. Canonical Glyph generation stays
available through `oasGlyph`, `glyphEndpoint` and `oaid glyph`.
