# Wallet Integration Boundaries

The public TypeScript SDK 0.8.0 does not expose `agent.wallet()`, wallet address,
balance/history, transaction signing/broadcast or a hosted wallet service.
Creating a local OAS identity does not create an account on a blockchain or
provide funds, RPC credentials or spending permission.

## Separate wallet components

AEGIS wallet and threshold-signing primitives are separate source components
with their own key types, chain/derivation support, policy and custody APIs.
A chain identifier in an enum is not proof of a working address derivation,
transaction serializer, indexer, RPC/broadcast route or deployed service.

The Rust facade can re-export its configured AEGIS SDK with the real `aegis`
Cargo feature. That does not add a `wallet` method to the unified agent or make
TypeScript 0.8.0's local workspace a wallet provider. Consult the exact
component source and dependency version used by your wallet integration.
[SDK feature guide](../getting-started/quickstart-rust.md).

## Real custody and permission

Choose a wallet implementation that supports the exact chain, algorithm,
derivation and transaction format you require. Persist its authorized signer
under the selected custody; never derive a private wallet key from a public
DID string or assume every SDK's seed restores the same encryption/signing key.

Bind the wallet to the actual approved agent/owner/organization under the
receiving service's authority. Enforce current caller possession, revocation,
tenant, spend budget and transaction policy before signing. A claimed lineage,
local skills allowlist or avatar cannot authorize a transfer. Signature checks
alone do not verify a transaction's intended chain, recipient, amount or fees.

If using threshold signing, deploy the real key-share ceremony and participant
approval/custody contract. Naming holders or a quorum in a configuration does
not generate shares, provide an approval UI or prove distinct humans. If using
remote signing, the signer must enforce policy server-side; a local client
check does not constrain a compromised caller.

## Execution and evidence

Keep signing, broadcasting and chain confirmation distinct. An accepted
broadcast can remain pending or fail; a revocation cannot undo a completed
on-chain transaction. Preserve idempotency/nonce, failure recovery and actual
receipt/confirmation checks in the wallet/chain integration. Use its real
balance/indexer data rather than SDK-generated status.

Record authorized transaction decisions and receipts through the selected
application's actual durable audit policy. There is no automatic
`OpenAgent.audit()` wallet history or guaranteed compliance report.
[Audit responsibilities](audit-and-compliance.md).

For the open identity side, use [local identity](creating-an-agent.md),
[current verification](../identity-verification.md) and
[developer tooling](../developer-tooling.md). Base support in a wallet or an
optional EAS anchor does not establish a migration of identity authority.
