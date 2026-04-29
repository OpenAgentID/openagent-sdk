# Installation

OpenAgent ships in TypeScript (Node 20+, Bun, Deno, edge runtimes) and Rust (stable, MSRV 1.78). Both SDKs share the same public facade and the same underlying WASM crypto core, so identity material minted by one is trivially verifiable by the other. Pick whichever matches your stack; mixing is fine.

## TypeScript

```bash
npm install @openagent/sdk
# or
pnpm add @openagent/sdk
# or
bun add @openagent/sdk
# or
yarn add @openagent/sdk
```

The package ships as ES modules with TypeScript declarations built in. There is no `@types/openagent` — you already have types. The package has a single runtime dependency: `@openagent/crypto-wasm`, the shared Rust-compiled crypto core. On most platforms npm will pull down the prebuilt binary; on unusual platforms it falls back to the pure-JS fallback and emits a warning.

Minimum runtimes:

- Node.js 20.0 or later (ESM required; CommonJS consumers can use dynamic `import()`).
- Bun 1.1 or later.
- Deno 1.40 or later (import from `npm:@openagent/sdk`).
- Cloudflare Workers, Vercel Edge, Deno Deploy — all supported. The WASM core is under 120 KB gzipped.

## Rust

```bash
cargo add openagent-sdk
```

Or, in `Cargo.toml`:

```toml
[dependencies]
openagent-sdk = "0.1"
tokio = { version = "1", features = ["rt-multi-thread", "macros"] }
```

The Rust SDK is the reference implementation; the TypeScript SDK calls into the same crypto core via `wasm-bindgen`. You get native Ed25519, HKDF, and BLAKE3 with zero C dependencies (rustls, no OpenSSL).

Feature flags:

- `default = ["rustls-tls"]` — TLS via rustls. If you prefer native-tls, disable default features and enable `native-tls`.
- `wallet` — pulls in AEGIS multi-chain wallet support (Bitcoin, Ethereum, Solana, Cosmos, and 8 more chains).
- `mcp` — MCP server helpers (the `OpenAgent::mcp` module).
- `claude-agent` — helpers for embedding into the Claude Agent SDK.

Minimum Rust version is 1.78. The SDK is `no_std`-friendly for the core identity types but the default build assumes `std` and `tokio`.

## Verifying the install

Both SDKs expose a `healthCheck()` / `health_check()` that runs a self-test on the crypto core (generates a DID, signs a nonce, verifies the signature). It's a good first smoke test:

```ts
import { OpenAgent } from '@openagent/sdk';
console.log(await OpenAgent.healthCheck());
// { ok: true, version: '0.1.0', cryptoCore: 'wasm', did: 'did:oas:test:...' }
```

```rust
use openagent_sdk::OpenAgent;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    println!("{:#?}", OpenAgent::health_check().await?);
    Ok(())
}
```

If either call returns `ok: false`, file an issue with the platform details — something is wrong with the WASM loader or native build on your platform.

## Environment variables

OpenAgent reads optional configuration from the environment. None of these are required for the quickstarts, but you will want them for production:

- `OPENAGENT_BROKER_URL` — base URL of your Arsenal broker. Defaults to `http://localhost:7878` for local dev.
- `OPENAGENT_AEGIS_URL` — base URL of your AEGIS verification service. Defaults to local dev.
- `OPENAGENT_NAMESPACE` — DID namespace for agents minted by this process. Defaults to `local`.
- `OPENAGENT_ROOT_KEY_PATH` — path to the private key for the root human identity (HMR) that this process is acting on behalf of. In managed deployments this is provided by a secret manager and never touches disk.

Next: [TypeScript quickstart](quickstart-typescript.md) or [Rust quickstart](quickstart-rust.md).
