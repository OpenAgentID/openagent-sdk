/**
 * Error types for @openagentid/mcp.
 *
 * These map onto MCP JSON-RPC error codes so callers see consistent
 * failure modes regardless of which middleware step rejected the call.
 *
 * Reference: https://www.jsonrpc.org/specification#error_object
 */

/** Standard JSON-RPC + MCP error codes used by the middleware. */
export const McpErrorCode = {
  /** -32600 — request was malformed at the JSON-RPC layer. */
  InvalidRequest: -32600,
  /** -32601 — the requested method/tool was not found. */
  MethodNotFound: -32601,
  /** -32602 — params failed validation. */
  InvalidParams: -32602,
  /** -32603 — internal server error. */
  InternalError: -32603,
  /** -32000 — generic server error (used for auth failures by default). */
  ServerError: -32000,
  /** -32001 — identity verification failed. */
  AuthenticationFailed: -32001,
  /** -32002 — caller does not hold the required scope. */
  AuthorizationDenied: -32002,
  /** -32003 — skills policy rejected the call. */
  SkillsPolicyDenied: -32003,
} as const;

export type McpErrorCodeValue =
  (typeof McpErrorCode)[keyof typeof McpErrorCode];

/**
 * Base class for all middleware errors. Subclasses set a default
 * {@link OpenAgentMcpError.code} that maps to a JSON-RPC error code.
 */
export class OpenAgentMcpError extends Error {
  public readonly code: McpErrorCodeValue;
  public readonly data?: Record<string, unknown>;

  constructor(
    message: string,
    code: McpErrorCodeValue,
    data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'OpenAgentMcpError';
    this.code = code;
    if (data !== undefined) {
      this.data = data;
    }
  }

  /**
   * Convert to a plain JSON-RPC error payload that the MCP SDK can
   * serialize over the wire.
   */
  toJsonRpcError(): {
    code: McpErrorCodeValue;
    message: string;
    data?: Record<string, unknown>;
  } {
    if (this.data !== undefined) {
      return { code: this.code, message: this.message, data: this.data };
    }
    return { code: this.code, message: this.message };
  }
}

/** Caller did not present an OpenAgent identity envelope. */
export class MissingIdentityError extends OpenAgentMcpError {
  constructor(toolName: string) {
    super(
      `Tool '${toolName}' requires an OpenAgent identity in _meta.openagent.identity`,
      McpErrorCode.AuthenticationFailed,
      { toolName },
    );
    this.name = 'MissingIdentityError';
  }
}

/** Identity envelope was present but the verifier rejected it. */
export class IdentityVerificationError extends OpenAgentMcpError {
  constructor(toolName: string, cause: unknown) {
    super(
      `Identity verification failed for tool '${toolName}': ${formatCause(cause)}`,
      McpErrorCode.AuthenticationFailed,
      { toolName, cause: formatCause(cause) },
    );
    this.name = 'IdentityVerificationError';
  }
}

/** Caller's verified identity does not hold the required scopes. */
export class AuthorizationDeniedError extends OpenAgentMcpError {
  constructor(
    toolName: string,
    requiredScopes: ReadonlyArray<string>,
    heldScopes: ReadonlyArray<string>,
  ) {
    super(
      `Tool '${toolName}' requires scopes [${requiredScopes.join(', ')}], caller holds [${heldScopes.join(', ')}]`,
      McpErrorCode.AuthorizationDenied,
      {
        toolName,
        requiredScopes: [...requiredScopes],
        heldScopes: [...heldScopes],
      },
    );
    this.name = 'AuthorizationDeniedError';
  }
}

/** Skills policy hook returned `allow: false`. */
export class SkillsPolicyDeniedError extends OpenAgentMcpError {
  constructor(toolName: string, reason: string | undefined) {
    super(
      `Skills policy denied tool '${toolName}'${reason ? `: ${reason}` : ''}`,
      McpErrorCode.SkillsPolicyDenied,
      reason !== undefined ? { toolName, reason } : { toolName },
    );
    this.name = 'SkillsPolicyDeniedError';
  }
}

function formatCause(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === 'string') {
    return cause;
  }
  return 'unknown error';
}
