# @openagentid/sdk

Open agent identity for the [Open Software](https://open.software) family.
The core is free and open; Life operates hosted services around it. Humans
authenticate with LifeID; agents may have a person/organization owner or be
explicitly authorized self roots. Blinds brokers credentials, and Genesis KMS
holds customer secrets. Approved self roots have no reduced access tier.

One `import` wraps [OAS](https://openagent.id) identity, [Arsenal](https://github.com/OpenAgentID/arsenal) scoped credentials, and [AEGIS](https://github.com/OpenAgentID/aegis) verification into a single developer-facing surface. Works in Node 20+, Bun, Deno, the browser, and Cloudflare Workers.

```ts
import { OpenAgent } from '@openagentid/sdk';

const agent = await OpenAgent.createAgent({
  parent: 'did:oas:openagent:hmr:alice',
  name: 'my-bot',
  scopes: ['openai:chat:completions', 'github:repo:read'],
});

const creds = await agent.credentialsFor('openai');
const res   = await creds.fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  body: JSON.stringify({ model: 'gpt-4', messages }),
});
```

Configure the real identity authority, key custody and credential broker before
using this flow. Unconfigured production subsystems fail closed. New identities
default to the `openagent` namespace; signed legacy `did:l1fe` identities remain
readable without changing their identifiers.

## Version 0.3.0 (unreleased)

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
  endpoints: {
    oasResolver: 'https://did.mytenant.example',
    arsenalBroker: 'https://arsenal.mytenant.example',
    aegisVerifier: 'https://aegis.mytenant.example',
  },
});
```

## Agent avatars and the open character API

Autos is the default body/face skin for agents. SpaceX provides geometric
shapes. Both use the same sixteen expressions and two live pill eyes. Change
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
