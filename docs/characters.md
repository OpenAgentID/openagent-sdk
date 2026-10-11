# OpenAgent characters

An agent has a stable DID, a body/face **skin**, and an **avatar expression**.
Autos is the default skin: a simple vertical capsule character. SpaceX is the
second skin: circle, pebble, squircle, capsule, triangle, hexagon, cloud or
droplet. Changing skin preserves identity and the selected expression.

Both skins share `live-v1` eyes: two white rounded pill bars. Blinking shrinks
each bar's height about its center; gaze moves both around the face. Sixteen
expressions adjust the same bars: neutral, attentive, surprised, excited, happy,
laughing, angry, sad, scared, suspicious, confused, curious, proud, shy,
unimpressed and sleepy. Expressions never select a different body or color.

## SDK

```ts
import {
  generateCharacter, renderCharacterSvg, getCharacterSkins,
  getCharacterExpressions, agentAvatar,
} from '@openagentid/sdk';

const did = 'did:oas:openagent:agent:preview';
const autos = generateCharacter(did); // Autos, neutral, animated, size 512
const spacex = generateCharacter(did, {
  skin: 'spacex', skinVersion: 1, eyeStyle: 'live-v1',
  shape: 'cloud', expression: 'curious', size: 256,
});
const staticSvg = renderCharacterSvg(did, {
  skin: 'autos', expression: 'happy', animated: false,
  state: { blink: 0.4, gaze: { x: 0.3, y: -0.2 } },
});
```

`generateCharacter` returns the DID, skin, skinVersion, eyeStyle, selected shape,
expression, color, size, animation choice, normalized eye state and SVG.
`getCharacterSkins()` returns the immutable versioned catalog with each skin's
supported shapes and expressions. `getCharacterExpressions()` lists shared IDs.
These exports are also available through `@openagentid/sdk/characters`.

Agent and agent-instance DIDs are supported, including literal legacy
`did:l1fe` identifiers. Validation refuses other entity kinds. Deterministic
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
optional `avatarSkin` field; runtime blink/gaze are presentation state, not
identity claims. Hosts authorize profile edits through their existing owner
and agent policy. The open renderer cannot edit a profile.

`agentAvatar(did, profile, options)` returns an HTTPS override when present,
otherwise a self-contained SVG data URL. Agents with no explicit skin use
Autos. Clearing an override restores the selected skin. Setting
`avatarSkin:null` explicitly selects the existing OAS Glyph; non-agent defaults
and Glyph codewords remain unchanged. Runtime `options.expression` overrides
the preferred profile expression, while `options.state` supplies blink/gaze.

For reduced motion, request `animated:false` and update poses deliberately.
Animated SVG uses synchronized SMIL for blinking and gaze, without scripts,
external assets or fonts. No remote image is fetched by the renderer.

## Public HTTP API

Mount `createCharacterApiHandler()` from `@openagentid/sdk/character-api` in any
Fetch-compatible server. Default base path is `/v1/characters`; a validated
`basePath` option supports another mount. The Node service and interactive
preview in `services/character-api` provide a deployable reference.

| Method | Path | Result |
| --- | --- | --- |
| GET / HEAD | `/v1/characters/skins` | Versioned skin/shape/expression catalog |
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
curl "$OAID_CHARACTER_API/v1/characters/svg/did%3Aoas%3Aopenagent%3Aagent%3Apreview?skin=spacex&shape=cloud&expression=curious&animated=false"
curl "$OAID_CHARACTER_API/v1/characters/generate" \
  -H 'Content-Type: application/json' \
  --data '{"did":"did:oas:openagent:agent:preview","skin":"autos","expression":"happy"}'
```

GET options: `skin`, `skinVersion`, `eyeStyle`, `shape`, `expression`, `size`,
`animated`, `blink`, `gazeX`, `gazeY`. POST takes the corresponding SDK options,
with `state:{blink,gaze:{x,y}}`. Gaze coordinates must be supplied together.
Size is an integer 32–2048; blink is 0–1; each gaze coordinate is -1–1.
Unknown fields, duplicate query parameters, unsupported versions, malformed
JSON/DIDs and incompatible shape/skin combinations are refused.

The body limit is 16 KiB, the URL limit 8192 bytes and the DID limit 512
characters. GET/HEAD representations have strong ETags and conditional 304
responses. Public CORS applies to successful, error and conditional responses;
POST/error responses use `no-store`. SVG responses carry a restrictive CSP and
`nosniff`. The exact contract is in [OpenAPI](character-api.openapi.json).

Generation is free, public presentation. It proves no key possession, owner
chain, revocation status, identity registration or authority. Use the separate
[identity verifier](identity-verification.md) when authentication is required.

## Versioning and release

SDK 0.2.1 adds this character API after the separately reviewed 0.2.0 identity
release. OIDC remains 0.2.0. Skin version 1 and eye style `live-v1` are explicit
so future skins or eye designs can be added without changing existing avatars.
Only the current catalog is accepted today. Canonical Glyph generation stays
available through `oasGlyph`, `glyphEndpoint` and `oaid glyph`.
