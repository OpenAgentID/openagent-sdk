# 04 — Delegated Agent

Demonstrates parent-to-child delegation and the no-amplification rule. A parent agent with broad scopes spawns a narrower child worker, which spawns an even narrower grandchild. The example then attempts to amplify (and fails structurally).

## What it shows

- `parent.delegate({ ... })` — the delegation call.
- Strict subset semantics — child scopes must be a subset of parent scopes.
- Automatic lineage chain — every agent carries its ancestry.
- Attempting to amplify throws `SCOPE_AMPLIFICATION`, showing the rule is enforced.
- How a delegated ACT can be handed to a separate worker process via env var.

## Run it

```bash
bun install
bun run start
```

Expected output:

```
parent did=did:oas:example:agent:RootBot
parent scopes=["github:*:*","openai:chat:invoke","tavily:search:invoke"]

child did=did:oas:example:agent:Worker
child scopes=["github:pulls:read","openai:chat:invoke"]
child lineage=["did:oas:example:hmr:local-dev","did:oas:example:agent:RootBot","did:oas:example:agent:Worker"]

grandchild did=did:oas:example:agent:Worker:Shard1
grandchild scopes=["github:pulls:read"]
grandchild lineage=[..., "did:oas:example:agent:Worker:Shard1"]

attempting amplification: grandchild trying to add github:pulls:write...
denied: SCOPE_AMPLIFICATION: child tried to add ["github:pulls:write"] beyond parent
```

## Why this matters

The no-amplification rule is the single most important invariant in OpenAgent. No matter how deep your delegation tree goes, no matter how many agents spawn how many children, the effective scope set can only contract. This is what makes autonomous agent trees tractable at enterprise scale — a buggy or misbehaving agent can never escalate its own privileges.

## Try this next

- Add a time condition to the child's delegation and observe it on the grandchild.
- Revoke the parent and observe that both child and grandchild become unusable.
- Move on to [05-skills-governance](../05-skills-governance) to see policy-level gating on top of scope-level gating.

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](../../../LICENSE-APACHE) or [MIT license](../../../LICENSE-MIT), at your option.
