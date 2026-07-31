/**
 * `@openagentid/claude-agent`
 *
 * Drop-in plugin for the Claude Agent SDK that wires OpenAgent identity,
 * Arsenal-backed capability control, and tamper-evident audit logging
 * into the agent lifecycle.
 *
 * Three-line install:
 *
 * ```ts
 * import { query } from '@anthropic-ai/claude-agent-sdk';
 * import { openAgentPlugin } from '@openagentid/claude-agent';
 *
 * const result = query({
 *   prompt: 'Refactor this',
 *   options: {
 *     plugins: [openAgentPlugin({ agent, capabilities, skillsPolicy, audit: true })],
 *   },
 * });
 * ```
 */

export {
  openAgentPlugin,
  type OpenAgentPlugin,
  type OpenAgentPluginOptions,
  type PluginHooks,
  type HookDecision,
} from './plugin.js';

export {
  AuditChain,
  ConsoleAuditSink,
  FanOutAuditSink,
  GENESIS_PREV_HASH,
  InMemoryAuditSink,
  hashRecord,
  verifyChain,
} from './audit.js';

export {
  AllowListSkillsPolicy,
  CompositeSkillsPolicy,
  DenyUnlessScopedSkillsPolicy,
  SKILL_SCOPE_PREFIX,
  StaticCapabilityChecker,
  TOOL_SCOPE_PREFIX,
  skillScope,
  toolScope,
} from './policy.js';

export {
  onMessage,
  onSessionEnd,
  onSessionStart,
  onSkillInvoke,
  onSkillInvokeOrThrow,
  postToolUse,
  preToolUse,
  preToolUseOrThrow,
  type HookContext,
  type MessageInput,
  type OnMessageResult,
  type PostToolUseInput,
  type PreToolUseResult,
  type SessionStartInput,
  type SessionStartResult,
  type SkillInvokeInput,
  type SkillInvokeResult,
  type ToolUseInput,
} from './hooks.js';

export {
  ConfigError,
  PluginError,
  PluginErrorCode,
  type PluginErrorCodeValue,
  SkillDeniedError,
  ToolDeniedError,
} from './errors.js';

export type {
  AuditKind,
  AuditRecord,
  AuditSink,
  CapabilityChecker,
  OpenAgentIdentity,
  ScopeDecision,
  SkillDecision,
  SkillEvaluationContext,
  SkillsManifestEntry,
  SkillsPolicy,
} from './types.js';

export { canonicalJson, getHashAlgo, hashHex } from './hash.js';
