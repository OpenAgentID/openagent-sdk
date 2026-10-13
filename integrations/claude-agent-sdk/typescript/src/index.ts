/** OpenAgent identity and capability hooks for the Claude Agent SDK.
 * Pass createOpenAgentHooks(...).hooks to query({ options: { hooks } }).
 * openAgentPlugin remains a framework-independent lifecycle controller.
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

export { createOpenAgentHooks, createSdkAgentIdentity, sdkToolScope, sdkSkillScope } from './sdk-hooks.js';
