# @openagent/sdk-testing

In-memory backends for [`@openagent/sdk`](../typescript). **Unit tests and
offline development only — nothing here is cryptographically sound.**

These backends used to live inside `@openagent/sdk` as silent fallbacks when
no protocol client was configured. A production deployment with a missing
peer would sign and "verify" with fake crypto without anyone choosing that.
The production SDK now fails closed, and the fakes live here, behind an
explicit import.

## Usage

```ts
import { OpenAgent } from '@openagent/sdk';
import { createTestingConfig } from '@openagent/sdk-testing';

OpenAgent.configure(createTestingConfig());

const agent = await OpenAgent.createAgent({
  parent: 'did:oas:l1fe:hmr:alice',
  name: 'test-bot',
  scopes: ['openai:chat:completions'],
});
```

Or wire backends individually:

```ts
import {
  StubIdentityProvider,
  StubVerificationClient,
  stubArsenalClient,
} from '@openagent/sdk-testing';

OpenAgent.configure({
  clients: {
    identity: new StubIdentityProvider(),
    verification: new StubVerificationClient(),
    credentials: stubArsenalClient(),
  },
});
```

`StubVerificationClient` accepts `Authorization: Bearer stub:<did>` tokens.
`StubIdentityProvider.signChallenge` returns a tagged base64 blob, not an
Ed25519 signature. `stubArsenalClient` echoes deterministic proxy URLs and
mints nothing.
