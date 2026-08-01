# @openagentid/sdk

**Agent auth in 3 lines.** Clerk for autonomous agents.

One `import` wraps [OAS](https://openagent.id) identity, [Arsenal](https://github.com/OpenAgentID/arsenal) scoped credentials, and [AEGIS](https://github.com/OpenAgentID/aegis) verification into a single developer-facing surface. Works in Node 20+, Bun, Deno, the browser, and Cloudflare Workers.

```ts
import { OpenAgent } from '@openagentid/sdk';

const agent = await OpenAgent.createAgent({
  parent: 'did:oas:l1fe:hmr:alice',
  name: 'my-bot',
  scopes: ['openai:chat:completions', 'github:repo:read'],
});

const creds = await agent.credentialsFor('openai');
const res   = await creds.fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  body: JSON.stringify({ model: 'gpt-4', messages }),
});
```

That's it. You now have an OAS identity whose privileged authority must resolve through Sigil-backed lineage, scoped Arsenal credentials that route through a secure proxy, and a drop-in `fetch` that injects the right auth header — all without a single plaintext API key touching your process.

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

## Runtime support

| Runtime            | Status       |
|--------------------|--------------|
| Node.js ≥ 20       | Supported    |
| Bun ≥ 1.0          | Supported    |
| Deno               | Supported    |
| Browsers           | Supported    |
| Cloudflare Workers | Supported    |

The SDK has no Node-only dependencies. Native `fetch` is the only required
runtime primitive.

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
