# Threat Model

This document describes what OpenAgent protects against, what it explicitly does not protect against, and how to reason about the security of a deployment. It's written for security engineers who are evaluating OpenAgent for production use, but it's also useful for application developers who want to understand where the system boundaries are.

## Assumptions

OpenAgent's security posture assumes:

1. **The Arsenal broker is trusted.** The broker holds provider credentials and enforces policies. A broker compromise is catastrophic. You must deploy the broker with the same care as a KMS or a payments service.
2. **The AEGIS verifier is trusted.** It issues approvals and evaluates policies. Its signing key is a root of trust.
3. **The underlying crypto primitives are sound.** Ed25519, HKDF-SHA256, BLAKE3, FROST, and TLS 1.3 (rustls). If any of these is broken, OpenAgent is broken.
4. **Human HMR keys are held securely.** The security of every descendant agent flows from the security of its root human. A compromised HMR compromises the entire lineage.
5. **Deployments use TLS everywhere.** OpenAgent's crypto is authentication and authorization, not transport security. Run rustls or your equivalent on every connection.

If any of these assumptions is wrong for your deployment, the guarantees below do not hold.

## What OpenAgent protects against

### 1. Credential theft from agent processes

Provider credentials (OpenAI, GitHub, Stripe, etc.) live in the Arsenal broker. Agents never receive them. A complete compromise of an agent process — full RCE, memory dump, disk exfiltration — leaks zero provider credentials. The agent can still abuse its scopes while compromised, but the blast radius is bounded by the scope list and the policy layer, and recovery is a matter of revoking the agent, not rotating vendor keys.

### 2. Scope amplification via delegation

The no-amplification rule is enforced twice: once client-side in the SDK (fast failure) and once server-side in the broker (authoritative). A compromised parent agent cannot create a child with wider scopes, because the broker will refuse to mint the child's ACT. Attackers who attempt to amplify have to compromise the broker itself.

### 3. Replay of old tokens

ACTs carry an expiration and a unique `jti`. The broker tracks issued `jti`s and rejects revoked ones. Detached signatures include a timestamp and a nonce; timestamps older than 300 seconds are rejected, nonces are single-use within the window. Replay attacks against either form of credential fail quickly.

### 4. Lineage forgery

The lineage chain is cryptographic — each proof is an Ed25519 signature binding a child to its parent. Forging a lineage requires forging a signature, which requires the parent's private key. Attackers cannot invent new ancestors or rewrite the chain.

### 5. Audit log tampering

The audit log is hash-chained. Altering any entry breaks every hash downstream, and the chain is verifiable offline. If you're anchoring to Sigil or another append-only log, the root is further anchored on-chain, making tampering detectable by any third party.

### 6. Long-lived credentials lingering after compromise

ACTs are short-lived by default (1 hour). Any leaked token has a bounded lifetime. Long-running agents use refresh, which consults the revocation list on each refresh — a revoked agent cannot refresh, and its token becomes unusable when the current one expires.

### 7. Cross-tenant scope bleed

Scopes are namespaced by service. An `acme-billing:*:*` scope cannot accidentally authorize an `acme-orders` call. Wildcards are per-segment, not cross-cutting.

### 8. SSRF via the credential proxy

Arsenal's broker has an 11-step SSRF guard: scheme allowlist, DNS resolution with IP family pinning, IP allowlist/blocklist, HTTP redirect interception with re-validation, header stripping, and a post-response scrub. A compromised agent cannot trick the broker into proxying a credential to an attacker-controlled URL.

### 9. Policy bypass via local manipulation

Policies (time, rate, spend) are evaluated on the broker, not on the agent. A compromised agent cannot lie about the current time, the rate counter, or the spend counter to bypass a policy — the broker keeps authoritative state.

### 10. Man-in-the-middle on authentication

ACTs are signed; signatures are verified offline using the DID's public key. An MITM attacker who intercepts a request cannot forge a new one because they lack the signing key.

## What OpenAgent does not protect against

### 1. A compromised broker

If an attacker compromises the Arsenal broker, they have the provider credentials, the ability to mint arbitrary ACTs, and the ability to manipulate policy state. Defense: run the broker in a hardened environment with restricted access, use a KMS for the broker's signing key, monitor audit logs for anomalies, and have a recovery plan that includes provider-key rotation.

### 2. A compromised HMR key

If the human's root key is stolen, every descendant agent is compromised. Defense: store HMR keys in hardware tokens, KMS, or FROST threshold setups. Never store HMR keys on disk in plaintext.

### 3. Prompt injection on LLM-driven agents

If an LLM agent is tricked by a malicious prompt into making calls within its granted scopes but for the wrong reason, OpenAgent cannot distinguish "agent decided to call this" from "agent was tricked into calling this." The scopes still bound the damage, but within the scope, the attacker can cause the agent to do anything the scope allows. Defense: narrow scopes, human approval for destructive actions, skills governance with denylists, prompt-injection-resistant agent frameworks.

### 4. Social engineering of humans

If an attacker convinces a human to issue an approval for a malicious action, the approval is valid and OpenAgent will honor it. Defense: human training, requiring context in approval UIs, multiple approvers for high-value actions, out-of-band confirmation.

### 5. Denial of service on the broker

A flood of requests can exhaust broker capacity. The broker has built-in rate limiting per agent and per tenant, but a sustained distributed attack can still degrade service. Defense: load balancing, autoscaling, upstream rate limits, cloud DDoS protection.

### 6. Side channels in the crypto core

Timing attacks, power analysis, cache-based side channels are outside the scope of OpenAgent's guarantees. The primitives we use (ed25519-dalek, BLAKE3) are constant-time in common cases but side-channel-free code is a deep topic and we do not claim side-channel resistance across all deployments.

### 7. Quantum attacks

Ed25519 and HKDF-SHA256 are not quantum-resistant. A sufficiently large quantum computer could forge signatures. Defense: wait for post-quantum migration, which is on the OAS roadmap (ML-DSA, SPHINCS+ hybrid mode). This is not an imminent concern in 2026.

### 8. Malicious policy authors

If someone with policy admin rights writes a policy that allows anything, the policy will allow anything. Policy authorship is privileged — treat it like code and review it.

## Monitoring posture

We recommend three things every deployment should monitor:

1. **Audit chain integrity.** Run `audit verify` periodically for every active agent. Any break triggers an incident.
2. **Denial rate.** A sudden spike in `SCOPE_DENIED` or `POLICY_DENIED` is either a bug in your code or an attacker probing. Either way, investigate.
3. **Broker latency.** The broker is on every credential fetch. A slow broker degrades every agent. Alert on p99 > 50ms.

All three are easy to wire up to any SIEM — the broker has native output adapters for Splunk, Datadog, Elastic, and Loki.

## Incident response

If you suspect a compromise:

1. Identify the smallest revokable unit — a specific agent, its parent, its HMR, or the tenant.
2. Call `OpenAgent.revoke(did, { cascadeDescendants: true, reason: 'incident' })`.
3. Audit the chain for the revoked agents to understand what they did.
4. Rotate any provider credentials the broker was holding for affected services (not because the credentials leaked — they didn't — but because cautious defense in depth is cheap).
5. Review policy configurations to ensure nothing is more permissive than necessary.
6. Review your HMR key custody if the compromise might have reached that high.

Because revocation cascades through the lineage tree, step 2 is often the whole response for sub-tree incidents. For a root-level incident, it's the beginning.

## Getting help

Report security issues privately to security@l1fe.ai. Do not file public GitHub issues for vulnerabilities. See `SECURITY.md` in the repository root for the full disclosure policy.
