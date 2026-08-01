# @openagentid/skills-policy

Governance for agent skills — a specialized Arsenal policy that gates which `SKILLS.md` entries an agent may invoke, with rate limiting, JSON Schema argument constraints, time windows, HITL consent, and hash-chained audit receipts.

## Install

```sh
npm install @openagentid/skills-policy
```

## Usage

```ts
import { Did, InvocationContext, SkillsPolicy } from '@openagentid/skills-policy';

const policy = SkillsPolicy.fromYaml(`
version: 1
agent: did:oas:l1fe:agent:my-bot
skills:
  frontend-design:
    allow: true
    rate_limit: { window: 1h, max: 10 }
default:
  allow: false
`);

const ctx = new InvocationContext({
  agentDid: Did.parse('did:oas:l1fe:agent:my-bot'),
  sessionId: 'sess-42',
  arguments: { component: 'Button' },
});

// Throws NotAllowedError, RateLimitExceededError, ConsentRequiredError, etc.
// on denial; returns a hash-chained audit Receipt on success.
const receipt = policy.recordInvocation('frontend-design', ctx);
```

Denials are typed errors (`NotAllowedError`, `RateLimitExceededError`, `ArgumentConstraintError`, `OutsideTimeWindowError`, `ConsentRequiredError`), so callers can distinguish policy decisions from failures. Every allowed invocation appends a receipt to the `AuditChain`, hash-linked to the previous receipt for tamper evidence.

## Links

- [openagent.id](https://openagent.id)
- [GitHub repository](https://github.com/OpenAgentID/openagent-sdk)

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT), at your option.
