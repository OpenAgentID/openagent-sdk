/**
 * Shared types for the OpenAgent x Claude Agent SDK plugin.
 *
 * These mirror the public surface of `@openagent/sdk` but are duplicated
 * here so the plugin can run in environments where the SDK is not yet
 * resolved (e.g., bun's optional peer dep handling, dev installs).
 *
 * When `@openagent/sdk` is present, the runtime objects passed by the
 * caller are structurally compatible with the interfaces below.
 */

/** A verified OpenAgent identity, anchored on a `did:oas:*` string. */
export interface OpenAgentIdentity {
  /** Decentralised identifier, e.g. `did:oas:test:agent:refactor-bot`. */
  did: string;
  /** Entity kind: `hmr`, `mhr`, `agent`, `tool`, `skill`, etc. */
  kind: string;
  /** Optional human-readable display name (not authoritative). */
  displayName?: string;
  /** Public Ed25519 verification key, hex-encoded (32 bytes). */
  publicKey: string;
  /**
   * Sign a payload with the agent's Ed25519 secret key.
   *
   * The signing key MUST live behind this function — it is never
   * exposed to plugin code directly.
   */
  sign(payload: Uint8Array): Promise<Uint8Array> | Uint8Array;
  /** Optional lineage chain (HMR -> ... -> this agent). */
  lineage?: readonly string[];
}

/** Result of a credential / scope check. */
export interface ScopeDecision {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** Matched scope string (e.g. `tools:invoke:bash`), if any. */
  matchedScope?: string;
  /** Human-readable reason for denial. */
  reason?: string;
}

/** Anything implementing this can authorise tool / skill invocations. */
export interface CapabilityChecker {
  /**
   * Check whether the agent currently holds the requested scope.
   *
   * Implementations should be deterministic and side-effect free —
   * Arsenal-backed checkers may cache, but MUST NOT mutate.
   */
  check(scope: string): Promise<ScopeDecision> | ScopeDecision;
}

/** Audit sink — receives one record per tool / skill invocation. */
export interface AuditSink {
  /** Append an audit record. MUST be best-effort and non-throwing. */
  append(record: AuditRecord): Promise<void> | void;
}

/** A single tamper-evident audit record. */
export interface AuditRecord {
  /** Monotonic sequence number within a session. */
  seq: number;
  /** ISO-8601 timestamp the record was emitted. */
  timestamp: string;
  /** Session id this record belongs to. */
  sessionId: string;
  /** Agent DID that performed the action. */
  agentDid: string;
  /** What kind of event this is. */
  kind: AuditKind;
  /** Tool or skill name (when applicable). */
  name?: string;
  /** Allow / deny outcome. */
  outcome: 'allow' | 'deny' | 'ok' | 'error';
  /** Hash of the request payload (BLAKE3 hex, lowercase). */
  inputHash?: string;
  /** Hash of the response payload (BLAKE3 hex, lowercase). */
  outputHash?: string;
  /** Hash chain pointer to the previous record. */
  prevHash: string;
  /** This record's hash. */
  hash: string;
  /** Free-form context (matched scope, error message, etc.). */
  context?: Record<string, unknown>;
}

/** Categories of audit events. */
export type AuditKind =
  | 'session.start'
  | 'session.stop'
  | 'tool.preflight'
  | 'tool.complete'
  | 'skill.preflight'
  | 'skill.complete'
  | 'message.signed'
  | 'policy.deny';

/** SKILLS.md entry as parsed from a manifest. */
export interface SkillsManifestEntry {
  /** Stable skill identifier (e.g. `web.search`). */
  name: string;
  /** Human description. */
  description?: string;
  /** Required scope to invoke. Defaults to `skills:invoke:<name>`. */
  requiredScope?: string;
}

/** Skills policy: decides whether a SKILLS.md skill may be invoked. */
export interface SkillsPolicy {
  /**
   * Check whether the named skill may be invoked by the current agent.
   *
   * Default behaviour for any concrete implementation: deny unless the
   * agent holds `skills:invoke:<skill-name>`.
   */
  evaluate(skillName: string, ctx: SkillEvaluationContext): Promise<SkillDecision> | SkillDecision;
}

/** Context passed to a skills policy evaluation. */
export interface SkillEvaluationContext {
  /** The agent's verified identity. */
  identity: OpenAgentIdentity;
  /** Capability checker (Arsenal-backed) for scope lookups. */
  capabilities: CapabilityChecker;
  /** Optional metadata about the call site. */
  metadata?: Record<string, unknown>;
}

/** Result of a skills policy evaluation. */
export interface SkillDecision {
  /** Allow / deny. */
  allowed: boolean;
  /** Reason on deny. */
  reason?: string;
  /** The scope that authorised the call. */
  matchedScope?: string;
}
