# Audit and Compliance

The public SDK 0.7.2 does not provide a universal automatic audit store, query
DSL or compliance profile. Your application and configured identity/broker
services own event capture, persistence, access policy, retention and recovery.
A successful signature check or hash-chain check is not a compliance
certification.

## Record decisions at the real boundary

Capture the accepted identity and requested operation after the actual verifier
returns, then record the application's permission decision and outcome. Record
denials and unavailable-authority failures without recording bearer proofs,
private JWKs, proxy URLs, provider secrets or sensitive request/output bodies.
Use exact source-specific root/tenant context rather than an unverified owner
claim. The current verified identity can be owned or explicitly self-rooted;
there is no universal human-root assumption for logging.

The exported `Logger` interface has `debug`, `info`, `warn` and `error`, each
accepting a message and optional field map. Configuration accepts `logger`,
with `silentLogger` as default. This is an adapter interface, not a guarantee
that every facade operation emits an audit event or reaches durable storage.
The application must invoke its event logger/sink at the boundary it controls.

```ts
import type { Logger } from '@openagentid/sdk';
import type { VerifiedAgentIdentity } from '@openagentid/sdk/identity-verification';

export function recordDecision(
  logger: Logger,
  identity: VerifiedAgentIdentity,
  operation: string,
  decision: 'allow' | 'deny',
): void {
  logger.info('agent.permission', {
    agentDid: identity.did,
    operation,
    decision,
    identityExpiresAt: identity.expiresAt,
  });
}
```

Supply a real verified result and a host-controlled operation label. The
example deliberately records no owner identifiers, tokens, task bodies or
provider outputs. Whether the logger durably persists, redacts or signs this
event depends on the application's implementation. A sink that merely writes
to console is not an append-only compliance archive.

## Component-specific audit chains

Separate source components provide narrower audit primitives:

| Source | Actual contract and limit |
| --- | --- |
| `crates/openagent-skills-policy/typescript/src/audit.ts` | `AuditChain.append`, `all`, `head`, `get` and `verify` for in-memory invocation receipts. It uses BLAKE3 over previous hash plus the component's canonical payload. `full` audit can retain arguments; the host chooses capture policy and durable export. |
| `integrations/claude-agent-sdk/typescript/src/audit.ts` | Per-session `AuditChain`, `AuditSink`, `hashRecord`, `verifyChain`; memory/console/fan-out sinks. Sink errors are swallowed by the chain/fan-out paths, so success does not certify durable delivery. |
| Corresponding Rust components | Their own receipt/audit types and adapters; use their exact enabled source/dependencies and serializers. |

These modules are not `OpenAgent.audit()` or subpaths of the public unified
SDK. Their source availability alone does not establish public package access,
host hook compatibility or production integration. The harness audit module
selects its hash implementation separately; do not mix records from different
algorithms/serializers and call them one universal format.

A linked hash chain detects alterations relative to a retained trusted head.
Someone able to replace the full chain and its head can recompute it; it does
not independently prove completeness, authenticated authorship, storage
immutability or the absence of unrecorded operations. Preserve trusted
checkpoints and durable custody according to your threat model. An optional
external anchor needs its actual configured publishing/verification contract;
there is no automatic Sigil/Base anchor in this facade.

## Operational and compliance responsibilities

Choose real durable storage, tenant-scoped query/export authorization and a
failure policy before using audit delivery for an operational decision. Capture
sink acknowledgement/failure, monitor gaps, preserve restart/backup state and
validate exports against retained trusted checkpoints. Decide deliberately
whether an unavailable sink blocks a protected action; best-effort component
hooks do not impose that guarantee.

Redaction, PII minimization, retention, legal hold, deletion and SIEM forwarding
are host/service responsibilities. The SDK provides no automatic sensitive-data
redaction pipeline, SOC2/HIPAA/PCI/GDPR profile, retention timer, native SIEM
adapter or `oaid audit export/verify` command. A logger configuration cannot
promise that secrets never leave a process. In Life integrations, preserve
Blinds credential brokering, Genesis KMS customer-secret custody and the
receiving service's real owner/organization authorization.

Use [identity verification](../identity-verification.md) for the current
proof/root/revocation/replay contract and [developer tooling](../developer-tooling.md)
for actual commands. [Wire-format boundaries](../reference/wire-formats.md)
separate ACT, possession JWT and component-specific audit records.
