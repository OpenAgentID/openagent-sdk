# Deploy a real OpenAgent receiver

These templates protect `GET /api/agent` and `POST /api/agent` with a real,
broker-signed CBOR Agent Capability Token (ACT). They use the published SDK
and its Rust/WASM verifier. Docker, Lambda, Vercel and Workers share the
same policy and request handler. They do not create agent identities or
pretend to run an OIDC provider.

## First authenticated request

From the repository's `deploy` directory, using Node 20.19 or later:

```sh
npm install --ignore-scripts
npm run build:node
npm run example:init
npm run docker:start
```

In another terminal, from the same directory:

```sh
npm run example:request
```

The setup generates a real Ed25519 broker keypair. Its private key stays
in `.receiver-example/broker.pem` with mode `0600`; the receiver gets only
the public key. The client signs a 60-second ACT and sends a real POST.
The receiver returns the verified agent DID, tenant, scopes and message.
Running setup twice refuses to replace existing keys. Keep this local
example directory out of source control and deployments.

The same client accepts an HTTPS receiver origin:

```sh
npm run example:request -- https://your-receiver.example
```

Configure that receiver with the public policy from `receiver.env` first.
The example client refuses to send capabilities over non-loopback HTTP.
Use your actual broker's key custody and authorized agent DID for production.

## Explicit receiver policy

Every protected request requires these environment variables. There is
no default trusted issuer, tenant, DID, key or development authentication.

| Variable | Value |
| --- | --- |
| `OPENAGENT_ISSUER` | Exact authorized broker issuer |
| `OPENAGENT_AUDIENCE` | This service's exact capability audience |
| `OPENAGENT_TENANT` | The application's authorized tenant |
| `OPENAGENT_REQUIRED_SCOPE` | One literal `service:resource:action` scope |
| `OPENAGENT_PUBLIC_KEYS` | JSON array of base64url Ed25519 public keys |
| `OPENAGENT_REVOKED_TOKEN_IDS` | Current denied ACT IDs as a JSON array; `[]` when empty |
| `OPENAGENT_REVOKED_SUBJECTS` | Current denied agent DIDs as a JSON array; `[]` when empty |

The receiver verifies signature, issuer, audience, time, scope and tenant.
It permits only capabilities with a lifetime of at most five minutes,
applies the configured revocation lists on each request, and refuses
proof-of-possession-bound ACTs because this example does not implement a
PoP exchange. ACTs here are short-lived reusable bearer capabilities, not
single-use identity proofs. Use the SDK identity verification API when
your application requires a signed owner chain and consumed challenge.

Revocation-list changes require updating the running environment. Connect
an authoritative revocation store before using this template where
immediate cross-instance revocation is required. Never infer additional
application permissions from a DID, root, profile or client-sent header.

`POST /api/agent` accepts only `{"message":"your message"}` and preserves
the authenticated body. Other fields, large bodies and malformed JSON
are refused. The GET response exposes only verified capability claims.
`GET /health` reports process health; it does not prove authentication.

## Hosting targets

- **Docker:** from `deploy`, run `docker build -f docker/Dockerfile -t openagent-receiver .`,
  then `docker run --rm -p 127.0.0.1:3100:3100 --env-file .receiver-example/receiver.env openagent-receiver`.
  The process runs as a non-root user. For production, terminate TLS at
  your existing ingress and provide the policy through its environment.
- **Lambda:** `aws-lambda/dist/handler.js` is an API Gateway REST API
  handler. Build first, then package that directory with its runtime npm
  dependencies using `sam build --template-file aws-lambda/template.yaml`.
  Use your existing authorized AWS deployment workflow for the resulting
  SAM package. `aws-lambda/template.yaml` declares the seven
  public policy parameters and only the implemented routes. The function
  preserves API Gateway's base64-encoded bodies. No AWS resources are
  created by the build or tests.
- **Vercel:** the historical `vercel-edge` directory now contains a complete
  Next.js **Node runtime** app. Set that workspace as the project root and
  enable inclusion of source files outside that root (the shared receiver
  lives in `deploy/shared`). Supply the policy variables.
  `npm run build:vercel` builds it. The old
  Edge middleware's token stub and nonexistent rewrites are removed; the
  Node route loads the real packaged WASM. Identity never comes from
  caller-provided headers or a verifier's unvalidated JSON verdict.
- **Cloudflare Workers:** `npm run build:worker` generates the exact
  installed WASM/glue pair and performs a dry-run bundle. Configure the
  seven variables using your existing Wrangler environment, then deploy
  the `cloudflare-worker` workspace. Its loader explicitly instantiates
  the compiled WASM module in Workers. No Node filesystem or Buffer is
  needed at request time; no KV namespace is provisioned.

## Run the compatibility checks

```sh
npm run typecheck
npm test
npm run build:node
npm run build:worker
npm run test:worker
npm run build:vercel
npm run test:vercel
```

The tests generate real keys and signed ACTs, run the actual WASM, send
HTTP requests through the Node server, invoke the Lambda/Vercel adapters,
and execute the bundled Worker in workerd. Negative cases cover forged
signatures, different tenant/audience/issuer, expiry, scope, revocation,
malformed data and the removed stub token. The shared handler explicitly
supplies a fresh clock, including when used with SDK `0.7.2` and
`crypto-wasm` `0.1.1`.
