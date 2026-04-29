# 03 — Delegated Agent (Rust)

Parent-to-child delegation with the no-amplification rule, in Rust.

## What it shows

- `parent.delegate(...)` with typed options.
- Strict scope subset semantics.
- Multi-level delegation chains (parent → child → grandchild).
- The amplification attempt that fails with `SCOPE_AMPLIFICATION`.

## Run it

```bash
cargo run
```

Expected output:

```
parent did=did:oas:example:agent:RootBot
parent scopes=["github:*:*", "openai:chat:invoke", "tavily:search:invoke"]

child did=did:oas:example:agent:Worker
child scopes=["github:pulls:read", "openai:chat:invoke"]
child lineage=[..., "did:oas:example:agent:Worker"]

grandchild did=did:oas:example:agent:Worker:Shard1
grandchild scopes=["github:pulls:read"]
grandchild lineage=[..., "did:oas:example:agent:Worker:Shard1"]

attempting amplification: grandchild trying to add github:pulls:write...
denied: ScopeAmplification { added: ["github:pulls:write"] }
```

## Why this matters

The no-amplification rule is enforced in the SDK (fast fail) and in the broker (authoritative). A compromised parent cannot create a child with wider scopes. This is what makes deep delegation trees safe — the effective scopes can only contract.

## Try this next

- Try revoking the parent and observe that the child and grandchild fail to refresh.
- Add a time condition to the delegation and see it appear on the child's ACT.
- Compare with the TypeScript version in [../../typescript/04-delegated-agent](../../typescript/04-delegated-agent).
