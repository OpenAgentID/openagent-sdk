# Quickstart — TypeScript

This is the three-line demo. Given a parent identity and some scopes, you can mint an agent, authenticate a request that arrived with its token, and fetch a credentialed HTTP call — all without ever touching a provider API key.

## The three lines

```ts
import { OpenAgent } from '@openagent/sdk';

const agent = await OpenAgent.createAgent({ parent: 'did:oas:acme:hmr:alice', name: 'research-bot', scopes: ['openai:chat:invoke'] });
const ctx   = await OpenAgent.authenticate(request);
const creds = await agent.credentialsFor('openai');
```

Three lines, three responsibilities. `createAgent` mints a new DID under the parent's lineage and issues an Arsenal capability token. `authenticate` takes an inbound HTTP request and returns a verified context — who the caller is, what lineage they come from, which scopes they hold, and whether any AEGIS policies should apply. `credentialsFor` returns a fetch-shaped object that transparently attaches the right credential when you call `.fetch()` or `.post()` — but the underlying API key never enters your process.

## A complete server

Here's a real Node HTTP server that gates a `/chat` endpoint by agent identity:

```ts
import { createServer } from 'node:http';
import { OpenAgent } from '@openagent/sdk';

const server = createServer(async (req, res) => {
  try {
    const ctx = await OpenAgent.authenticate(req);

    if (!ctx.scopes.includes('openai:chat:invoke')) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'missing scope openai:chat:invoke' }));
      return;
    }

    // Load the agent on behalf of the caller.
    const agent = await OpenAgent.loadAgent(ctx.did);
    const openai = await agent.credentialsFor('openai');

    const body = await new Response(req).text();
    const upstream = await openai.post('https://api.openai.com/v1/chat/completions', {
      headers: { 'content-type': 'application/json' },
      body,
    });

    res.writeHead(upstream.status, { 'content-type': 'application/json' });
    res.end(await upstream.text());
  } catch (err: unknown) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
});

server.listen(3000, () => console.log('listening on :3000'));
```

Run it:

```bash
bun run server.ts
```

On a request, `OpenAgent.authenticate` looks for one of: `Authorization: OpenAgent <token>`, `Authorization: Bearer <token>`, `X-OpenAgent-Token`, or an `oa_token` query parameter. If the verifier accepts the token, you get back an `AuthContext` object. If none does, it throws `OpenAgentError` with a `code` you can switch on.

`agent.credentialsFor('openai')` is the interesting line. You never told OpenAgent what your OpenAI API key is — because you didn't need to. The Arsenal broker in your deployment holds the key. When your code calls `openai.post(url, opts)`, the SDK talks to the broker, the broker attaches the Authorization header, the broker proxies upstream, and the broker returns the response. Your agent process never sees the key and never has to rotate it.

## What happens on the wire

The first time you call `createAgent`, OpenAgent does the following:

1. Verifies that the parent DID exists and the local process is authorized to act on its behalf (usually because you're holding the parent's signing key or a delegated ACT).
2. Mints a new Ed25519 keypair and derives a DID of the form `did:oas:<namespace>:agent:<fingerprint>`.
3. Writes a lineage proof binding the new agent to its parent, signed by the parent key.
4. Requests an Arsenal ACT from the broker, scoped to `openai:chat:invoke` and bound to the new DID.
5. Returns the `Agent` object, which holds the DID, the ACT, and a handle to the broker.

Every `credentialsFor` call you make later is scoped by the ACT — if the scope doesn't include `openai:chat:invoke`, the broker will refuse to proxy the request and the SDK will throw `ScopeDenied`.

Continue with the [core concepts](core-concepts.md) to understand what "lineage" and "scopes" mean, or jump to [creating an agent](../guides/creating-an-agent.md) for the full-featured guide.
