# @openagentid/http

HTTP adapter for the OpenAgent Auth Protocol (OAAP) — middleware, client, and discovery for agent-to-service mutual authentication.

Carries the Core Protocol identity flow (challenge → proof → verified session) over HTTP. Works with Express, Hono, Cloudflare Workers, Deno, Bun, and any framework using the standard fetch `Request`/`Response` API.

## Install

```sh
npm install @openagentid/http
```

## Server: guard your API

`createOpenAgentMiddleware` handles the OAAP well-known endpoints and validates authenticated requests; the session store defaults to in-memory:

```ts
import { createOpenAgentMiddleware } from '@openagentid/http';

const middleware = createOpenAgentMiddleware({
  serverDid: 'did:oas:l1fe:service:my-api',
  verifySignature: async (publicKey, payload, signature) => {
    // verify the Ed25519 proof over the canonical challenge bytes
    return ed25519Verify(publicKey, payload, signature);
  },
});
```

## Client: authenticate as an agent

`HttpAuthClient` performs the full identity flow — discovery, challenge fetch, JCS-canonical signing, and proof — and returns an `AuthenticatedSession` whose `fetch` carries the session token:

```ts
import { HttpAuthClient } from '@openagentid/http';

const client = new HttpAuthClient({
  config: { did: 'did:oas:l1fe:agent:my-bot' },
  sign: async (payload) => base64url(ed25519Sign(privateKey, payload)),
  publicKey: async () => base64url(ed25519PublicKey(privateKey)),
});

const session = await client.authenticate('https://api.example.com');
const resp = await session.get('/api/tools');
```

## Links

- [openagent.id](https://openagent.id)
- [GitHub repository](https://github.com/OpenAgentID/openagent-sdk)

## License

Apache-2.0 OR MIT © L1fe AI
