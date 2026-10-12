# Creating an Agent

SDK 0.7.1 provides a complete local identity path on Node 20+: generate a real
Ed25519 keypair, persist its OAS DID, and prove possession to an application that
explicitly trusts that public identity. No Life account, hosted resolver or
private package is required.

For a working HTTP application and animated avatar, start with the
[TypeScript quickstart](../getting-started/quickstart-typescript.md). This guide
covers provisioning and persistence; creating an identity does not start an
agent worker or grant access to an external service.

## Create a local identity and authorize it at a receiver

Install the public SDK:

```sh
npm install @openagentid/sdk@0.7.1
```

Run this first-run example in a new directory. The two workspace directories
must not already exist; initialization refuses to overwrite existing state.
Save it as `provision.mjs` and run `node provision.mjs` from that application
directory. Node 20 runs this JavaScript directly; no TypeScript runner is needed.

```js
import { OpenAgentWorkspace } from '@openagentid/sdk/local';

const audience = 'urn:openagent:research-app';
const signer = await OpenAgentWorkspace.initialize('./agent-keys', { audience });
const receiver = await OpenAgentWorkspace.initialize('./app-trust', { audience });
const agent = await signer.createAgent('Research assistant');

// An operator or application onboarding policy approves this public identity.
// Never import an unknown caller's key automatically from its proof.
const publicIdentity = await signer.exportIdentity(agent.did);
await receiver.trustIdentity(publicIdentity);

// The receiver issues the challenge; the signer proves possession of its key.
const challenge = await receiver.issueChallenge(agent.did);
const proof = await signer.prove(agent.did, challenge);
const identity = await receiver.verify(proof, { nonce: challenge.nonce });
console.log(identity.did);
```

`createAgent(name)` generates and stores the private signing key in the signer's
workspace. It also authorizes that identity within that workspace. The separate
receiver gains trust only through the explicit `trustIdentity` call, which pins
the DID and public key without importing the private key. `exportIdentity`
returns a portable public document, not a credential or a grant of trust to
another application.

Transport the public document, challenge and proof through your application's
chosen protocol. This example's audience is an exact recipient identifier, not
a deployed endpoint. The receiver verifies the real signature, its current
local trust, the exact audience and the issued nonce before durably consuming
the challenge and proof ID. Reusing the proof is refused, including after
restart. Your application must separately authorize the requested operation and
tenant access.

The verified local identity has `owner: null` and `root.kind: 'self'`. This is a
real self-rooted identity under this receiver's explicit authority; it does not
claim a human owner or a LifeID registration. The local module supports direct
self roots, while the general [identity verifier](../identity-verification.md)
also supports authorized owned roots and signed delegation chains.

## Preserve identity across restarts

On subsequent runs, open the existing workspaces. Save this as `reopen.mjs` and
run `node reopen.mjs` from the same application directory:

```js
import { OpenAgentWorkspace } from '@openagentid/sdk/local';

const signer = await OpenAgentWorkspace.open('./agent-keys');
const receiver = await OpenAgentWorkspace.open('./app-trust');
const agents = await signer.listAgents();
console.log(agents.map(agent => agent.did));
```

Keep the original DID in your application's configuration and use it for new
challenges. Opening state preserves keys, trust pins, consumed challenges and
revocations. It does not create a replacement identity. Missing or corrupt
state, unsafe permissions and abandoned locks are refused rather than silently
reset.

Keep each workspace private, backed up and outside Git. Initialization creates
a workspace-local `.gitignore`; it does not edit your application's ignore
file. The signer holds private keys, and the receiver holds authoritative trust
and replay state. Use private persistent storage on one host, not ephemeral
serverless storage or a directory synchronized across replicas. Distributed
applications should supply their own authoritative resolver, root policy,
revocation and atomic replay storage to `IdentityVerifier`.

`await receiver.revoke(agent.did)` withdraws trust at that receiver and persists
across restart. Reimporting the same public identity does not undo revocation.
The operation neither deletes the signer's private key nor changes another
receiver's independent policy.

The local DID and trust pin persist; the possession proof does not. Local
challenges and proofs have 60-second lifetimes. Issue a fresh challenge and sign
a new proof for a new authentication attempt. There is no `agent.refresh()` or
`agent.startAutoRefresh()` API. A local possession proof is not an Arsenal ACT.

The agent name is a label, not its identifier. Local workspaces default to the
`openagent` namespace; select another namespace explicitly with
`initialize(directory, { audience, namespace })`. A namespace does not establish
organization membership or application permissions. See the SDK's
[local identity documentation](../../sdks/typescript/README.md#local-identity-no-hosted-service-required)
for the storage and integration boundary.

## Optional provider-backed provisioning

The `OpenAgentRuntime` facade supports applications with a real configured
`IdentityProvider`. Endpoint strings alone do not construct that provider, and
creation fails closed when it is missing. The provider contract requires:

| Method | Responsibility |
| --- | --- |
| `createAgentIdentity(input)` | Create an identity descended from the requested parent under the provider's authorized provisioning policy. |
| `resolve(did)` | Resolve the existing identity from the provider's authoritative storage. |
| `signChallenge(did, challenge)` | Sign with the authorized private-key custody for that DID. |
| `publicKey(did)` | Return the DID's public key. |

These helpers accept an already configured provider; they supply no replacement
implementation or implicit service registration:

```ts
import {
  OpenAgentRuntime,
  type CreateAgentInput,
  type Did,
  type IdentityProvider,
} from '@openagentid/sdk';

export async function createWithProvider(
  identity: IdentityProvider,
  input: CreateAgentInput,
) {
  const runtime = new OpenAgentRuntime({ clients: { identity } });
  return runtime.createAgent(input);
}

export async function loadWithProvider(identity: IdentityProvider, did: Did) {
  const runtime = new OpenAgentRuntime({ clients: { identity } });
  return runtime.loadAgent(did);
}
```

`CreateAgentInput` requires `parent`, `name` and a nonempty `scopes` array. Its
optional fields are `namespace`, `skills` and `metadata`. The facade validates
the input and calls `createAgentIdentity`; the provider must implement parent
authorization, key custody, lineage and scope policy. This parent requirement
belongs to the provider facade and does not prohibit the local self-root path.
The namespace comes from the explicit create input, then runtime configuration,
then the `openagent` default; the facade does not inherit it from a parent or
read an `OPENAGENT_NAMESPACE` environment variable.

The returned `OpenAgentInstance` exposes `did`, `document`, `identity()`,
`skillsPolicy()`, `withSkillsPolicy()` and `credentialsFor()`. Creation does not
implicitly request an ACT. `credentialsFor()` separately requires a configured
credential client; request authentication separately requires a configured
verification client. Provider persistence and token lifetime or renewal are
defined by those clients. The facade has no `expiresInHours` creation option,
`actCompactString` property or `loadAgent(did, { act })` overload.

## Integrate with Life when required

LifeID authenticates humans and organizations; a locally created self root does
not enroll a LifeID owner or grant access to Life services. A Life integration
needs an accepted authoritative registry binding for the exact agent DID and
owner/organization where required, authorized signer custody, and the receiving
service's tenant and operation permissions. Provision those through the actual
service integration; this SDK call does not invent a registration route.

In Life integrations, Blinds brokers agent credentials and Genesis KMS protects
customer secrets. Keep private keys and credentials in their authorized custody
and keep proofs out of logs. The DID and exported public identity can be shared
for explicit onboarding. Use the [verification contract](../identity-verification.md)
to bind keys, root authority, revocation and replay checks to the receiving
service's trusted authorities.
