# Quickstart — TypeScript and JavaScript

The SDK 0.8.0 developer path runs on Node 20.19+ without a Life account, API key,
hosted resolver or private package. Keys and trust stay on your infrastructure.
The [developer-tooling guide](../developer-tooling.md) includes the complete CLI,
verification, OIDC/OATS and current browser integration map.

## Start a working application

```sh
npx create-openagent@0.6.0 my-agent-app --yes
cd my-agent-app
npm install
npm run dev
```

The starter starts a local HTTP application with an animated agent. In another
terminal, run `npm run agent` to authenticate an actual request. Autos is the
default skin, with soft plush and on-face eyes. Every family can instead use
flat material or raised eyes while retaining the same expression state and
selected glasses/headphones.
The starter keeps the signer and receiving application's trust store separate.
The application explicitly imports the signer's public identity during initial
setup. Restarting preserves the identity, consumed challenges and revocations.

No command registers an account, uploads a private key or contacts a Life
service. npm downloads public packages during installation; the identity flow
runs locally. The starter is bound to loopback. To deploy an application, choose
your HTTPS transport and storage/authorization policy deliberately.

## Add identity to an existing Node application

```sh
npm install @openagentid/sdk@0.8.0
```

This complete first-run example uses two separate persistent workspaces. Run it
in a new directory; initialization refuses to overwrite existing state.

```ts
import { OpenAgentWorkspace } from '@openagentid/sdk/local';

const audience = 'https://my-app.example/agent-requests';
const signer = await OpenAgentWorkspace.initialize('./agent-keys', { audience });
const receiver = await OpenAgentWorkspace.initialize('./app-trust', { audience });
const agent = await signer.createAgent('Research assistant');

// Explicitly authorize this public identity in this application.
// Do this through your operator/onboarding policy, never automatically from
// a possession proof submitted by an unknown caller.
await receiver.trustIdentity(await signer.exportIdentity(agent.did));

// Receiver issues a fresh, short-lived challenge for this agent.
const challenge = await receiver.issueChallenge(agent.did);
const proof = await signer.prove(agent.did, challenge);
const identity = await receiver.verify(proof, { nonce: challenge.nonce });
console.log(identity.did); // verified signature, current local trust, no replay
```

On subsequent runs, use `OpenAgentWorkspace.open('./agent-keys')` and
`OpenAgentWorkspace.open('./app-trust')`. Reusing the proof is refused, including
after restart. `await receiver.revoke(agent.did)` immediately removes trust at
this receiver; an existing key file is not deleted and another application's
independent trust policy is not changed.

Transport the public document, challenge and proof through your own application.
The signed proof binds the exact audience and issued nonce. It authenticates
identity; your application still decides permissions and tenant access. Never
accept a request's proposed public key as its own trust authority.

The file-backed workspace is for one host with a private persistent filesystem.
Do not put it on ephemeral serverless storage, synchronize it between hosts, or
commit it. Distributed applications can supply their own resolver, root trust,
revocation and atomic replay storage to the existing `IdentityVerifier`. The
workspace path must not pass through a symlink: the workspace refuses it with
`LocalWorkspaceError` code `unavailable`. On macOS the system temporary directory
is one (`/var` links to `/private/var`), so use a directory inside the project or
resolve the path with `fs.realpath`.

## Put a live avatar in your UI

```ts
import { mountCharacter } from '@openagentid/sdk/browser';

const element = document.querySelector('#avatar');
if (!element) throw new Error('Missing avatar element');
// Rendering preview only; use your registered agent's literal DID in production.
const agentDid = 'did:oas:openagent:agent:preview';
const avatar = mountCharacter(element, agentDid);
avatar.update({ status: 'reasoning' }); // thoughtful
avatar.update({ status: 'working' });   // attentive
avatar.update({ status: 'success' });   // happy
avatar.setAppearance({ skin: 'spacex' });
avatar.setAppearance({ finish: 'flat', eyePlacement: 'raised' });
// Dispose when the component unmounts.
avatar.dispose();
```

Feed `update` from the application's authorized activity channel. It changes the
presentation, not identity, permissions or the agent's saved profile. The player
preserves its animation timeline and honors system reduced motion. The catalog
contains 18 families, 77 kinds and 18 shared expressions, including the One family. `view: 'avatar'` frames
the face by default; use `view: 'full'` for the body. Stored appearance, render
framing and current activity remain independent. Map only real authorized phases
to status; a running process does not establish that it is reasoning.

## Inspect and integrate from the terminal

```sh
npx --no-install oaid --help
npx --no-install oaid init --directory .openagentid --audience https://my-app.example/agents
npx --no-install oaid agent create --directory .openagentid --name researcher
npx --no-install oaid doctor --directory .openagentid
```

Use `agent export`/`agent trust` to exchange public identity documents,
`challenge`/`prove`/`verify --local` for authenticated requests, and `agent revoke`
to withdraw this receiver's trust. Commands return JSON for automation and nonzero
exit codes on refusal. Run `npx --no-install oaid --help` after installing the SDK
for exact options; these calls use its bundled binary. `doctor` validates
workspace storage and reports metadata; it does not claim a remote login worked.

The existing remote `verify --endpoint`, `oidc doctor`, `glyph` and new `avatar`
commands remain available. See [identity verification](../identity-verification.md)
and [characters](../characters.md) for the protocol and presentation APIs.

## Optional integrations

`@openagentid/oidc` can bridge verified agents into an OIDC relying party.
It installs beside SDK 0.8.0 at 0.2.0 (0.3.0, with the Continue as Agent button,
pairs with SDK 0.7); production requires real signing
keys, registered clients, shared durable storage and current identity authority.
The `OpenAgent` facade supports separately configured identity, credential and
verification clients. Calling `OpenAgent.createAgent` with no identity client
fails closed; endpoint strings alone do not construct those clients. LifeID,
Blinds and Genesis are optional integration choices, not prerequisites for the
local identity and avatar path above.
