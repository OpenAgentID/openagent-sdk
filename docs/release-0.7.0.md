# OpenAgentID 0.7.0: soft characters and head-fitted accessories

This release makes soft plush the default material on all 17 families and 62
kinds. Flat vector material is selectable. The same two white live-v1 eye bars
can sit on the face or on raised pods above the head; all eighteen expressions,
ongoing blink/gaze and reduced motion apply in either placement. Autos remains
the default family and accessories remain empty unless selected.

## SDK and live player

```js
import { generateCharacter } from '@openagentid/sdk';
import { mountCharacter } from '@openagentid/sdk/browser';

const character = generateCharacter(agentDid, {
  finish: 'plush', eyePlacement: 'face', accessories: ['glasses', 'headphones'],
});
const player = mountCharacter(element, agentDid, {
  skin: 'autos', accessories: ['glasses', 'headphones'], reducedMotion: 'system',
});
player.update({ status: 'reasoning' });
player.setAppearance({ finish: 'flat', eyePlacement: 'raised' });
player.setAppearance({ skin: 'christmas', shape: 'snowman' });
player.setAppearance({ accessories: [] });
// Dispose when the host removes the avatar.
player.dispose();
```

Appearance changes preserve the SVG, live eye elements, target state and animation
clock. Glass lenses keep fixed dimensions and follow gaze, with temples reaching
the head sides. Headphones sit outside each actual head. The avatar crop reserves
space for exterior wearables and raised eyes; it stays constant during movement.
The full-character view uses the same appearance. No images, fonts, scripts or
remote textures are embedded in the SVG.

## Profiles, HTTP and CLI

Persist appearance independently of preferred expression or actual runtime state:

```json
{"avatarSkin":{"skin":"autos","finish":"plush","eyePlacement":"raised","accessories":["glasses"]},"avatarExpression":"curious"}
```

`finish` accepts only `plush` or `flat`; `eyePlacement` accepts only `face` or
`raised`. Both are optional stored fields. The renderer resolves omitted values
to plush/face and descriptors always include both. Strict parsing rejects null,
unknown IDs, wrong case, whitespace, misplaced state fields and duplicate query
parameters. Accessory selection retains its canonical unique-array contract.

Existing JSON/SVG GET routes accept `?finish=flat&eyePlacement=raised` and POST
accepts those fields beside the other options. The public OpenAPI contract remains
appearance schema 1 and live-v1; its package version is 0.7.0. No new catalog route
is needed for the two closed selector enums. ETags cover the actual representation;
errors and POST responses remain no-store.

```sh
oaid avatar "$AGENT_DID" --finish flat --eye-placement raised --accessories glasses,headphones
```

The hosted demo and create-openagent 0.5.0 starter have separate Finish and Eyes
selectors. They preserve current activity, expression and wearables when changed.
The starter still verifies actual signed requests locally; appearance controls
create no authentication, status channel or permissions.

## Migration and release contents

This pre-1.0 update intentionally changes default material and wearable framing.
Pass `finish:'flat'` for vector material, and continue using `view:'full'` when an
illustration is preferred. Closed consumer profile schemas must admit the two
optional fields before saving them. No DID rewriting, seed change, identity
migration or authority change is required. HTTPS overrides and explicit Glyph
selection retain their priority.

- `@openagentid/sdk` 0.7.0: material, head-fitted wearables, raised eye placement,
  strict profile/API/CLI integration and browser declaration exports.
- `create-openagent` 0.5.0: SDK 0.7.0 and working finish/eye controls.
- `@openagentid/oidc` remains 0.2.0.

Source review, remote CI, packed-package browser checks, npm publication and hosted
verification are recorded separately. This document makes no production Orbit
adoption claim.
