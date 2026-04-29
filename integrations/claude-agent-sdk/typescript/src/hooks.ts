/**
 * Lifecycle hook implementations.
 *
 * These functions are framework-agnostic — they take plain JS objects so
 * they can be wired to any harness shape that the Claude Agent SDK
 * exposes today or in future. The plugin module ({@link ./plugin.ts})
 * adapts them to the SDK's hook signatures.
 *
 * Adapter seam: when the Claude Agent SDK adds new hook stages, add a
 * new function here and surface it from the plugin factory — no other
 * file needs to change.
 */

import type {
  AuditRecord,
  AuditSink,
  CapabilityChecker,
  OpenAgentIdentity,
  SkillDecision,
  SkillsPolicy,
} from './types.js';
import { AuditChain } from './audit.js';
import { canonicalJson, hashHex } from './hash.js';
import { skillScope, toolScope } from './policy.js';
import { ToolDeniedError, SkillDeniedError, PluginError, PluginErrorCode } from './errors.js';

/**
 * Per-session state that the hooks share. Constructed once when the
 * session starts and disposed when it ends.
 */
export interface HookContext {
  readonly identity: OpenAgentIdentity;
  readonly capabilities: CapabilityChecker;
  readonly skillsPolicy: SkillsPolicy;
  readonly chain: AuditChain;
  readonly signMessages: boolean;
}

/** Input shape for {@link onSessionStart}. */
export interface SessionStartInput {
  sessionId: string;
}

/** Result of {@link onSessionStart}. */
export interface SessionStartResult {
  /** The audit record emitted for the session start. */
  record: AuditRecord;
  /** The hook context to be threaded through subsequent hooks. */
  context: HookContext;
}

/**
 * Initialise the per-session hook context and emit the opening audit
 * record. Call this once when the Claude Agent SDK fires the session
 * start hook.
 */
export async function onSessionStart(
  input: SessionStartInput,
  ctx: Omit<HookContext, 'chain'> & { sink: AuditSink },
): Promise<SessionStartResult> {
  if (!ctx.sink) {
    throw new PluginError(
      'AuditSink missing from hook context — did you forget to pass `audit`?',
      PluginErrorCode.CONFIG_INVALID,
    );
  }
  const chain = new AuditChain({
    sessionId: input.sessionId,
    agentDid: ctx.identity.did,
    sink: ctx.sink,
  });
  const record = await chain.append({
    kind: 'session.start',
    outcome: 'ok',
    context: {
      kind: ctx.identity.kind,
      did: ctx.identity.did,
    },
  });
  const { sink: _sink, ...rest } = ctx;
  void _sink;
  return {
    record,
    context: { ...rest, chain },
  };
}

/** Input shape for {@link preToolUse}. */
export interface ToolUseInput {
  /** Tool name as advertised by the Claude Agent SDK. */
  toolName: string;
  /** The arguments the agent intends to pass to the tool. */
  args: unknown;
}

/** Result of a pre-tool-use evaluation. */
export interface PreToolUseResult {
  /** Whether the tool call may proceed. */
  allow: boolean;
  /** Reason on deny. */
  reason?: string;
  /** The audit record emitted (preflight). */
  record: AuditRecord;
  /** Hash of the canonicalised input — reused by post hook. */
  inputHash: string;
}

/**
 * Verify a tool call against Arsenal scopes and emit a preflight audit
 * record.
 *
 * Returns `{ allow: false }` rather than throwing so the caller can
 * decide whether to short-circuit the SDK or surface an error to the
 * model. The plugin's hook adapter throws {@link ToolDeniedError} when
 * the SDK requires an exception-based deny.
 */
export async function preToolUse(
  input: ToolUseInput,
  ctx: HookContext,
): Promise<PreToolUseResult> {
  const required = toolScope(input.toolName);
  const decision = await Promise.resolve(ctx.capabilities.check(required));
  const inputHash = hashHex(canonicalJson(input.args));
  if (!decision.allowed) {
    const record = await ctx.chain.append({
      kind: 'tool.preflight',
      name: input.toolName,
      outcome: 'deny',
      inputHash,
      context: {
        requiredScope: required,
        reason: decision.reason ?? 'No matching scope',
      },
    });
    const result: PreToolUseResult = {
      allow: false,
      record,
      inputHash,
    };
    if (decision.reason !== undefined) result.reason = decision.reason;
    return result;
  }
  const record = await ctx.chain.append({
    kind: 'tool.preflight',
    name: input.toolName,
    outcome: 'allow',
    inputHash,
    context: {
      requiredScope: required,
      ...(decision.matchedScope !== undefined
        ? { matchedScope: decision.matchedScope }
        : {}),
    },
  });
  return { allow: true, record, inputHash };
}

/** Throw-on-deny variant of {@link preToolUse}. */
export async function preToolUseOrThrow(
  input: ToolUseInput,
  ctx: HookContext,
): Promise<PreToolUseResult> {
  const r = await preToolUse(input, ctx);
  if (!r.allow) {
    throw new ToolDeniedError(input.toolName, r.reason);
  }
  return r;
}

/** Input shape for {@link postToolUse}. */
export interface PostToolUseInput {
  toolName: string;
  /** Tool result (any shape). */
  result: unknown;
  /** Was the underlying call successful? */
  ok: boolean;
  /** Optional error description if the call failed. */
  error?: string;
  /** Hash of the original input — typically threaded from preToolUse. */
  inputHash?: string;
}

/**
 * Emit a post-tool-use audit record with input + output hashes.
 *
 * The record's hash chain prevents post-hoc tampering: a verifier can
 * replay {@link import('./audit.js').verifyChain} over an exported chain
 * to detect any modification.
 */
export async function postToolUse(
  input: PostToolUseInput,
  ctx: HookContext,
): Promise<AuditRecord> {
  const outputHash = hashHex(canonicalJson(input.result));
  const record = await ctx.chain.append({
    kind: 'tool.complete',
    name: input.toolName,
    outcome: input.ok ? 'ok' : 'error',
    ...(input.inputHash !== undefined ? { inputHash: input.inputHash } : {}),
    outputHash,
    ...(input.error !== undefined ? { context: { error: input.error } } : {}),
  });
  return record;
}

/** Input shape for {@link onMessage}. */
export interface MessageInput {
  /** Plain-text or already-serialised message body. */
  body: string | Uint8Array;
  /** Direction of the message — used for the audit context only. */
  direction: 'in' | 'out';
}

/** Result of {@link onMessage}. */
export interface OnMessageResult {
  /** Hex-encoded Ed25519 signature, when message signing is enabled. */
  signature?: string;
  /** Audit record emitted for this message. */
  record: AuditRecord;
}

/**
 * Sign an outbound message with the agent's Ed25519 key (if signing is
 * enabled) and append an audit record.
 */
export async function onMessage(
  input: MessageInput,
  ctx: HookContext,
): Promise<OnMessageResult> {
  const bytes =
    typeof input.body === 'string' ? new TextEncoder().encode(input.body) : input.body;
  const inputHash = hashHex(bytes);
  let signature: string | undefined;
  if (ctx.signMessages && input.direction === 'out') {
    try {
      const sigBytes = await Promise.resolve(ctx.identity.sign(bytes));
      signature = bytesToHex(sigBytes);
    } catch (err) {
      throw new PluginError('Failed to sign outbound message', PluginErrorCode.SIGN_FAILED, {
        cause: err,
      });
    }
  }
  const record = await ctx.chain.append({
    kind: 'message.signed',
    outcome: signature ? 'ok' : 'allow',
    inputHash,
    context: {
      direction: input.direction,
      ...(signature !== undefined ? { signature } : {}),
    },
  });
  const result: OnMessageResult = { record };
  if (signature !== undefined) result.signature = signature;
  return result;
}

/** Input shape for {@link onSkillInvoke}. */
export interface SkillInvokeInput {
  skillName: string;
  args?: unknown;
  metadata?: Record<string, unknown>;
}

/** Result of {@link onSkillInvoke}. */
export interface SkillInvokeResult {
  decision: SkillDecision;
  record: AuditRecord;
}

/**
 * Consult the OpenAgent skills policy before a SKILLS.md skill runs.
 *
 * The Claude Agent SDK loads skills from SKILLS.md files; we hook the
 * invocation point and refuse anything the policy denies. Default
 * policy is `DenyUnlessScopedSkillsPolicy`.
 */
export async function onSkillInvoke(
  input: SkillInvokeInput,
  ctx: HookContext,
): Promise<SkillInvokeResult> {
  const decision = await Promise.resolve(
    ctx.skillsPolicy.evaluate(input.skillName, {
      identity: ctx.identity,
      capabilities: ctx.capabilities,
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    }),
  );
  const inputHash =
    input.args !== undefined ? hashHex(canonicalJson(input.args)) : undefined;
  const record = await ctx.chain.append({
    kind: 'skill.preflight',
    name: input.skillName,
    outcome: decision.allowed ? 'allow' : 'deny',
    ...(inputHash !== undefined ? { inputHash } : {}),
    context: {
      requiredScope: skillScope(input.skillName),
      ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
      ...(decision.matchedScope !== undefined
        ? { matchedScope: decision.matchedScope }
        : {}),
    },
  });
  return { decision, record };
}

/** Throw-on-deny variant of {@link onSkillInvoke}. */
export async function onSkillInvokeOrThrow(
  input: SkillInvokeInput,
  ctx: HookContext,
): Promise<SkillInvokeResult> {
  const r = await onSkillInvoke(input, ctx);
  if (!r.decision.allowed) {
    throw new SkillDeniedError(input.skillName, r.decision.reason);
  }
  return r;
}

/** Emit a closing record at session end. */
export async function onSessionEnd(ctx: HookContext): Promise<AuditRecord> {
  return ctx.chain.append({
    kind: 'session.stop',
    outcome: 'ok',
    context: { did: ctx.identity.did, head: ctx.chain.head() },
  });
}

function bytesToHex(buf: Uint8Array): string {
  let s = '';
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i] ?? 0;
    s += v.toString(16).padStart(2, '0');
  }
  return s;
}
