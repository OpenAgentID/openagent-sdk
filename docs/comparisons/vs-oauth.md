# OpenAgent vs OAuth

OAuth 2.0 is the default choice for third-party access delegation. If you've built anything on the web in the last fifteen years, you've used it. So why are we not just telling you to use OAuth? The short answer: OAuth was designed for humans authorizing applications to access their data, and autonomous agents are a fundamentally different use case. The mismatches start small and accumulate until you're hand-rolling half of OpenAgent anyway.

## What OAuth does well

OAuth 2.0 solves three real problems. First, it lets a user delegate a bounded piece of access to a third-party app without sharing their password. Second, it provides a standard authorization code flow that every major identity provider implements. Third, it has an ecosystem — refresh tokens, revocation endpoints, scopes, introspection — that every framework supports.

For classical web apps, this is excellent. If you're integrating GitHub login into your SaaS, use OAuth. Don't overthink it.

## Where OAuth breaks for agents

**1. OAuth assumes a human in front of a browser.** The core authorization flow redirects to an authorization server and waits for the user to click "allow." Agents don't have browsers or users sitting next to them. You end up using the client credentials grant, which is essentially "here's a static secret, trust me." At that point you've reinvented an API key, poorly.

**2. Tokens are opaque.** Most OAuth deployments issue opaque tokens that require an introspection endpoint call to validate. Every request an agent makes requires a network round-trip to the authorization server. For a system where agents may make thousands of downstream calls per task, that's a lot of latency for no functional benefit. JWTs help but OAuth's JWT usage is ad-hoc and inconsistent across providers.

**3. Scopes are per-provider.** Each OAuth provider defines its own scope vocabulary, and your app has to learn each one. There's no general grammar. An agent that talks to OpenAI, GitHub, Slack, Stripe, and your internal services needs to juggle five different scope schemes. OpenAgent gives you one: `service:resource:action`.

**4. No lineage.** When agent A spawns agent B, OAuth doesn't have a way to express "B is a delegated child of A with a strict subset of A's authority and a clear chain back to a human owner." You'd have to build that yourself with custom claims and out-of-band bookkeeping. OpenAgent bakes lineage into every DID.

**5. No skills layer.** OAuth tells you the caller has the `repo:write` scope. It does not tell you whether, in this particular agent's current context, the `merge-pull-request` skill should actually be invoked — maybe it's outside business hours, or maybe a human hasn't approved the action yet. OAuth has no vocabulary for "behavioral" governance. You'd need to build a separate policy layer on top, and now you have two systems to reason about.

**6. Credential custody is your problem.** OAuth gives you a token. You still hold it. If your agent process is compromised, the token leaks. OpenAgent flips this: the Arsenal broker holds the credential, and agents can only make calls *through* the broker. The credential never enters the agent's memory. That's a property OAuth architecturally cannot provide.

**7. Revocation is soft.** OAuth has a revocation endpoint but enforcement is spotty — most providers don't revoke cached opaque tokens immediately, and JWT revocation requires either deny-lists or short lifetimes. OpenAgent cascades revocations through the lineage tree within seconds and makes the guarantee that revoked tokens cannot be used at the broker.

## Concrete comparison

Suppose you're building a code review agent. It needs to read PRs, post comments, and call an LLM. With OAuth:

1. Register the app with GitHub, get a client ID and secret.
2. Use the device flow (if you're lucky) or an installation token to authenticate the agent.
3. Store the GitHub token somewhere the agent can read it.
4. Separately register with OpenAI, get an API key, store it somewhere.
5. Write your own policy layer for "don't merge PRs outside business hours."
6. Write your own audit log.
7. When a key leaks, manually rotate it everywhere and hope you don't break anything.

With OpenAgent:

1. `OpenAgent.createAgent({ parent, name, scopes: ['github:pulls:read', 'github:pulls:comment', 'openai:chat:invoke'] })`.
2. Write `SKILLS.md` with a `merge-pr: policy: never` clause.
3. Done. Credentials are in Arsenal, audit log is automatic, revocation cascades, lineage is verifiable offline.

## Can you use both?

Yes. OpenAgent is not a replacement for OAuth for end-user flows. If your product has a "sign in with GitHub" button, keep using OAuth for that — the human is in the loop, the authorization server is the right pattern. OpenAgent starts where the human stops, when the agent needs to act on its own for minutes or hours or days.

The clean pattern: humans log in via OAuth (or SAML, or OIDC, or a passkey), the session produces an OpenAgent HMR, and the HMR is the root of the lineage for any agents the human spawns. The two systems compose — OAuth at the perimeter, OpenAgent for the autonomous downstream.

## When to reach for OAuth anyway

- You're talking to a service that only supports OAuth and you can't put Arsenal in front of it. (In practice, you usually can — the broker proxy model means Arsenal can intermediate anything.)
- Your use case is genuinely human-centric and there's no agent in sight. Use OAuth.
- You need a public third-party integration ecosystem (e.g. you're building a marketplace of "add my app" buttons). Use OAuth; that's what it's for.

In every other case — anywhere agents are doing work autonomously for minutes or hours, anywhere you care about lineage, anywhere credential custody is a concern — reach for OpenAgent.
