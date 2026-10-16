# Developer tooling

OpenAgentID provides agent identity, verification and animated avatars on
infrastructure you control. The public first-run path requires Node 20.19+ and npm;
it needs no Life account, hosted resolver or private integration package.

| Published package | Version | Purpose |
| --- | --- | --- |
| `create-openagent` | 0.6.0 | Generate a working HTTP receiver, signer and browser UI. |
| `@openagentid/sdk` | 0.8.0 | Local identity, `oaid` CLI, portable verification, OATS and avatars. |
| `@openagentid/oidc` | 0.2.0 | Run a configured agent OIDC provider and optional owner federation. |

## Start a working application

```sh
npx create-openagent@0.6.0 my-agent-app --yes
cd my-agent-app
npm install
npm run dev
```

Open the printed loopback URL. Run `npm run agent` in a second terminal to send
a real signed request to the receiver. Its verified request drives the local
character's activity. The generated server has a matching client, browser
player and HTTP regression tests; inspect the generated README for commands.

The starter explicitly exchanges the signer's public identity with its receiver
during setup. The receiver's approval is local application policy, not global
registration or a claim of a human owner. Keys, trust, replay state and
revocations survive restart in separate signer/receiver workspaces. The
generated application listens on loopback; deployment requires a deliberate
HTTPS transport, authorization policy and persistent storage choice.

## Use the CLI with an existing application

Install the SDK locally, then invoke its bundled binary. `--no-install` keeps
these calls on the installed package rather than searching for an unrelated
package named `oaid`.

```sh
npm install @openagentid/sdk@0.8.0
npx --no-install oaid --version
npx --no-install oaid --help
```

This first-run sequence uses two new persistent directories. It reads the actual
DID and nonce emitted by the CLI; it uses no invented identity or challenge.
Run the challenge/proof steps within their 60-second window.

```sh
umask 077
npx --no-install oaid init --directory .oaid-signer --audience urn:example:receiver
npx --no-install oaid init --directory .oaid-receiver --audience urn:example:receiver
npx --no-install oaid agent create --directory .oaid-signer --name researcher > agent.json
DID="$(node -p "JSON.parse(require('node:fs').readFileSync('agent.json', 'utf8')).did")"
npx --no-install oaid agent export --directory .oaid-signer --did "$DID" --output public-identity.json

# The receiver operator explicitly approves this public identity.
npx --no-install oaid agent trust --directory .oaid-receiver --document public-identity.json
npx --no-install oaid challenge --directory .oaid-receiver --did "$DID" > challenge.json
NONCE="$(node -p "JSON.parse(require('node:fs').readFileSync('challenge.json', 'utf8')).nonce")"
AUDIENCE="$(node -p "JSON.parse(require('node:fs').readFileSync('challenge.json', 'utf8')).audience")"
npx --no-install oaid prove --directory .oaid-signer --did "$DID" --nonce "$NONCE" --audience "$AUDIENCE" --output proof.json
npx --no-install oaid verify --local --directory .oaid-receiver --proof proof.json --nonce "$NONCE"
npx --no-install oaid doctor --directory .oaid-receiver

# Withdraw this receiver's trust when the identity should no longer authenticate.
npx --no-install oaid agent revoke --directory .oaid-receiver --did "$DID"
```

Only import a public identity after your receiver's onboarding policy approves
it. A caller's submitted proof or key must never approve itself. Verification
checks the real Ed25519 signature, exact audience, receiver-issued nonce, current
trust and revocation, and durably consumes the nonce and proof ID. Reuse fails,
including after restart. `revoke` persists at this receiver; importing the same
public identity again does not undo it. Other receivers have independent policy.

Treat proof/challenge transfer files as short-lived authentication material:
keep them private and outside logs and version control.

`init` refuses to overwrite an existing workspace. Open it with
`OpenAgentWorkspace.open(directory)` on later runs. Output files supplied with
`--output` are exclusively created with private permissions. Commands return
JSON or SVG and a nonzero exit code on failure. `doctor` validates storage and
reports metadata; it does not complete an external login or repair damaged state.

### Key and storage boundaries

`OpenAgentWorkspace` from `@openagentid/sdk/local` is a Node-only, single-host
authority. It stores private Ed25519 keys at the signer and pinned public keys
at the receiver. A lock covers verification, current revocation and durable
nonce/JTI consumption. Private files are fsynced and replaced atomically; unsafe
permissions, links, corrupt state and abandoned locks fail closed. Initialization
creates a workspace-local `.gitignore`.

Keep the directories private, backed up and outside source control. The files
are protected by filesystem custody, not encrypted KMS storage. Do not replicate
them across machines or place them on ephemeral serverless storage. Distributed
receivers supply their own authoritative resolver, root policy, revocation and
atomic replay store to `IdentityVerifier`.

Local results are authorized self roots: `owner: null`, `root.kind: 'self'`.
They establish possession and receiver-local trust. They do not issue an ACT,
start an agent runtime or grant application permissions. See
[creating an agent](guides/creating-an-agent.md) for the full persistence example.

## Verify portable evidence in your service

`IdentityVerifier` is independent of the local filesystem implementation. Configure:

- `resolveDid` with authoritative public keys and explicit authentication or
  delegation key purposes.
- `authorizeOwner` for a verified person/org root, or an explicit
  `authorizeSelfRoot` policy for a self-rooted agent. Self roots default to denial.
- `checkRevocation` for current status of every DID and credential in the chain.
- `replay.consume` to atomically consume the service-issued challenge and unique
  issuer/token ID. Multiple replicas need shared durable storage.
- `resolveDelegations` when using `resolve` to recheck current signed lineage.

`verify(proof, { audience, nonce })` returns `{ did, owner, root, lineage, expiresAt }`
after signature, lineage, root authority, revocation and replay checks.
`verifyLineage` and `resolve` check current authority without proving fresh key
possession. Your application then authorizes the operation and tenant.

`createIdentityVerificationHandler(verifier, { audience, resolveNonce })` is a
Fetch-compatible POST handler. The server resolves the nonce from its own issued
challenge/session; it must not echo a caller-selected header. A trusted HTTPS
service can be called with `verifyIdentityRemote(endpoint, proof, { nonce })` or:

```sh
npx --no-install oaid verify --endpoint https://identity.example.com/v1/verify --proof proof.json --nonce "$NONCE"
```

The endpoint above denotes an application-owned service, not an OpenAgentID
hosted endpoint. See [identity verification](identity-verification.md) for exact
types, time limits, key-purpose requirements and HTTP errors.

## Put live eyes in your application

```ts
import { mountCharacter } from '@openagentid/sdk/browser';

const element = document.querySelector('#agent-avatar');
if (!element) throw new Error('Missing avatar element');
// Rendering preview only; use your registered agent's literal DID in production.
const agentDid = 'did:oas:openagent:agent:preview';
const player = mountCharacter(element, agentDid); // Autos, plush, face eyes, avatar crop

// Deliver these from your application's authorized activity source.
player.update({ status: 'working' });
player.update({ status: 'success' });
player.setAppearance({ skin: 'spacex', accessories: ['glasses', 'headphones'] });
player.setAppearance({ finish: 'flat', eyePlacement: 'raised' });
player.update({ expression: 'curious' }); // Explicit expression overrides the current status.
player.update({ expression: null });    // Return to that status's expression.

// When the host component unmounts:
player.dispose();
```

All 18 families and 75 kinds share 18 expressions. The two-eyed families add
ambient blink/gaze and smooth, interruptible transitions; the One family holds
still at rest and moves only when its state changes. Use `getCharacterSkins()` for the exact catalog and
valid shapes; omitted shape selects deterministically from the DID. A changed
skin resets an incompatible old shape. `setAppearance({ shape: null })` returns
to the DID-selected shape; `accessories: []` removes both wearable layers.

Appearance updates preserve the SVG, eye nodes and animation clock; switching to
or from the One family replaces the head and keeps its state. `view: 'avatar'`
frames the face by default; `view: 'full'` renders the complete body. `view` is a
rendering option, not a stored appearance field. Plush/flat finish, face/raised
eyes and wearables are independent of identity and expression state. Glasses
follow the eyes at fixed lens size; headphones fit outside the head.

The player defaults to system reduced motion, pauses scheduling on hidden pages
and removes its SVG/listeners/animation frame on disposal. A status update clears
the earlier explicit expression override. `working` selects attentive, `reasoning`
thoughtful, `success` happy, and `blocked`/`error` concerned. Map only real phases:
a running worker establishes working, not reasoning. Presentation supplies no
proof of presence, ownership or permission.

Use `generateCharacter`/`renderCharacterSvg` for static SVG and descriptors, or
`createCharacterAnimator` for clock-sampled geometry without a DOM. The
[character HTTP API](characters.md) supplies stateless JSON/SVG generation and
an OpenAPI schema. It accepts decoration inputs, not authenticated profile writes.

`agentAvatar(did, profile)` honors a safe `avatarOverride` first, defaults to Autos
when `avatarSkin` is absent and uses the original OAS Glyph when `avatarSkin: null`.
Saved `avatarExpression` is a preference; live status belongs to the host's
authorized channel. CLI equivalents include:

```sh
npx --no-install oaid avatar skins
npx --no-install oaid avatar accessories
npx --no-install oaid avatar "$DID" --skin spacex --view avatar --accessories glasses,headphones --status working --output avatar.svg
npx --no-install oaid glyph "$DID" --output glyph.svg
```

## OIDC, OATS and optional providers

`@openagentid/oidc@0.2.0` supplies discovery, JWKS, signed ID tokens, authorization
code/PKCE and UserInfo. Production requires protected signing/cookie keys,
registered relying parties, durable shared provider storage, real proof
verification and current identity resolution. Owned mode can federate LifeID;
self-root mode requires explicit `allowSelfRooted: true` and current self-root
authority. It never invents a human assertion. See the
[OIDC provider guide](../bridges/oidc/typescript/README.md).

`oaid oidc doctor --issuer HTTPS_ISSUER` checks discovery and public signing keys.
It is configuration diagnosis, not an actual agent/RP login.

`VerifiedOatsScorer` accepts only verified attestation evidence from explicitly
trusted issuers. `createOatsEvidenceVerifier` implements the supported OAS
Ed25519/JCS proof profile with authoritative key purposes, root/lineage and
credential revocation. Scores do not establish identity or grant access. See
[OATS](oats.md).

The configured `OpenAgentRuntime` facade accepts concrete `clients.identity`,
`clients.credentials` and `clients.verification`. Endpoint strings alone do not
construct adapters; missing clients fail closed. Creation does not automatically
issue an ACT. Rust and optional OAS/Arsenal/AEGIS integrations have separate
dependency/access requirements; they are outside the public first-run path.

LifeID, Blinds and Genesis KMS are optional Life integrations. Existing
privileged-authority hooks and anchor adapters are described in
[lineage and anchor authority](architecture/lineage-finality.md); this public
path requires neither Sigil nor a Base chain backend.
