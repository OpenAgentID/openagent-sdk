/**
 * Plugin-specific error hierarchy. These extend `Error` directly so the
 * package has no hard runtime dep on `@openagent/sdk` — when that SDK is
 * present, callers can additionally check `instanceof OpenAgentError`
 * via duck typing on `code`.
 */

/** Stable, machine-readable error codes. */
export const PluginErrorCode = {
  CONFIG_INVALID: 'openagent/claude-agent/config-invalid',
  IDENTITY_MISSING: 'openagent/claude-agent/identity-missing',
  TOOL_DENIED: 'openagent/claude-agent/tool-denied',
  SKILL_DENIED: 'openagent/claude-agent/skill-denied',
  AUDIT_FAILED: 'openagent/claude-agent/audit-failed',
  HOOK_INTERNAL: 'openagent/claude-agent/hook-internal',
  SIGN_FAILED: 'openagent/claude-agent/sign-failed',
} as const;

export type PluginErrorCodeValue = (typeof PluginErrorCode)[keyof typeof PluginErrorCode];

/** Base error for the plugin. */
export class PluginError extends Error {
  public readonly code: PluginErrorCodeValue;
  public readonly context?: Record<string, unknown>;
  public override readonly cause?: unknown;

  constructor(
    message: string,
    code: PluginErrorCodeValue,
    options?: { context?: Record<string, unknown>; cause?: unknown },
  ) {
    super(message);
    this.name = 'PluginError';
    this.code = code;
    if (options?.context !== undefined) this.context = options.context;
    if (options?.cause !== undefined) this.cause = options.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
    };
  }
}

/** A tool call was rejected because the agent lacks the required scope. */
export class ToolDeniedError extends PluginError {
  public readonly tool: string;

  constructor(tool: string, reason?: string, context?: Record<string, unknown>) {
    super(reason ?? `Tool denied: ${tool}`, PluginErrorCode.TOOL_DENIED, {
      context: { ...context, tool },
    });
    this.name = 'ToolDeniedError';
    this.tool = tool;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A skill invocation was rejected by the skills policy. */
export class SkillDeniedError extends PluginError {
  public readonly skill: string;

  constructor(skill: string, reason?: string, context?: Record<string, unknown>) {
    super(reason ?? `Skill denied: ${skill}`, PluginErrorCode.SKILL_DENIED, {
      context: { ...context, skill },
    });
    this.name = 'SkillDeniedError';
    this.skill = skill;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Configuration was invalid at plugin construction time. */
export class ConfigError extends PluginError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, PluginErrorCode.CONFIG_INVALID, { context });
    this.name = 'ConfigError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
