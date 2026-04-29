# Rust API Reference

This page documents the public surface of the `openagent-sdk` crate. For concepts and guides, see the [getting-started](../getting-started/core-concepts.md) and [guides](../guides/creating-an-agent.md) pages. For the underlying wire formats, see [wire-formats.md](wire-formats.md).

## Crate: `openagent-sdk`

All public items are re-exported from the crate root. Internal modules are not part of the stable API.

## `OpenAgent`

```rust
pub struct OpenAgent { /* ... */ }

impl OpenAgent {
    pub async fn from_env() -> Result<Self, OpenAgentError>;
    pub fn builder() -> OpenAgentBuilder;

    pub async fn create_agent(&self, opts: CreateAgentOptions) -> Result<Agent, OpenAgentError>;
    pub async fn load_agent(&self, did: &Did) -> Result<Agent, OpenAgentError>;
    pub async fn load_agent_with_skills(&self, did: &Did, skills: &Path) -> Result<Agent, OpenAgentError>;
    pub async fn load_human(&self, opts: LoadHumanOptions) -> Result<Human, OpenAgentError>;

    pub async fn authenticate<R>(&self, req: &R) -> Result<Context, OpenAgentError>
    where
        R: RequestLike;

    pub async fn revoke(&self, did: &Did, opts: RevokeOptions) -> Result<(), OpenAgentError>;

    pub fn audit(&self) -> AuditQuery;
    pub async fn health_check() -> Result<HealthResult, OpenAgentError>;

    pub fn scope_matches(held: &[Scope], required: &[Scope]) -> bool;
}
```

The `OpenAgent` struct holds references to the Arsenal broker client and the AEGIS verifier client. Cloning it is cheap (`Arc`-backed). Construct via `from_env()` for twelve-factor deployments, or via `builder()` for finer control.

## `OpenAgentBuilder`

```rust
impl OpenAgentBuilder {
    pub fn broker_url(self, url: impl Into<String>) -> Self;
    pub fn aegis_url(self, url: impl Into<String>) -> Self;
    pub fn namespace(self, namespace: impl Into<String>) -> Self;
    pub fn cache(self, cfg: CacheConfig) -> Self;
    pub fn audit(self, cfg: AuditConfig) -> Self;
    pub async fn build(self) -> Result<OpenAgent, OpenAgentError>;
}
```

## `Agent`

```rust
pub struct Agent { /* ... */ }

impl Agent {
    pub fn did(&self) -> &Did;
    pub fn scopes(&self) -> &[Scope];
    pub fn expires_at(&self) -> DateTime<Utc>;
    pub fn lineage(&self) -> &[Did];
    pub fn act_compact_string(&self) -> String;

    pub async fn credentials_for(&self, service: &str) -> Result<Credentials, OpenAgentError>;
    pub async fn credentials_for_with(&self, service: &str, opts: CredentialOptions) -> Result<Credentials, OpenAgentError>;
    pub async fn raw_credential(&self, service: &str) -> Result<SecretString, OpenAgentError>;

    pub async fn delegate(&self, opts: DelegateOptions) -> Result<Agent, OpenAgentError>;
    pub async fn refresh(&self) -> Result<(), OpenAgentError>;
    pub fn start_auto_refresh(&self, interval: Duration) -> AutoRefreshHandle;

    pub async fn wallet(&self) -> Result<Wallet, OpenAgentError>;
    pub async fn wallet_with(&self, opts: WalletOptions) -> Result<Wallet, OpenAgentError>;

    pub fn skills_policy(&self) -> &SkillsPolicy;

    pub fn sign(&self, message: &[u8]) -> Result<Signature, OpenAgentError>;
    pub fn has_scope(&self, scope: &Scope) -> bool;
    pub fn require_scope(&self, scope: &str) -> Result<(), OpenAgentError>;
}
```

## `Context`

```rust
pub struct Context {
    pub did: Did,
    pub scopes: Vec<Scope>,
    pub lineage: Vec<Did>,
    pub root_human: Did,
    pub acting_as: Did,
    pub expires_at: DateTime<Utc>,
    pub policy_decisions: Vec<PolicyDecision>,
}

impl Context {
    pub fn has_scope(&self, scope: &str) -> bool;
    pub fn require_scope(&self, scope: &str) -> Result<(), OpenAgentError>;
}
```

## `Credentials`

```rust
pub struct Credentials { /* ... */ }

impl Credentials {
    pub fn fetch(&self, url: &str) -> CredentialRequestBuilder;
    pub fn get(&self, url: &str) -> CredentialRequestBuilder;
    pub fn post(&self, url: &str) -> CredentialRequestBuilder;
    pub fn put(&self, url: &str) -> CredentialRequestBuilder;
    pub fn delete(&self, url: &str) -> CredentialRequestBuilder;
    pub fn patch(&self, url: &str) -> CredentialRequestBuilder;
}

// CredentialRequestBuilder is a thin wrapper around reqwest::RequestBuilder
// that auto-routes through the Arsenal broker.
impl CredentialRequestBuilder {
    pub fn header(self, k: &str, v: &str) -> Self;
    pub fn body(self, body: impl Into<Body>) -> Self;
    pub fn json<T: Serialize>(self, body: &T) -> Self;
    pub async fn send(self) -> Result<reqwest::Response, OpenAgentError>;
}
```

The builder is designed so that porting reqwest code to OpenAgent is usually just a one-line change at the top.

## `SkillsPolicy`

```rust
pub struct SkillsPolicy { /* ... */ }

impl SkillsPolicy {
    pub fn can_invoke(&self, name: &str, ctx: &Value) -> Result<PolicyDecision, OpenAgentError>;
    pub fn list(&self) -> &[SkillDefinition];
    pub async fn reload(&self) -> Result<(), OpenAgentError>;
}

pub struct PolicyDecision {
    pub allowed: bool,
    pub reason: Option<String>,
    pub skill: String,
    pub requires_approval: bool,
    pub approval_prompt: Option<String>,
}
```

## `Wallet`

```rust
pub struct Wallet { /* ... */ }

impl Wallet {
    pub async fn address(&self, chain: Chain) -> Result<String, OpenAgentError>;
    pub async fn balance(&self, chain: Chain) -> Result<Balance, OpenAgentError>;
    pub async fn sign_transaction(&self, tx: UnsignedTransaction) -> Result<SignedTransaction, OpenAgentError>;
    pub async fn send(&self, tx: UnsignedTransaction) -> Result<TransactionReceipt, OpenAgentError>;
    pub async fn history(&self, opts: HistoryOptions) -> Result<Vec<Transaction>, OpenAgentError>;
}

#[non_exhaustive]
pub enum Chain {
    Bitcoin, Ethereum, Optimism, Arbitrum, Base, Polygon, Bnb, Avalanche,
    Solana, Cosmos, Cardano, Polkadot, Near, Aptos, Sui, Stellar, Tron, Xrpl,
}
```

## `OpenAgentError`

```rust
#[derive(Debug, thiserror::Error)]
pub enum OpenAgentError {
    #[error("unauthenticated: {reason}")]
    Unauthenticated { reason: String },

    #[error("invalid token: {reason}")]
    InvalidToken { reason: String },

    #[error("token expired at {expired_at}")]
    Expired { expired_at: DateTime<Utc> },

    #[error("lineage broken at {broken_at}")]
    LineageBroken { broken_at: Did },

    #[error("lineage revoked: {revoked}")]
    LineageRevoked { revoked: Did },

    #[error("scope denied: required {required}, held {held:?}")]
    ScopeDenied { required: String, held: Vec<String> },

    #[error("scope amplification: child tried to add {added:?} beyond parent")]
    ScopeAmplification { added: Vec<String> },

    #[error("policy denied: {reason}")]
    PolicyDenied { reason: String },

    #[error("policy requires approval: {prompt}")]
    PolicyRequiresApproval { prompt: String },

    #[error("broker unavailable: {source}")]
    BrokerUnavailable { #[source] source: reqwest::Error },

    #[error("upstream error {status}: {body}")]
    UpstreamError { status: u16, body: String },

    #[error("invalid request: {message}")]
    InvalidRequest { message: String },

    #[error("internal error: {0}")]
    Internal(String),
}

impl OpenAgentError {
    pub fn http_status(&self) -> u16;
    pub fn code(&self) -> &'static str;
}
```

`OpenAgentError` implements `std::error::Error`, `Send`, `Sync`, and `Clone`. Under the `axum` feature it also implements `axum::response::IntoResponse`, which renders the error as the appropriate status with a JSON body `{ code, message, details }`.

## Feature flags

- `default = ["rustls-tls", "audit"]`
- `rustls-tls` — TLS via rustls. Disable to drop rustls if you use native-tls.
- `native-tls` — TLS via native-tls (mutually exclusive with rustls-tls).
- `wallet` — AEGIS multi-chain wallet support. Pulls in chain codecs.
- `mcp` — MCP server helpers (`openagent_sdk::mcp` module).
- `claude-agent` — Claude Agent SDK plugin.
- `axum` — `IntoResponse` for `OpenAgentError` and `OpenAgentLayer` middleware.
- `tower` — Tower service wrapper.
- `testing` — test doubles (`FakeBroker`, `stub_agent`, `stub_context`).
