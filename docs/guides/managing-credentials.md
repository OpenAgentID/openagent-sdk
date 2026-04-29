# Managing Credentials

Managing credentials for autonomous agents is the problem that motivated OpenAgent to exist. The conventional approach — mint an API key per agent, store it in a secrets manager, hope it never leaks — falls apart the moment you have thousands of agents, short-lived workloads, or any kind of delegation. OpenAgent solves this with the Arsenal credential proxy.

## The model

Your production secrets (OpenAI, Anthropic, GitHub, Stripe, Postgres, anything else with an API key or connection string) live in one place: the **Arsenal broker**. The broker is a service you deploy in your infrastructure. It holds the real credentials and nothing else holds them.

Your agents never see the credentials. When an agent wants to call OpenAI, it sends the request *through* the broker. The broker looks up the credential for `openai`, attaches it to the outgoing request, proxies upstream, and returns the response verbatim. The agent process, if fully compromised, leaks no credentials — because it never had any.

The facade in the SDK is `agent.credentialsFor(service)`:

```ts
const openai = await agent.credentialsFor('openai');
const res = await openai.post('https://api.openai.com/v1/chat/completions', {
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(chatBody),
});
```

```rust
let openai = agent.credentials_for("openai").await?;
let res = openai
    .post("https://api.openai.com/v1/chat/completions")
    .header("content-type", "application/json")
    .json(&chat_body)
    .send()
    .await?;
```

The returned object is a fetch-shaped proxy. It supports `fetch`, `get`, `post`, `put`, `delete`, and `patch` methods, plus streaming (`.stream()`) and multipart (`.multipart()`). It has the same ergonomics as `node-fetch` or `reqwest::Client`.

## Registering a credential

Credentials are registered with the broker out-of-band. You have three options:

1. **Broker CLI** — `arsenal cred register openai --value 'sk-...' --scope 'agent=*'`. The CLI is included with the Arsenal server package.
2. **Admin API** — `POST /admin/v1/credentials` on the broker with a JSON body. Use this from Terraform or an operator.
3. **Secret manager sync** — the broker can watch an external secret manager (Vault, OpenBao, AWS Secrets Manager, GCP Secret Manager) and pull credentials in automatically. This is the recommended production pattern because it keeps the source of truth in one place.

In every case, the broker encrypts the credential at rest using a key from its KMS (OpenBao by default in L1fe deployments, but AWS KMS, GCP KMS, and HashiCorp Vault Transit are all supported).

## Service names

The first argument to `credentialsFor` is a service name. It maps to an entry in the broker's credential catalog. Names are flat strings — `openai`, `anthropic`, `github`, `stripe`, `postgres-prod`, `snowflake-analytics`. Pick a naming convention and stick to it. Scopes are checked against the catalog entry's declared scope prefix (`openai:*` by default), so renaming services requires updating scopes.

A single service can have multiple credentials rotated behind it — the broker does the selection. That's how zero-downtime key rotation works: you register `openai` with the new key, mark the old one as draining, and the broker switches over without any client change.

## SSRF guard

Arsenal's credential proxy is platform-agnostic — it can attach credentials to calls going to any URL — and that's a footgun if you're not careful. A compromised agent could ask the broker to proxy a call to `http://169.254.169.254/` and exfiltrate the provider credential to an attacker-controlled endpoint.

The broker has an 11-step SSRF guard on every proxied request: scheme allowlist, DNS resolution with IP family pinning, IP allowlist / blocklist, HTTP redirect interception and re-validation, header stripping of sensitive fields, and a post-response scrub. The guard is on by default and can only be relaxed per-service (not globally). See [architecture/threat-model.md](../architecture/threat-model.md).

## Caching proxied responses

`credentialsFor` returns an object with an optional response cache:

```ts
const openai = await agent.credentialsFor('openai', {
  cache: {
    mode: 'semantic',   // 'none' | 'exact' | 'semantic' | 'perceptual'
    ttlSeconds: 300,
  },
});
```

Semantic caching reuses responses for near-identical requests (e.g., the same chat prompt with slight whitespace differences). This is usually worth enabling for LLM calls — it's been shown to cut spend by 20–40% on agent workloads — but only when you understand the tradeoff with nondeterminism. See [Foundry caching](https://docs.l1fe.ai/foundry/caching) for the full semantics.

## Direct credential access (escape hatch)

If you absolutely need the raw credential in-process (e.g., you're using a client library that won't accept a base URL override), call `agent.rawCredential('openai')`. This returns a short-lived, single-use credential string bound to the agent's DID. You get one shot; using it refuses further access. It's intended for integration with legacy clients and is audited separately.

The SDK will warn loudly if you call `rawCredential` and the agent does not have the `openagent:credential:raw` meta-scope. Most deployments deny that meta-scope by policy and force everything through the proxy.

## Per-service overrides

If you need to route calls for one service through a specific broker (multi-region, high-availability), pass a broker URL:

```ts
const openai = await agent.credentialsFor('openai', { brokerUrl: 'https://broker-eu.acme.com' });
```

The SDK will still sign with the agent's ACT, but send the request to the specified broker. Useful for data residency requirements.

Next: [delegating authority](delegating-authority.md).
