# @openagentid/scim

SCIM 2.0 provisioning bridge for OpenAgent — enterprise agent lifecycle management via RFC 7644. Compatible with Okta, Azure AD, OneLogin, JumpCloud, and any SCIM 2.0 client.

Agents are provisioned, updated, and deprovisioned as SCIM resources with an OpenAgent extension schema, so your IdP stays the source of truth for agent identity lifecycle.

## Install

```sh
npm install @openagentid/scim
```

## Usage

```ts
import { createScimRouter } from '@openagentid/scim';

const scim = createScimRouter({
  namespace: 'acme',
  bearerTokens: [process.env.SCIM_TOKEN!],
  baseUrl: 'https://scim.acme.com/scim/v2',
});

// Bun / Deno:
Bun.serve({ fetch: scim.handle });

// Express:
app.all('/scim/v2/*', async (req, res) => {
  const response = await scim.handle(toWebRequest(req));
  sendWebResponse(res, response);
});
```

The router implements the full SCIM 2.0 surface — service provider config, schemas, resource types, list/filter/pagination, and PATCH operations — with pluggable `AgentStore`, `AuditSink`, and revocation hooks (`DidRevoker`, `DelegationCascadeRevoker`, `ArsenalSessionInvalidator`) so deprovisioning cascades through identity, delegation, and credential layers.

## Links

- [openagent.id](https://openagent.id)
- [GitHub repository](https://github.com/OpenAgentID/openagent-sdk)

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT), at your option.
