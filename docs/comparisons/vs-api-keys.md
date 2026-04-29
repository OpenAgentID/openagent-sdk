# OpenAgent vs Raw API Keys

Raw API keys are the path of least resistance for agents. You get an OpenAI key, you paste it into a config file, your agent calls the API. Done. Until it's not. This page is about what goes wrong with API keys at scale and why OpenAgent's capability token model fixes those specific problems.

## What's wrong with API keys

An API key is a long-lived bearer credential. Whoever holds it has the authority it carries, no questions asked. For a single developer in a single process, fine. For a system running hundreds of agents across multiple machines, it's a tire fire waiting to happen:

**1. No identity binding.** An API key does not say *who* is using it. If you have 200 agents sharing one OpenAI key — which is how most real systems end up — you can't tell which agent made which call. Your OpenAI dashboard shows one client. Your audit log is meaningless.

**2. Leakage is catastrophic.** One leaked key, one compromised process, and every call from the key counts against your quota, your budget, and your reputation. You rotate the key. Now you have to redeploy every agent that was using it. If the agents are running in customer environments, you have to coordinate a rollout. This is the kind of incident that takes half a day at 3am.

**3. No scope granularity.** OpenAI keys are all-or-nothing. Stripe keys can be "restricted" but the restrictions are coarse. GitHub personal access tokens can have scopes, but only the scopes the vendor happens to define. You can't say "this agent can call `chat.completions` but not `fine-tuning.create`" because the vendor didn't let you.

**4. No expiration.** API keys live forever by default. A key you issued in 2022 still works in 2026. A key a departed employee pasted into a Slack message still works, forever, unless you remember to rotate it.

**5. No aggregate budget control.** Quotas exist at the vendor's account level, not the per-agent level. If one agent goes rogue and burns through $10,000 of OpenAI credits in an hour, you find out when your billing alert fires.

**6. No behavioral context.** A key says "you can call the API." It says nothing about "you can call it up to $50/day" or "you can call it but not with a prompt that mentions customer data" or "you can call it but only during business hours." Those constraints have to live somewhere — usually as ad-hoc logic scattered across your codebase.

**7. Manual audit.** If you want to know every call a specific agent made, you have to reconstruct it from your own logs plus the vendor's dashboard, hoping the vendor logs enough detail. There's no cross-vendor consistency.

## What capability tokens fix

Arsenal Capability Tokens (ACTs) are the OpenAgent answer. Each ACT:

- **Is bound to a DID.** Every call carries an identity. Your audit log knows exactly which agent made which request.
- **Expires.** Default lifetime is 1 hour. Long-running agents refresh; one-shot agents simply die when their token does. A leaked token is dangerous for 60 minutes, not forever.
- **Is scoped.** `openai:chat:invoke` is different from `openai:embeddings:invoke` is different from `openai:fine-tuning:create`. You grant exactly what the agent needs.
- **Is revocable.** Revoke cascades through the lineage within seconds. A compromised agent can be killed with one call.
- **Is governed by policy.** The ACT carries references to AEGIS policies that run on every request. Spending caps, rate limits, time windows, IP allowlists — all enforced at the broker, not in the agent.
- **Never holds the raw credential.** The Arsenal broker holds the real API key. The agent never sees it. A completely compromised agent leaks zero vendor credentials.

## Cost model

A common objection: "isn't putting a proxy in front of every API call slow and expensive?" In practice: no. The broker is a thin Rust service that adds 1-3ms of latency to outbound calls (compared to hundreds of ms for any real LLM call). It can be colocated with your agents or run as a sidecar for near-zero overhead. Throughput exceeds 50,000 requests per second per broker instance on commodity hardware.

The operational cost of *not* having a broker is much higher: on-call pages at 3am for rotated keys, mysterious bills because you can't attribute costs per agent, incidents where you discover too late that one bug burned through a month's budget.

## Can I keep API keys for some things?

Sure. OpenAgent has an escape hatch: `agent.rawCredential('service')` returns the raw credential string, one-shot, bound to the current agent's DID. It's audited, it's rate-limited, and it requires an explicit `openagent:credential:raw` meta-scope that most deployments deny by policy.

You use this when you're integrating with a client library that refuses to accept a base URL override and you can't put the broker in front of it. It's a pragmatic hatch, not a preferred pattern.

## The takeaway

Raw API keys are fine for hobby projects, demos, and solo developers. The moment you have more than one agent, or more than one machine, or any compliance story at all, the cost of managing keys exceeds the cost of adopting a capability model. OpenAgent's broker makes the capability model cheap to adopt — a few lines of code at the agent, zero changes to the upstream vendor, full audit and policy enforcement out of the box.

If you're still unconvinced, try writing down the answer to "how do I rotate every OpenAI key in my deployment in under an hour with zero downtime?" If your answer includes the word "script" or "runbook," OpenAgent is worth an afternoon of your time.
