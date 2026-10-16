# @openagentid/sdk

Open agent identity for the [Open Software](https://open.software) family.
The core is free and open, with no mandatory hosted service. Agents may have a
person/organization owner or be explicitly authorized self roots. Life offers
optional hosted integrations with LifeID, Blinds and Genesis KMS. Approved self
roots have no reduced access tier; each application controls its permissions.

## Local identity, no hosted service required

Use the Node-only local module in SDK 0.8.0 to keep identity
keys, public trust pins, single-use challenges and revocations on your own host:

```ts
import { OpenAgentWorkspace } from '@openagentid/sdk/local';

const app = await OpenAgentWorkspace.initialize('./.openagentid', {
  audience: 'https://my-app.example/agents',
});
const agent = await app.createAgent('Research assistant');
const challenge = await app.issueChallenge(agent.did);
const proof = await app.prove(agent.did, challenge);
const verified = await app.verify(proof, { nonce: challenge.nonce });
```

This example deliberately creates and trusts an identity in one application.
For separate parties, export the public identity and explicitly import it into
the receiver with `trustIdentity`; never automatically trust a submitted proof's
key. Use `open` after the first run; initialization refuses to overwrite state.
The [complete quickstart](https://github.com/OpenAgentID/openagent-sdk/blob/main/docs/getting-started/quickstart-typescript.md)
shows separate signer/receiver workspaces and the generated application.

The local module needs Node 20.19+ and private persistent storage on one host.
Keep its directory out of Git. No Life account, remote authority, private SDK or
telemetry is required. Existing `IdentityVerifier` callbacks support applications
that bring distributed storage or different trust authorities.

The `OpenAgent` facade still wraps separately configured OAS identity, Arsenal
credentials and AEGIS verification clients. It fails closed if a required client
is missing. Its endpoint options do not create those clients automatically.

## Version 0.8.0

Adds the One family: a round disc with one bar for an eye, drawn from agent-eye,
One's animated mark, with its own eye style `agent-eye-v1`. Twelve agent colours
and Digital One (`charcoal`); a DID selects a colour when none is stored. Hosts
that draw only Ones can use the light `@openagentid/sdk/one` entry, whose live
runtime is 14.5 KB gzipped. Autos remains the default family, and every existing
family renders exactly as before. Four statuses join the shared timeline for
every family (`typing`, `attention`, `paused`, `offline`), and `theme` and
`label` join the rendering options. Identity documents that store a One
appearance do not parse in SDK 0.7.3 and earlier: keep One colours in the
application's own agent records until every reader upgrades. See
[the One family](#the-one-family) and the
[0.8.0 release contents](../../docs/release-0.8.0.md).

## Version 0.7.3

The supported integrations now target the current SDK with real signature,
request, replay and revocation coverage. Use HTTP/MCP/Claude/SCIM/EAS 0.2.0,
sdk-testing 0.1.2 and crypto-wasm 0.1.2. OIDC remains 0.2.0.

ACT verification reads the trusted receiver clock on every call; an explicit
`.atTime()` is only needed for controlled replay or tests. Native `Request`
objects retain their method, headers, body and cancellation when passed to a
credential handle. Published component adapters require explicit trust and
application context rather than silently inventing authority clients.

See the [compatibility release and migration guide](../../docs/release-0.7.3.md)
and [runnable examples](../../examples/typescript).

## Version 0.7.2

All families use brighter curated colors, with shared plush lighting that keeps
the pigment visible. This intentionally refreshes rendered RGB values while
preserving DID seeds, shapes, expression state and the appearance schema.

Every character family defaults to a soft plush finish and on-face eyes. Pass
`finish: 'flat'` for flat vector material or `eyePlacement: 'raised'` for the same
live eyes on raised pods. These strictly typed appearance choices are independent
of identity, expression and activity state. The descriptor includes their resolved
values; stored appearance fields remain optional.

```ts
import { mountCharacter } from '@openagentid/sdk/browser';

const element = document.querySelector('#agent-avatar');
if (!element) throw new Error('Missing avatar element');
const player = mountCharacter(element, agent.did, { accessories: ['glasses', 'headphones'] });
player.update({ status: 'reasoning' });
player.setAppearance({ finish: 'flat', eyePlacement: 'raised' });
// Dispose when the host removes the avatar.
player.dispose();
```

Glasses retain fixed lens dimensions while following gaze, with temples reaching
the head sides. Headphones fit outside the head; the face crop reserves room for
them. See the [0.7.2 release contents](../../docs/release-0.7.2.md).

## Version 0.3.0

Use the same live expression state with Autos (default) or SpaceX:

```ts
import { mountCharacter } from '@openagentid/sdk/character-player';

const avatar = mountCharacter(document.querySelector('#agent-avatar')!, agent.did);
avatar.update({ status: 'reasoning' }); // thoughtful, with a smooth eye transition
avatar.update({ status: 'happy' });     // expression IDs work as statuses too
avatar.update({ status: 'blocked' });   // concerned
avatar.setAppearance({ skin: 'spacex' }); // same expression and ongoing timeline
// On component unmount:
avatar.dispose();
```

Updates come from your harness/client's existing authorized state channel. They
change presentation only. `createCharacterAnimator` from
`@openagentid/sdk/character-animation` provides the same sampled geometry without
a DOM; `@openagentid/sdk/browser` is a self-contained browser ESM bundle. The player
respects system reduced motion by default. See the
[full state and HTTP contract](https://github.com/OpenAgentID/openagent-sdk/blob/main/docs/characters.md).

## Version 0.2.2

Autos remains the default animated agent skin; SpaceX is optional. Both share
sixteen live-eye expressions. Existing IAM `did:oas:agent-instance:<ULID>`
identifiers now render without rewriting their DID. `isAgentAvatarDid` from the
root, characters and glyph exports classifies display input only. It grants
no identity authority and does not change authentication schemas.

## Version 0.2.0

- [Identity verification](https://github.com/OpenAgentID/openagent-sdk/blob/main/docs/identity-verification.md): `IdentityVerifier`, a fetch-compatible HTTP handler and remote client verify possession signatures, signed lineage to owned or self-rooted authorities, current revocation and replay prevention.
- [OAS Glyph](https://github.com/OpenAgentID/openagent-sdk/blob/main/docs/glyph.md): `oasGlyph(did)`, `agentAvatar(did, profile)` and `glyphEndpoint(request)` supply deterministic SVG avatars and an optional HTTPS `avatarOverride`.
- [OATS](https://github.com/OpenAgentID/openagent-sdk/blob/main/docs/oats.md): `VerifiedOatsScorer` verifies evidence before scoring; `createOatsEvidenceVerifier` implements the existing OAS Ed25519/JCS attestation profile with authoritative identity and revocation sources.
- [OIDC](https://github.com/OpenAgentID/openagent-sdk/tree/main/bridges/oidc/typescript): the separate `@openagentid/oidc` package supplies discovery, JWKS, signed authorization-code/PKCE login and LifeID owner federation.

The Node CLI ships in this package:

```sh
oaid verify --endpoint https://identity.example.com/v1/identity/verify --proof proof.json --nonce issued-challenge
oaid glyph did:oas:openagent:agent:example --output avatar.svg
oaid oidc doctor --issuer https://identity.example.com
```

Verification endpoints require a server-issued challenge and configured real
authorities. The doctor checks protocol configuration and public keys; it does
not establish that an agent completed a login. The source release does not
configure or deploy LifeID, Blinds or Genesis for a consumer.

## Install

```sh
bun add @openagentid/sdk
# or
npm install @openagentid/sdk
```

Peer dependencies (optional — production fails closed when a subsystem is unconfigured; in-memory fakes for tests live in `@openagentid/sdk-testing`):

- `@openagentid/oas-sdk` — OAS identity resolver, signer, and Sigil-backed lineage verifier contract
- `@openagentid/arsenal-sdk` — Arsenal credential broker client
- `@openagentid/aegis-sdk` — AEGIS verification client
- `@openagentid/crypto-wasm` — Shared WASM crypto primitives

## The three-function happy path

1. **`OpenAgent.createAgent({ parent, name, scopes })`** — mints a new OAS
   agent identity with lineage material, then requires Sigil-backed authority
   before privileged scopes are accepted.
2. **`agent.credentialsFor(provider)`** — returns a short-lived
   `CredentialHandle` whose `.fetch(url, init)` is a drop-in replacement
   for the global `fetch`. The Arsenal broker injects the right bearer /
   API key / OAuth token server-side; your code never sees the secret.
3. **`OpenAgent.authenticate(request)`** — takes a WHATWG `Request` and
   returns a verified `AuthContext` with DID, Sigil-backed lineage path, scopes, and
   expiry.

## Streaming

Because `CredentialHandle.fetch` returns a standard `Response`, streaming
LLM responses just work:

```ts
const res = await creds.fetch(url, { body: streamingBody });
const reader = res.body!.getReader();
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  process.stdout.write(new TextDecoder().decode(value));
}
```

## Skills policy

```ts
const skills = agent.skillsPolicy();

if (skills.canInvoke('frontend-design')) {
  await runFrontendDesign();
}

skills.assertCanInvoke('backend-write'); // throws SkillDeniedError if denied
```

Skills are immutable — `agent.withSkillsPolicy(...)` returns a new agent
with the updated policy, leaving the original untouched.

## Escape hatches

The SDK exposes every underlying client for callers who need them:

```ts
const runtime = OpenAgent.runtime();
runtime.identity();      // -> IdentityProvider (OAS)
runtime.arsenal();       // -> ArsenalClient
runtime.verification();  // -> VerificationClient (AEGIS)
```

You can also instantiate multiple runtimes in one process:

```ts
import { OpenAgentRuntime } from '@openagentid/sdk';

const runtime = new OpenAgentRuntime({
  namespace: 'mytenant',
  clients: { identity: yourIdentityClient, credentials: yourBrokerClient,
    verification: yourVerificationClient },
});
```

## Agent avatars and the open character API

Autos is the default body/face skin for agents. SpaceX provides geometric
shapes. Both use the same eighteen expressions and two live pill eyes. Change
skin independently of expression, blink or gaze; neither changes the DID.

```ts
import { agentAvatar, generateCharacter, createCharacterApiHandler } from '@openagentid/sdk';

const did = 'did:oas:openagent:agent:preview';
const character = generateCharacter(did, { expression: 'curious' }); // Autos
const svg = generateCharacter(did, { skin: 'spacex', shape: 'cloud', expression: 'curious' }).svg;
const avatarUrl = agentAvatar(did, {
  avatarSkin: { skin: 'autos', skinVersion: 1, eyeStyle: 'live-v1' },
  avatarExpression: 'happy',
}, { animated: false, state: { blink: 0.25, gaze: { x: 0.4, y: 0 } } });
const handle = createCharacterApiHandler(); // Fetch Request -> Promise<Response>
```

`avatarOverride` remains a user/agent-selected HTTPS image with highest
priority. Clearing it restores the selected skin; `avatarSkin:null` explicitly
selects the OAS Glyph. Non-agent principals still default to their Glyph.
For reduced motion or runtime-controlled eyes, use `animated:false`.
Character generation is public decoration, not identity authentication.

See [the full API contract](../../docs/characters.md) and
[OpenAPI 3.1 schema](../../docs/character-api.openapi.json).

### The One family

Choose `skin: 'one'` to draw an agent as One: a round disc with one bar for an
eye, in its own colour. Its kinds (`shape`) are the twelve agent colours
`blue`, `red`, `sky`, `green`, `yellow`, `pink`, `plum`, `teal`, `lime`, `mint`,
`lilac` and `coral`, plus `charcoal`, Digital One, for One itself. The head is
still at rest and moves only when its state changes: working reads along,
reasoning ponders, typing taps, attention looks straight at you, success
smiles, paused dozes, error goes dizzy.

```ts
import { generateCharacter, nextOneColor, oneColorForDid } from '@openagentid/sdk';
import { mountCharacter } from '@openagentid/sdk/browser';

const color = nextOneColor(teamColors);        // first free colour in the default order (groups: { color, group })
oneColorForDid(agent.did);                     // the DID default when no colour is stored
const still = generateCharacter(agent.did, { skin: 'one', shape: color, size: 44,
  state: { status: 'working', gaze: { x: 0.4, y: 0.1 } } }).svg; // server render or reduced motion
const player = mountCharacter(element, agent.did, { skin: 'one', shape: color, size: 44,
  label: agent.name, state: { gaze: { x: 0.4, y: 0.1 } } });
player.update({ status: 'attention' });
player.setAppearance({ shape: 'teal', theme: 'dark' });
```

```ts
import { renderOne } from '@openagentid/sdk/one';          // server: stills, DID defaults, blank heads
import { mountOne } from '@openagentid/sdk/browser/one';  // client: the live runtime alone

const html = renderOne({ did: agent.did, color, size: 44, state });
const head = mountOne(element, { color, size: 44, label: agent.name, follow: false, state }); // replaces the still
head.setAppearance({ color: 'teal' });                    // a blank head plays First blink instead
```

`state.gaze` is where the head's content is, and a One at rest looks there.
One heads render from 16 px. The still glyph is decorative unless `label` names
it, never embeds animation or element identifiers, and keeps finish, eye
placement and accessories in its descriptor without drawing them. Live heads
share one ticker per window that sleeps at rest, move at most one per list and
three per window, and hold still under reduced motion. The geometry is a
TypeScript port of agent-eye, written by JR and contributed by its copyright
holder, L1fe Labs, Inc., under Apache-2.0 OR MIT; the port is checked against
the byte-identical master in `test/fixtures/agent-eye` (sha256
`83cc379a…bba4`). See
[the One family](../../docs/characters.md#the-one-family) for the palette,
faces, calm rules and provenance.

## Runtime support

| Runtime            | Status       |
|--------------------|--------------|
| Node.js ≥ 20       | Supported    |
| Bun ≥ 1.0          | Supported    |
| Deno               | Supported    |
| Browsers           | Supported    |
| Cloudflare Workers | Supported    |

Library entry points remain independent of Node APIs. New signature verification
requires WebCrypto (including Ed25519 for OAS attestations), and HTTP helpers use
native `fetch`, `Request` and `Response`. The `oaid` CLI requires Node.js 20+;
the separate OIDC provider requires Node.js 20.19+.

## Errors

All SDK errors extend `OpenAgentError` with a stable machine-readable `code`:

```ts
import { OpenAgentError, ErrorCode } from '@openagentid/sdk';

try {
  await agent.credentialsFor('openai');
} catch (err) {
  if (err instanceof OpenAgentError && err.code === ErrorCode.CREDENTIAL_SCOPE_DENIED) {
    // handle scope denial
  }
}
```

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT), at your option.

### Character accessories

Glasses and headphones are optional, combinable layers on every character family.
Use `accessories: ['glasses', 'headphones']` when rendering or mounting a character,
and `player.setAppearance({ accessories: [] })` to remove them without resetting
its live eyes. See the [accessory release guide](../../docs/release-0.6.0.md) for profile, API and CLI examples.
