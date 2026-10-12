# OpenAgentID 0.5.0 release contents

This candidate contains two publishable archives:

| Package | Version | Contents |
| --- | --- | --- |
| `@openagentid/sdk` | `0.5.0` | Existing identity APIs and CLI; 17 character families, 62 distinct kinds, shared live eyes, default face framing, full-character option, public catalog and OpenAPI; ESM/CommonJS, types and self-contained browser module |
| `create-openagent` | `0.3.0` | Existing real-key local signer/receiver starter pinned to SDK 0.5.0, catalog-driven family/kind controls and face avatars reacting to verified request status |

`@openagentid/oidc@0.2.0` is unchanged. No new service, account, private package,
identity lookup or external art host is required to generate any character.
Both archives retain the existing Apache-2.0 / MIT licenses.

## Characters

Autos stays the default. SpaceX remains available. New year-round families are
Fold, Sprig, Ripple, Halo, Purl, Prism, Coil, Kiln, Wisp, Relay, Cairn and Tuft,
with three distinct kinds each. Halloween, Thanksgiving and Christmas each
have five kinds. The [complete catalog](characters.md#families-and-kinds)
lists their stable API identifiers.

Every family shares all eighteen expressions, status mapping, smooth interrupted
transitions, blinking, gaze and system reduced-motion behavior. Appearance
changes preserve the mounted SVG/eye nodes and current animator state.

## Migration

Rendering now defaults to the upper face crop. Use `view:'full'` in SDK/player
or profile fallback options, `view=full` in HTTP, or `--view full` in the CLI for
a complete illustration. Autos eyes sit near the top of the head in either
view. Clients can apply a normal circle or rounded-square mask.

Persist `avatarSkin:{skin,skinVersion:1,eyeStyle:'live-v1',shape?}` as before;
`shape` identifies a kind within a family. Obtain choices with
`getCharacterSkins()`, `GET /v1/characters/skins`, or `oaid avatar skins`.
Broaden consumer allowlists before persisting new families. Framing stays a
render option; it is not a profile claim or runtime status.

Legacy Autos/SpaceX DID-seeded kinds and colors are unchanged. New families
use their own curated material palettes and DID-selected kinds. There is no
automatic holiday switch. Identity, custody, proof verification, revocation
and authorization contracts are unchanged.

## Qualification and publication

Publish only the exact archives from the green remote qualification at the
independently reviewed PR head. Checks cover all family/kind API combinations,
strict profile and HTTP validation, deterministic SVGs and local paint references,
face-mask expression bounds, persistent eye nodes, reduced motion and actual
signed local requests driving viewer status. Package SHA-256/integrity, PR/head,
CI and review receipts accompany publication.

The starter proves the open-source local path. Actual o.page rollout separately
requires Orbit's authorized canonical agent/status integration and consumer
upgrade; a demo or local signed request is not production profile acceptance.
