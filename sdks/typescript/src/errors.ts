/**
 * Unified error hierarchy for the OpenAgent SDK.
 *
 * All OpenAgent SDK errors extend {@link OpenAgentError}. This lets callers
 * catch the whole family with a single `instanceof` check, while still
 * discriminating on `code` / subclass when they care about the specifics.
 *
 * Error codes are stable strings and may be used for logging, metrics,
 * and cross-language parity with the Rust SDK.
 */

/**
 * Stable machine-readable error codes. These are part of the SDK's public
 * contract and MUST stay in sync with the Rust reference implementation.
 */
export const ErrorCode = {
  // Config / usage errors
  INVALID_CONFIG: 'openagent/invalid-config',
  INVALID_INPUT: 'openagent/invalid-input',
  NOT_INITIALIZED: 'openagent/not-initialized',

  // Identity (OAS)
  IDENTITY_CREATE_FAILED: 'openagent/identity/create-failed',
  IDENTITY_RESOLVE_FAILED: 'openagent/identity/resolve-failed',
  IDENTITY_SIGNATURE_INVALID: 'openagent/identity/signature-invalid',
  IDENTITY_LINEAGE_INVALID: 'openagent/identity/lineage-invalid',

  // Credentials (Arsenal)
  CREDENTIAL_FETCH_FAILED: 'openagent/credentials/fetch-failed',
  CREDENTIAL_SCOPE_DENIED: 'openagent/credentials/scope-denied',
  CREDENTIAL_PROVIDER_UNKNOWN: 'openagent/credentials/provider-unknown',
  CREDENTIAL_EXPIRED: 'openagent/credentials/expired',

  // Verification (AEGIS)
  VERIFICATION_FAILED: 'openagent/verification/failed',
  AUTH_REQUIRED: 'openagent/verification/auth-required',
  AUTH_CHALLENGE_INVALID: 'openagent/verification/challenge-invalid',

  // Skills policy
  SKILL_DENIED: 'openagent/skills/denied',
  SKILL_UNKNOWN: 'openagent/skills/unknown',

  // Transport / runtime
  NETWORK_ERROR: 'openagent/network-error',
  SERIALIZATION_ERROR: 'openagent/serialization-error',
  UNKNOWN: 'openagent/unknown',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Structured error metadata attached to every {@link OpenAgentError}. */
export interface ErrorDetails {
  /** Stable machine-readable code. */
  code: ErrorCodeValue;
  /** Optional cause (native Error, SDK error, or anything). */
  cause?: unknown;
  /** Arbitrary structured context for logging. */
  context?: Record<string, unknown>;
}

/**
 * Root of the OpenAgent SDK error hierarchy.
 *
 * ```ts
 * try {
 *   await OpenAgent.createAgent({ ... });
 * } catch (err) {
 *   if (err instanceof OpenAgentError) {
 *     console.error(err.code, err.message);
 *   }
 * }
 * ```
 */
export class OpenAgentError extends Error {
  public readonly code: ErrorCodeValue;
  public override readonly cause?: unknown;
  public readonly context?: Record<string, unknown>;

  constructor(message: string, details: ErrorDetails) {
    super(message);
    this.name = 'OpenAgentError';
    this.code = details.code;
    this.cause = details.cause;
    this.context = details.context;
    // Restore prototype chain for cross-realm / transpilation safety.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Convert to a plain JSON object safe for structured logging. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
    };
  }
}

/** Configuration or usage violation (invalid input, missing dependency). */
export class ConfigError extends OpenAgentError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, { code: ErrorCode.INVALID_CONFIG, context });
    this.name = 'ConfigError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Runtime input validation failure (Zod, boundary checks). */
export class InputValidationError extends OpenAgentError {
  constructor(message: string, cause?: unknown, context?: Record<string, unknown>) {
    super(message, { code: ErrorCode.INVALID_INPUT, cause, context });
    this.name = 'InputValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** OAS identity subsystem failure. */
export class IdentityError extends OpenAgentError {
  constructor(message: string, details: ErrorDetails) {
    super(message, details);
    this.name = 'IdentityError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Arsenal credentials subsystem failure. */
export class CredentialError extends OpenAgentError {
  constructor(message: string, details: ErrorDetails) {
    super(message, details);
    this.name = 'CredentialError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** AEGIS verification subsystem failure. */
export class VerificationError extends OpenAgentError {
  constructor(message: string, details: ErrorDetails) {
    super(message, details);
    this.name = 'VerificationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Skills policy denial. */
export class SkillDeniedError extends OpenAgentError {
  public readonly skill: string;

  constructor(skill: string, reason?: string, context?: Record<string, unknown>) {
    super(reason ?? `Skill denied: ${skill}`, {
      code: ErrorCode.SKILL_DENIED,
      context: { ...context, skill },
    });
    this.name = 'SkillDeniedError';
    this.skill = skill;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Wraps any non-OpenAgentError into the SDK hierarchy without losing the cause. */
export function wrapError(err: unknown, fallbackMessage: string): OpenAgentError {
  if (err instanceof OpenAgentError) return err;
  const message = err instanceof Error ? err.message : fallbackMessage;
  return new OpenAgentError(message, { code: ErrorCode.UNKNOWN, cause: err });
}

/** Narrow an unknown caught value to a human-readable message. */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unexpected error';
}
