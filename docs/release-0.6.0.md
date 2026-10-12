# OpenAgentID 0.6.0: independent accessories

This release adds glasses and headphones as optional layers on all 17 families
and 62 kinds. Autos remains the default family. Existing appearances have no
accessories; they keep the same DID-derived body, color, face crop and live eyes.

## SDK and live player

```js
import { generateCharacter, getCharacterAccessories } from '@openagentid/sdk';
import { mountCharacter } from '@openagentid/sdk/browser';

const accessories = ['glasses', 'headphones'];
const character = generateCharacter(agent.did, { accessories });
const player = mountCharacter(element, agent.did, { skin: 'autos', accessories });
player.update({ status: 'reasoning' });
player.setAppearance({ skin: 'christmas', shape: 'snowman' });
player.setAppearance({ accessories: ['headphones'] });
player.setAppearance({ accessories: [] }); // Remove all accessories.
```

Accessory changes preserve the mounted SVG, eye elements, activity state and
animation clock. Accessory geometry follows the face anchor rather than the gaze.
Transparent glasses and the headphone band sit above the body and below the eyes,
so blinking, expressions and extreme gaze remain visible. Both avatar and full
framing use the same layer. The renderer respects reduced-motion preferences.

`getCharacterAccessories()` returns the immutable supported catalog. Pass a
unique array of supported IDs. Order is normalized, so the same selection always
renders identically. Unknown IDs, duplicates, strings and null are rejected.
Omitting `accessories` during a player appearance update preserves the selection;
passing an empty array clears it. Runtime status updates never change accessories.

## Stored profiles and APIs

Store selections in `avatarSkin`, independently of runtime expression:

```json
{"avatarSkin":{"skin":"autos","accessories":["glasses","headphones"]}}
```

`parseCharacterAppearance`, profile validation and `agentAvatar` share this
contract. Profile image overrides continue to take precedence. Consumers with a
closed local schema must admit this optional array before saving it; use the SDK
catalog for control labels and choices. Keep writes under existing profile-owner
authorization. Accessory data provides no identity proof or permissions.

The public API adds `GET /v1/characters/accessories`. Existing SVG and JSON GET
routes accept `?accessories=glasses,headphones`; POST options accept an array.
Empty GET selections and omitted values mean no accessories. Duplicate query
parameters, unknown choices and repeated IDs are refused. Descriptors include the
canonical `accessories` array, including `[]` when nothing is selected.

```sh
oaid avatar accessories
oaid avatar "$AGENT_DID" --accessories glasses,headphones
```

The hosted demo and create-openagent 0.4.0 starter expose separate Glasses and
Headphones checkboxes. They work with every family and remain selected when the
family or kind changes. The starter still derives activity from real verified
requests; accessories are local display choices and do not simulate agent work.

## Release contents

- `@openagentid/sdk` 0.6.0: typed catalog, strict data contract, independent vector
  layer, live player, SVG/JSON API and CLI support.
- `create-openagent` 0.4.0: SDK 0.6.0 and working accessory controls.
- `@openagentid/oidc` remains 0.2.0.

Source review, remote CI, packed-package browser checks and deployed verification
are recorded separately. This document does not establish adoption on a real
production Orbit profile.
