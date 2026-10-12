/** Framework-independent identity, policy and audit lifecycle controller.
 * Use createOpenAgentHooks for the Claude Agent SDK options.hooks adapter.
 */

import type {
  AuditSink,
  CapabilityChecker,
  OpenAgentIdentity,
  SkillsPolicy,
} from './types.js';
import {
  ConsoleAuditSink,
  FanOutAuditSink,
  InMemoryAuditSink,
} from './audit.js';
import { DenyUnlessScopedSkillsPolicy } from './policy.js';
import {
  type HookContext,
  type ToolUseInput,
  type PostToolUseInput,
  type MessageInput,
  type SessionStartInput,
  type SkillInvokeInput,
  onMessage as runOnMessage,
  onSessionEnd as runOnSessionEnd,
  onSessionStart as runOnSessionStart,
  onSkillInvoke as runOnSkillInvoke,
  postToolUse as runPostToolUse,
  preToolUse as runPreToolUse,
} from './hooks.js';
import { ConfigError, SkillDeniedError, ToolDeniedError } from './errors.js';

/** Configuration accepted by {@link openAgentPlugin}. */
export interface OpenAgentPluginOptions {
  /** Verified OpenAgent identity to attach to the session. Required. */
  agent: OpenAgentIdentity;
  /** Capability checker — Arsenal-backed in production. Required. */
  capabilities: CapabilityChecker;
  /** Skills policy. Defaults to {@link DenyUnlessScopedSkillsPolicy}. */
  skillsPolicy?: SkillsPolicy;
  /**
   * Audit configuration:
   *   - `false`            → no audit (records are dropped)
   *   - `true`             → in-memory + stdout console sink
   *   - {@link AuditSink}  → custom sink
   */
  audit?: boolean | AuditSink;
  /**
   * Sign every outbound message with the agent's Ed25519 key. Defaults
   * to `false` because most agent flows don't need it.
   */
  signMessages?: boolean;
  /**
   * Behaviour on a denied tool / skill:
   *   - `'throw'`  (default) — throws {@link ToolDeniedError} or {@link SkillDeniedError}
   *   - `'block'`  — returns a blocking decision object the SDK can interpret
   */
  denyMode?: 'throw' | 'block';
}

/** Shape returned by {@link openAgentPlugin}. */
export interface OpenAgentPlugin {
  /** Stable plugin identifier. */
  readonly name: '@openagentid/claude-agent';
  /** Plugin schema version. */
  readonly version: string;
  /** Bound hook handlers — wired to the Claude Agent SDK lifecycle. */
  readonly hooks: PluginHooks;
  /**
   * Inspect the in-memory audit buffer (only populated when `audit: true`
   * with the default sink). Returns an empty array otherwise.
   */
  inspectAudit(): readonly import('./types.js').AuditRecord[];
}

/**
 * Bound hook handlers. Each method receives the SDK's hook input plus the
 * SDK-managed context object and returns a plain JS object the SDK can
 * route. The shapes below are the documented Claude Agent SDK hook
 * signatures; if Anthropic adds a new lifecycle stage we add a new method
 * here without breaking existing wiring.
 */
export interface PluginHooks {
  onSessionStart(input: SessionStartInput): Promise<{ allow: true }>;
  preToolUse(input: ToolUseInput): Promise<HookDecision>;
  postToolUse(input: PostToolUseInput): Promise<{ ok: true }>;
  onMessage(input: MessageInput): Promise<{ allow: true; signature?: string }>;
  onSkillInvoke(input: SkillInvokeInput): Promise<HookDecision>;
  onSessionEnd(): Promise<{ ok: true }>;
}

/** Decision object returned by gating hooks (preToolUse, onSkillInvoke). */
export interface HookDecision {
  allow: boolean;
  reason?: string;
  /**
   * Hash of the canonicalised tool input (preToolUse only) — thread it into
   * the matching postToolUse call so the audit chain links preflight to
   * completion.
   */
  inputHash?: string;
}

const PLUGIN_VERSION = '0.2.0';

/**
 * Build a Claude Agent SDK plugin that wires OpenAgent identity,
 * capability control, and tamper-evident audit logging into the agent
 * lifecycle.
 */
export function openAgentPlugin(opts: OpenAgentPluginOptions): OpenAgentPlugin {
  if (!opts.agent || typeof opts.agent.did !== 'string' || opts.agent.did.length === 0) {
    throw new ConfigError('openAgentPlugin: `agent.did` is required');
  }
  if (!opts.capabilities || typeof opts.capabilities.check !== 'function') {
    throw new ConfigError('openAgentPlugin: `capabilities.check` is required');
  }

  if (opts.signMessages && typeof opts.agent.sign !== 'function') throw new ConfigError('Message signing requires agent.sign');

  const inMemory = new InMemoryAuditSink();
  const sink: AuditSink = resolveSink(opts.audit, inMemory);
  const skillsPolicy = opts.skillsPolicy ?? new DenyUnlessScopedSkillsPolicy();
  const denyMode: 'throw' | 'block' = opts.denyMode ?? 'throw';
  const signMessages = opts.signMessages === true;

  // The hook context is initialised on session start and re-used for
  // every subsequent hook invocation in that session.
  let ctx: HookContext | null = null;

  const hooks: PluginHooks = {
    async onSessionStart(input) {
      const result = await runOnSessionStart(input, {
        identity: opts.agent,
        capabilities: opts.capabilities,
        skillsPolicy,
        signMessages,
        sink,
      });
      ctx = result.context;
      return { allow: true };
    },

    async preToolUse(input) {
      const c = requireCtx(ctx);
      const r = await runPreToolUse(input, c);
      if (!r.allow) {
        if (denyMode === 'throw') {
          throw new ToolDeniedError(input.toolName, r.reason);
        }
        return { allow: false, ...(r.reason ? { reason: r.reason } : {}), inputHash: r.inputHash };
      }
      return { allow: true, inputHash: r.inputHash };
    },

    async postToolUse(input) {
      const c = requireCtx(ctx);
      await runPostToolUse(input, c);
      return { ok: true };
    },

    async onMessage(input) {
      const c = requireCtx(ctx);
      const r = await runOnMessage(input, c);
      return r.signature ? { allow: true, signature: r.signature } : { allow: true };
    },

    async onSkillInvoke(input) {
      const c = requireCtx(ctx);
      const r = await runOnSkillInvoke(input, c);
      if (!r.decision.allowed) {
        if (denyMode === 'throw') {
          throw new SkillDeniedError(input.skillName, r.decision.reason);
        }
        return {
          allow: false,
          ...(r.decision.reason ? { reason: r.decision.reason } : {}),
        };
      }
      return { allow: true };
    },

    async onSessionEnd() {
      if (ctx) {
        await runOnSessionEnd(ctx);
        ctx = null;
      }
      return { ok: true };
    },
  };

  return {
    name: '@openagentid/claude-agent',
    version: PLUGIN_VERSION,
    hooks,
    inspectAudit() {
      return inMemory.records;
    },
  };
}

function requireCtx(c: HookContext | null): HookContext {
  if (!c) {
    throw new ConfigError(
      'openAgentPlugin: hook called before onSessionStart — did the SDK run the session lifecycle?',
    );
  }
  return c;
}

function resolveSink(
  audit: OpenAgentPluginOptions['audit'],
  inMemory: InMemoryAuditSink,
): AuditSink {
  if (audit === undefined || audit === false) {
    return { append() {} };
  }
  if (audit === true) {
    return new FanOutAuditSink([inMemory, new ConsoleAuditSink()]);
  }
  // Custom sink — fan out so callers can still inspectAudit() in dev.
  return new FanOutAuditSink([inMemory, audit]);
}
