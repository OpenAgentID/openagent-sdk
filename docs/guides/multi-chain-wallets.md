# Multi-Chain Wallets

AEGIS (the third layer under the OpenAgent facade) includes a multi-chain wallet system that lets agents hold, sign, and spend on 12 blockchains using a single identity. This guide covers the common operations: creating a wallet, deriving addresses, signing transactions, and governing spend.

## Why a wallet matters for agents

Autonomous agents that interact with economic systems — paying for API calls via x402 micropayments, buying compute time in ARISE, settling in stablecoins, or coordinating on-chain — need a wallet. Doing this with a plain mnemonic and a signing library is terrifying at scale: any compromise leaks funds, rotation is nearly impossible, and there's no policy layer saying "this agent can spend up to $10/day but not more."

AEGIS solves this by deriving chain-specific keys from the same HKDF lineage that produces the agent's DID. The wallet is bound to the agent identity, subject to the same delegation rules, and spending is gated by AEGIS policies that run on every transaction.

## Supported chains

- Bitcoin (P2WPKH, P2TR)
- Ethereum and all EVM L1s/L2s (Optimism, Arbitrum, Base, Polygon, BNB, Avalanche)
- Solana
- Cosmos (ATOM and the whole IBC zone)
- Cardano
- Polkadot
- Near
- Aptos
- Sui
- Stellar
- Tron
- XRPL

Each chain has a canonical derivation path that AEGIS uses by default (BIP-44 / SLIP-0010 for BIP-compatible chains, chain-specific schemes where appropriate). You can override derivation if you need to match an externally-provisioned address scheme.

## Creating a wallet

```ts
import { OpenAgent } from '@openagentid/sdk';

const agent = await OpenAgent.loadAgent(process.env.AGENT_DID!);
const wallet = await agent.wallet();

// wallet is lazy — no keys are derived until you ask for an address
const ethAddress = await wallet.address('ethereum');
const btcAddress = await wallet.address('bitcoin');
const solAddress = await wallet.address('solana');
```

```rust
let agent = OpenAgent::load_agent(&did).await?;
let wallet = agent.wallet().await?;
let eth_address = wallet.address(Chain::Ethereum).await?;
let btc_address = wallet.address(Chain::Bitcoin).await?;
```

Addresses are deterministic: the same agent will always derive the same addresses, because they come from HKDF over the agent's root key material. This means you can print an address on a business card, and the agent will always produce signatures that verify against it.

## Signing a transaction

```ts
const tx = {
  chain: 'ethereum',
  to: '0x1234...',
  value: '0.01 ETH',
  gasLimit: 21000,
  data: '0x',
};

const signed = await wallet.signTransaction(tx);
// signed.raw -> '0xf86c0185...'
// signed.hash -> '0xabcdef...'
// returns without broadcasting; you or the broker will broadcast
```

Or, for a one-shot send:

```ts
const receipt = await wallet.send(tx);
// broadcasts via an AEGIS-hosted node or a configured RPC endpoint
```

Signing always runs through the AEGIS policy engine first. If you have a `maxSpend` policy and this transaction would exceed it, the call returns `PolicyDenied` before any signing happens. If the policy passes, AEGIS signs on the agent's behalf (the private key material is never exposed to your process), and the signed transaction is returned.

## FROST threshold signing

For high-value accounts, raw key material is a single point of failure. AEGIS supports FROST (Flexible Round-Optimized Schnorr Threshold) signatures where the key is split across *n* holders and *t* must cooperate to sign. This is commonly used for "require 2 of 3 humans" for anything over a spending threshold.

```ts
const wallet = await agent.wallet({
  threshold: { holders: ['human:alice', 'human:bob', 'human:carol'], required: 2 },
  rule: 'above:USD:1000',   // use FROST for any tx > $1000
});
```

When `wallet.send(tx)` is called and the rule matches, AEGIS emits a signing request to the holders. Each holder has a UI (usually a mobile app or a signing widget) that shows the transaction and a sign/reject button. Once the required threshold signs, the transaction is assembled and broadcast. Transactions below the threshold sign immediately.

## Policy-gated spend

The most common wallet policies are spend limits. You declare them at wallet creation time or in the agent's delegation conditions:

```ts
const wallet = await agent.wallet({
  spendLimits: {
    daily: { currency: 'USD', amount: 100 },
    perTx: { currency: 'USD', amount: 50 },
    gasOnly: true,   // refuse transactions that aren't pure gas-funded calls
  },
});
```

The broker tracks spend per agent across chains. Values are converted to the declared currency using a real-time rate feed (configurable — AEGIS supports Pyth, Chainlink, or a local oracle). If a transaction would exceed a limit, the call fails before signing.

## Revocation

Revoking an agent or any of its parents immediately revokes signing authority on the wallet. The broker will refuse to sign further transactions even if the caller holds a valid-looking ACT — because the revocation list is consulted on every sign. Outstanding broadcast transactions are not reversed (chains don't work that way), but nothing new gets signed.

## Viewing balance and history

```ts
const balance = await wallet.balance('ethereum');     // returns { native, tokens: [...] }
const history = await wallet.history({ chain: 'ethereum', limit: 50 });
```

Balance queries hit a chain indexer (your choice — AEGIS supports Etherscan, Alchemy, Ankr, Helius for Solana, mempool.space for Bitcoin). The SDK exposes them as a flat interface so you don't need per-chain glue.

## Audit trail

Every signing event, every policy decision, every balance query goes into the same audit log as everything else in OpenAgent. Walletaudit is the most compliance-relevant surface — you can produce a "show me every transaction this agent signed, who approved it, and which policy authorized it" report in two lines:

```ts
const entries = await OpenAgent.audit(did).filter({ kind: 'wallet.sign' }).last(90, 'days');
```

Next: [audit and compliance](audit-and-compliance.md).
