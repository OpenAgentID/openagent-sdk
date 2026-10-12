# @openagentid/sdk

Open agent identity for the [Open Software](https://open.software) family.
The core is free and open, with no mandatory hosted service. Agents may have a
person/organization owner or be explicitly authorized self roots. Life offers
optional hosted integrations with LifeID, Blinds and Genesis KMS. Approved self
roots have no reduced access tier; each application controls its permissions.

## Local identity, no hosted service required

Use the Node-only local module in SDK 0.7.1 to keep identity
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

The local module needs Node 20+ and private persistent storage on one host.
Keep its directory out of Git. No Life account, remote authority, private SDK or
telemetry is required. Existing `IdentityVerifier` callbacks support applications
that bring distributed storage or different trust authorities.

The `OpenAgent` facade still wraps separately configured OAS identity, Arsenal
credentials and AEGIS verification clients. It fails closed if a required client
is missing. Its endpoint options do not create those clients automatically.

## Version 0.7.1

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
them. See the [0.7.1 release contents](../../docs/release-0.7.1.md).

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
