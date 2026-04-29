# Audit and Compliance

Autonomous agents in regulated environments need an audit trail that is comprehensive, tamper-evident, and queryable. OpenAgent writes one automatically. This guide covers what goes in the log, how to query it, how to prove it hasn't been altered, and how to wire it up to downstream compliance systems.

## What's in the log

Every OpenAgent operation produces a log entry. The common entry shape:

```json
{
  "id": "audit:0000017fe7b8c9a3",
  "timestamp": "2026-04-11T08:14:22.431Z",
  "agent_did": "did:oas:acme:agent:WorkerBot",
  "lineage": ["did:oas:acme:hmr:alice", "did:oas:acme:agent:RootBot", "did:oas:acme:agent:WorkerBot"],
  "kind": "credential.fetch",
  "service": "openai",
  "scope_required": "openai:chat:invoke",
  "scope_held": true,
  "decision": "allow",
  "reason": null,
  "request": { "method": "POST", "url_hash": "sha256:...", "byte_count": 1243 },
  "response": { "status": 200, "byte_count": 4118, "latency_ms": 824 },
  "prev_hash": "blake3:...",
  "entry_hash": "blake3:..."
}
```

Entries are produced for: authentication attempts, scope checks, skill policy decisions, credential fetches, delegations, revocations, wallet sign events, policy evaluations, and anything else that passes through the facade. Each kind has a specific schema documented in [wire-formats.md](../reference/wire-formats.md).

The `prev_hash` and `entry_hash` form a hash chain. `prev_hash` is the hash of the previous entry for the same agent; `entry_hash` is BLAKE3 of the canonical JSON of the current entry including `prev_hash`. Any alteration anywhere in the chain breaks every subsequent hash. Verification is `O(n)` in the chain length and doesn't require a trusted third party.

## Where it's written

Audit logs are written to a destination configured on the Arsenal broker. Supported sinks:

- **Local append-only file** — good for dev and single-node deployments.
- **PostgreSQL** — the broker writes to an `audit_entries` table. Queryable via SQL. Default in L1fe deployments.
- **AKASHA** — the cognitive substrate. Use this if you want the audit log inside the same memory system as the rest of your agent data.
- **S3 / GCS** — batched writes with a 5-second flush interval. Append-only, no deletion.
- **Sigil blockchain** — anchoring mode: entries are batched, hashed, and the root hash is posted to Sigil periodically. Offers public tamper evidence but is higher latency.

You configure the sink on the broker, not in the SDK. The SDK just produces entries; where they land is an operational decision.

## Querying the log

The SDK exposes a query surface:

```ts
const audit = OpenAgent.audit();

// all entries for a specific agent
const entries = await audit.forAgent('did:oas:acme:agent:WorkerBot').last(1, 'day');

// all denial events across all agents in a time window
const denials = await audit.filter({ decision: 'deny' }).between(start, end);

// full-text search over reasons
const matches = await audit.search('approval expired').limit(100);

// streaming follow mode
const sub = await audit.forAgent(did).subscribe();
for await (const entry of sub) {
  console.log(entry);
}
```

```rust
let audit = oa.audit();
let entries = audit
    .for_agent(&did)
    .last(Duration::days(1))
    .collect()
    .await?;
```

Queries are served by whatever backend your broker is using. For Postgres, the SDK translates them to parameterized SQL. For S3, it downloads and streams the relevant shards. You shouldn't need to care about the backend in application code.

## Verifying the chain

To prove the log hasn't been tampered with, run `audit.verifyChain(forAgentDid)`. The SDK pulls the chain for the given agent, walks it entry-by-entry, recomputes each hash, and returns `{ ok: true }` if the chain is intact or `{ ok: false, brokenAt: entryId }` if not.

```ts
const result = await OpenAgent.audit().forAgent(did).verifyChain();
if (!result.ok) {
  alertSecurityTeam({ agent: did, broken_at: result.brokenAt });
}
```

You should run this periodically as part of your compliance monitoring. If you're anchoring to Sigil, you can also call `verifyAnchor` which additionally cross-checks that the on-chain root matches the local computation — any divergence is a strong signal that something has been tampered with.

## Redaction

Some request bodies contain PII you can't write to a long-term log. The SDK runs a redaction pipeline before every entry is emitted. The default rules cover common patterns (email addresses, credit card numbers, SSNs, phone numbers), and you can add custom rules:

```ts
OpenAgent.configure({
  audit: {
    redact: [
      { field: 'request.headers.authorization', replace: '[REDACTED]' },
      { field: 'request.body', pattern: /\b\d{16}\b/, replace: '[CC]' },
      { field: 'response.body', match: body => body.email, replace: (b) => ({ ...b, email: '[EMAIL]' }) },
    ],
  },
});
```

Redaction happens in-SDK before the entry leaves your process, so sensitive values never reach the broker or the sink. The fields that are redacted are still accounted for — the byte count is preserved, which lets you audit traffic volume without seeing the bodies.

## Compliance profiles

For common regimes, OpenAgent ships "compliance profiles" that preset redaction rules, retention policies, and event kinds:

- `soc2` — default for enterprise, 365-day retention, standard redactions.
- `hipaa` — PHI redaction, no body capture, 6-year retention, immutable sink only.
- `pci-dss` — card number masking, tokenized references only, strict access control.
- `gdpr` — PII minimization, right-to-erasure hooks (logs can be purged on request, with the chain re-linked using tombstones).

Enable with `OpenAgent.configure({ audit: { profile: 'hipaa' } })`. You can still override individual rules after applying a profile.

## Exports

The CLI can export a redacted log for external auditors: `openagent audit export --agent <did> --from 2026-01-01 --to 2026-03-31 --format jsonl > audit.jsonl`. The export is a self-verifying artifact — it includes the hash chain signatures, so the recipient can verify independently with `openagent audit verify audit.jsonl`.

## Integration with SIEM

The broker has native output adapters for common SIEM systems: Splunk HEC, Datadog, Elastic, Grafana Loki. Configure the adapter once and audit entries stream in real time. This is how you tie OpenAgent events into your existing incident-response playbooks without shipping any application code.

Next: browse the [reference section](../reference/typescript-api.md) or the [example projects](../../examples/).
