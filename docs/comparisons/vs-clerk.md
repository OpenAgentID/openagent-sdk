# OpenAgent vs Clerk

Clerk is a wonderful product. If you are building a web app with users — real humans who log in with email and password or social providers — and you want to add authentication in an afternoon, Clerk is probably the fastest path. OpenAgent is modeled on Clerk's developer experience *for autonomous agents*, and the positioning ("Clerk/Auth0 for autonomous agents") is deliberate. But they solve different problems and the comparison is worth making explicit.

## What Clerk does

Clerk provides authentication as a service for human users. You drop their React SDK into your Next.js app, users get a hosted sign-in page, you get a JWT-backed session and React hooks like `useUser()` and `<SignedIn>`. Email verification, password reset, social login, MFA, organizations, user metadata — all wrapped in a clean API and a polished UI kit. The developer experience is extraordinary.

Their backend handles the things you don't want to think about: password hashing, session management, fraud detection, rate limiting on auth endpoints, GDPR-compliant user data. You focus on your app; they focus on identity.

## What OpenAgent does

OpenAgent does the same thing for non-human callers. Instead of `useUser()` returning an email, `OpenAgent.authenticate(request)` returns a DID, a lineage chain, a scope list, and a policy evaluation. Instead of "user signed in via Google," you get "agent descended from human:alice, holds openai:chat:invoke, expires in 47 minutes, current spend is $3.14."

The developer experience goal is parallel: three lines of code at the boundary, structured decisions, a polished facade over hard cryptography. If you've built with Clerk and wished there was an equivalent for agent calls, OpenAgent is that equivalent.

## Side-by-side

| Concern | Clerk | OpenAgent |
|---|---|---|
| Primary caller | Human user with a browser | Autonomous agent |
| Identity primitive | User ID + JWT session | W3C DID + capability token |
| Auth input | Email/password, OAuth redirect, MFA | ACT in `Authorization` header, or detached signature |
| Authorization | Organization roles, metadata | Scopes (service:resource:action) + AEGIS policies |
| Session lifetime | Days to weeks | Minutes to hours (short-lived, refreshed) |
| Revocation | Clerk dashboard, "sign out all sessions" | Cascade revocation through lineage tree |
| Credential custody | User's password in Clerk | Provider credentials in Arsenal broker |
| Policy layer | Feature flags, custom backend code | Skills governance with a small DSL |
| Lineage | No concept | Built-in; every agent traces back to a human |
| React hooks | Yes: `useUser`, `<SignedIn>`, `<SignedOut>` | TypeScript equivalents for MCP/agent surfaces |
| Hosted UI | Yes — sign-in pages, UserProfile | N/A for agents; human approval UI is bring-your-own |
| Audit | Event feed in dashboard | Hash-chained, offline-verifiable audit log |

The important word in the table is **parallel**, not overlapping. Clerk handles humans, OpenAgent handles agents. A typical deployment uses both: Clerk at the human-facing boundary of your app, OpenAgent for any autonomous work that happens after the human signs in.

## The composed pattern

Here is the canonical way they fit together:

```ts
// in a Next.js API route
import { auth as clerkAuth } from '@clerk/nextjs/server';
import { OpenAgent } from '@openagent/sdk';

export async function POST(req: Request) {
  const { userId } = await clerkAuth();       // human via Clerk
  if (!userId) return new Response('unauthorized', { status: 401 });

  const humanDid = await OpenAgent.humanFromClerkId(userId);
  const agent = await OpenAgent.createAgent({
    parent: humanDid,
    name: 'research-task',
    scopes: ['openai:chat:invoke', 'tavily:search:invoke'],
    expiresInHours: 1,
  });

  // Hand the agent's ACT to a worker process or a background job
  await enqueueJob({ agentDid: agent.did, act: agent.actCompactString, ... });
  return Response.json({ ok: true });
}
```

The human logs in via Clerk. Clerk returns a user ID. `OpenAgent.humanFromClerkId` maps that user ID to an HMR DID (the mapping is a Clerk metadata field — set it once when the user first appears). Now the human has an OpenAgent identity. Any agent they spawn is lineage-anchored to their HMR. Revoking their Clerk session doesn't automatically revoke their agents, but a custom hook on Clerk's "user signed out everywhere" event can trigger an OpenAgent revoke.

The integration is a few hours of work, not a rewrite.

## Developer experience parity

The specific things OpenAgent tries to match from Clerk's DX:

- **Three-line quickstart.** Clerk: `<SignedIn>`, `useUser()`, done. OpenAgent: `createAgent`, `authenticate`, `credentialsFor`, done.
- **Typed everything.** Clerk's SDK has first-class TypeScript. OpenAgent ships types built in.
- **Framework adapters.** Clerk has Next.js, Remix, Astro, Express, Fastify. OpenAgent has Express, Fastify, Hono, Axum, Tower, and the Claude Agent plugin.
- **Helpful errors.** Clerk's errors are structured and actionable. OpenAgent's errors have `code`, `httpStatus`, and `details` fields with recommended remediation documented in [error-codes.md](../reference/error-codes.md).
- **Local dev mode.** Clerk has a development mode with test users. OpenAgent has a `FakeBroker` test double that mints valid ACTs in-process for tests.

## What Clerk does that OpenAgent doesn't

- Sign-in / sign-up flows. OpenAgent has no UI for humans. Use Clerk (or Auth0, or Ory, or Kratos) for that.
- User profile management, email verification, password reset. Not OpenAgent's problem.
- Multi-tenant dashboards for end users. You'll still build these yourself or use Clerk's organizations feature.
- Fraud detection and attack prevention at the sign-in layer. OpenAgent assumes you've handled this upstream.

## When to use which

- **Humans only, no agents in sight?** Use Clerk. Don't bother with OpenAgent.
- **Agents only, no humans?** Use OpenAgent. The human-facing parts of Clerk are irrelevant.
- **Both?** Use both, composed as shown above. This is the common case.
- **You want to hand-roll it?** You will rebuild Clerk or OpenAgent badly. Don't.

The frame that helps most: Clerk is the front door for people, OpenAgent is the back door for machines.
