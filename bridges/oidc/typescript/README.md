# @openagentid/oidc

OIDC/OAuth2 bridge for the OpenAgent SDK — maps between human OIDC tokens (Okta, Auth0, Keycloak, Azure AD, Google) and OAS agent DIDs + Arsenal capability tokens.

Three flows:

1. **Human JWT → Agent DID** — derive an agent identity under the human's lineage
2. **Agent ACT → Bearer JWT** — wrap a capability token for OAuth2-only services
3. **RFC 8693 Token Exchange** — swap a human token for a scoped agent token

## Install

```sh
npm install @openagentid/oidc
```

## Usage

```ts
import { OidcBridge } from '@openagentid/oidc';

const bridge = new OidcBridge({
  issuer: 'https://dev-123.okta.com/oauth2/default',
  audience: 'my-app',
});

// Flow 1: derive an agent DID from a human's OIDC JWT
const agent = await bridge.deriveAgentFromJwt(jwtString, 'my-bot');

// Flow 2: wrap Arsenal ACT claims as an EdDSA-signed bearer JWT
const jwt = await bridge.actToJwt(actClaims, signingKey, 'EdDSA');

// Flow 3: RFC 8693 token exchange for scoped agent credentials
const response = await bridge.exchangeToken(humanJwt, ['openai:chat:completions']);
```

Discovery and JWKS retrieval are handled automatically from the issuer's `/.well-known/openid-configuration`; validation failures raise `OidcBridgeError` with a stable machine-readable code.

## Links

- [openagent.id](https://openagent.id)
- [GitHub repository](https://github.com/OpenAgentID/openagent-sdk)

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT), at your option.
