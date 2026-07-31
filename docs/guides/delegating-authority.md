# Delegating Authority

Delegation is what lets a parent agent hand a subset of its authority to a child, with a strict guarantee that the child can never hold more than the parent. OpenAgent's delegation model is a contract-only system: the child's scopes are always a subset of the parent's, and the child's lifetime never outlives the parent's ACT.

## The no-amplification rule

If your parent has `['github:repo:read', 'openai:chat:invoke']`, a child you spawn can only hold scopes from that set or a strict subset. You cannot, at delegation time, add `github:repo:write`, because your parent never had it. Attempting to amplify throws `OpenAgentError::ScopeAmplification` immediately.

This is enforced in two places: the SDK checks it client-side before making the broker request (fast fail), and the Arsenal broker re-checks it server-side before issuing the child ACT (authoritative). There is no way to bypass it short of compromising the broker itself.

## Delegating as a parent

```ts
import { OpenAgent } from '@openagentid/sdk';

// Inside a parent agent's process
const parent = await OpenAgent.loadAgent(process.env.PARENT_DID!);

const child = await parent.delegate({
  name: 'page-indexer',
  scopes: ['tavily:search:invoke'],     // strict subset
  expiresInMinutes: 15,                  // strict shorter lifetime
});

console.log(child.did);
console.log(child.actCompactString);   // hand this to the child worker
```

```rust
let child = parent.delegate(
    DelegateOptions::new("page-indexer")
        .scopes(["tavily:search:invoke"])
        .expires_in_minutes(15)
).await?;
```

The `delegate` method does all the lineage bookkeeping: derives a new keypair from the parent's key material using HKDF with the child's name as context, signs a lineage proof, and asks the broker for a child ACT. The child's DID is a deterministic function of the parent's DID and the child name, which means reproducible delegation (useful for idempotent provisioning) but also means you can't have two active children with the same name under the same parent.

## Delegating as a human

Humans delegate the same way, but the caller holds an HMR key instead of an agent ACT:

```ts
const human = await OpenAgent.loadHuman({ hmrKeyPath: '/secure/alice.hmr.key' });
const firstAgent = await human.delegate({
  name: 'root-agent',
  scopes: ['openai:chat:invoke', 'github:*:read'],
  expiresInHours: 24,
});
```

Loading a human identity requires access to the HMR private key. In production this almost never touches disk — the HMR key lives in a hardware token, a KMS, or a FROST threshold setup where no single party can reconstruct it. See [multi-chain-wallets.md](multi-chain-wallets.md) for how AEGIS handles threshold signing.

## Delegation with conditions

The `delegate` call accepts a `conditions` field that attaches AEGIS policies to the child ACT. These run on every request the child makes:

```ts
const child = await parent.delegate({
  name: 'after-hours-bot',
  scopes: ['openai:chat:invoke'],
  expiresInHours: 8,
  conditions: {
    timeWindow: { start: '22:00', end: '06:00', timezone: 'America/New_York' },
    maxSpend: { currency: 'USD', amount: 10 },
    rateLimit: { rpm: 60 },
    ipAllowlist: ['10.0.0.0/8'],
  },
});
```

When the child makes a request, AEGIS evaluates each condition. A failure returns `PolicyDenied` with a structured reason ("time window violation: current 14:23 not in 22:00–06:00"). Conditions are evaluated in the broker, not in the agent, so a compromised child cannot disable them.

## Delegation chains and the lineage field

Delegation is recursive. A child can delegate a grandchild, which can delegate a great-grandchild, and so on. Every step narrows the scope (or leaves it equal) and shortens the lifetime (or leaves it equal). The chain is recorded and every request carries it:

```ts
const ctx = await OpenAgent.authenticate(req);
console.log(ctx.lineage);
// [
//   'did:oas:acme:hmr:alice',
//   'did:oas:acme:agent:RootBot',
//   'did:oas:acme:agent:Worker',
//   'did:oas:acme:agent:Shard-3'     // <- ctx.did
// ]
console.log(ctx.rootHuman);   // 'did:oas:acme:hmr:alice'
console.log(ctx.actingAs);    // 'did:oas:acme:agent:Shard-3'
```

Your service can decide whether to trust a delegated request based on any level of the chain. "Trust anything whose root is an employee HMR" is one policy; "trust only if the immediate parent is in an allowlist" is another; "trust only direct children of the payment-service agent" is a third. All of these are one-liners with `ctx.lineage`.

## Revocation

Revoking a parent revokes every descendant atomically. The broker maintains a short-lived revocation list that every running agent consults before each credential proxy call. A revoke takes effect within seconds:

```ts
await OpenAgent.revoke('did:oas:acme:agent:BadBot', { reason: 'anomaly-detection-flag' });
```

This revokes the BadBot ACT and every ACT below it in the lineage tree. Revocation is a broker-side operation — the keys still exist cryptographically, but any request carrying a revoked ACT is denied.

If you revoke a human HMR, every agent anyone has ever spawned under that human is revoked. Use with care.

## Read the no-amplification rule again

Because of the no-amplification rule, delegation is safe-by-construction: no matter how deep the chain, the effective scopes can only contract. That means a bug or a misconfigured AI cannot escalate its own privileges by creating children. This property is the core reason OpenAgent exists — it's what makes autonomous agent trees tractable at enterprise scale.

Next: [skills governance](skills-governance.md).
