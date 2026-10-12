# Installation

For a complete first application, follow the [public quickstart](quickstart-typescript.md).
SDK 0.4.0 and create-openagent 0.2.0 are release candidates until publication is
confirmed. SDK 0.3.0 and OIDC 0.2.0 remain the published baseline during review.

## JavaScript and TypeScript

```sh
npm install @openagentid/sdk@0.4.0
```

The package includes TypeScript declarations and ESM/CommonJS exports. Its public
runtime dependencies are jose, Zod, @noble/hashes and @scure/base. OAS, Arsenal,
AEGIS and crypto-wasm are optional peers for their corresponding integrations;
they are not needed by the local workspace or avatar APIs.

- `@openagentid/sdk/local` and the `oaid` CLI require Node 20+ and persistent
  private filesystem storage. The local workspace is a single-host authority.
- `@openagentid/sdk/character-player` is the DOM player; `@openagentid/sdk/browser`
  is its self-contained browser ESM bundle.
- Portable verification and Fetch handlers require WebCrypto/native Fetch APIs.
  The separate `@openagentid/oidc@0.2.0` provider requires Node 20.19+.

## Verify your setup

```sh
npx oaid --version
npx oaid init --audience https://my-app.example/agents
npx oaid agent create --name researcher
npx oaid doctor
```

`init` refuses to overwrite existing state. `doctor` opens and validates the
workspace and reports public metadata, not private keys. It does not assert that
an external login or permission check succeeded. Use the quickstart's actual
challenge/proof/verify flow to test identity authentication.

## Bring your own services

The `OpenAgent` facade requires concrete `clients.identity`,
`clients.credentials` and `clients.verification` for the respective operations.
Setting endpoint strings or environment variables alone does not instantiate
these clients. Missing clients fail closed with a configuration error naming
the required subsystem. There is no automatic fake broker or crypto fallback.

Local workspaces instead use their explicit directory, audience and namespace
configuration. They make no implicit service discovery calls or telemetry
requests. Keep keys on your own host; exchange only public identity documents.
Your application controls trust, scopes and tenant access.

## Other languages

See each [language module](../../README.md#languages) for its actual package,
features and runtime requirements. The Rust SDK currently references private
OAS, Arsenal and AEGIS repositories; that dependency path remains a public
adoption gap. The standalone TypeScript local identity/character path requires
only public registry dependencies.
