/**
 * Public types for @openagent/mcp.
 *
 * These interfaces describe the contract the middleware expects from an
 * OpenAgent {@link Agent} instance and the surrounding configuration. They are
 * defined locally so the package can be installed without `@openagent/sdk` in
 * tests, in CI, and in environments where the host application brings its own
 * verifier implementation.
 *
 * The real `@openagent/sdk` exports types that are structurally compatible
 * with these — there is no runtime dependency.
 */

/**
 * A decentralized identifier following the `did:oas:*` method or any other
 * DID method understood by the configured verifier.
 */
export type Did = string;

/**
 * The four pieces of metadata an MCP request carries about the calling
 * agent. Populated by the {@link createClientInterceptor} on the call site
 * and consumed by the server middleware.
 */
export interface OpenAgentRequestIdentity {
  /** Caller's DID — typically `did:oas:...`. */
  did: Did;
  /**
   * A signed challenge response or capability token (Arsenal ACT) the
   * server can verify offline. Format is opaque to the middleware.
   */
  proof: string;
  /**
   * Optional bearer-style nonce. Servers may require it for replay
   * protection. Verifiers MUST treat the value as untrusted until
   * verification succeeds.
   */
  nonce?: string;
  /**
   * Free-form context the verifier may use (issuer DID, audience, scopes
   * the caller claims). Always validated against the verifier's policy.
   */
  context?: Record<string, unknown>;
}

/**
 * The result of running the auth pipeline against an incoming MCP request.
 * Available to post-call hooks and audit log emitters.
 */
export interface VerifiedIdentity {
  did: Did;
  scopes: ReadonlyArray<string>;
  /** Audit identifier echoed back to the caller in result `_meta`. */
  auditId: string;
  /** Verifier-issued claims about the caller. */
  claims: Readonly<Record<string, unknown>>;
}

/**
 * The verifier interface — implemented by `@openagent/sdk` (production) and
 * by the in-memory test agent shipped here.
 *
 * Implementations MUST be deterministic for a given input and MUST NOT
 * mutate the request identity object.
 */
export interface IdentityVerifier {
  verify(
    identity: OpenAgentRequestIdentity,
    requiredScopes: ReadonlyArray<string>,
  ): Promise<VerifiedIdentity>;
}

/**
 * Minimal Agent surface — only the parts of the OpenAgent SDK Agent that
 * the MCP middleware actually needs.
 */
export interface Agent {
  did: Did;
  verifier: IdentityVerifier;
  /**
   * Sign an outbound MCP call so the receiving server can verify the
   * caller. Returns the identity envelope to attach as `_meta.openagent`.
   */
  signRequest(
    toolName: string,
    audience?: Did,
  ): Promise<OpenAgentRequestIdentity>;
}

/**
 * Result envelope returned by an authenticated tool call. The `auditId` is
 * pushed into `_meta.openagent.audit_id` on the response, so callers can
 * correlate logs end-to-end.
 */
export interface AuditedResultMeta {
  audit_id: string;
  verified_did: Did;
  scopes: ReadonlyArray<string>;
}

/** Per-tool scope deriver. */
export type ScopeDeriver = (
  toolName: string,
  args: unknown,
) => ReadonlyArray<string>;

/**
 * Hook signature for the skills policy. The hook receives the tool name,
 * the arguments, and the verified identity, and decides whether the call
 * should be allowed.
 */
export type SkillsPolicyHook = (input: {
  toolName: string;
  args: unknown;
  identity: VerifiedIdentity;
}) => Promise<SkillsPolicyDecision> | SkillsPolicyDecision;

export interface SkillsPolicyDecision {
  allow: boolean;
  reason?: string;
}

/**
 * Hook fired before a tool body executes — after the identity has been
 * verified and the skills policy has approved the call.
 */
export type PreCallHook = (input: {
  toolName: string;
  args: unknown;
  identity: VerifiedIdentity;
}) => Promise<void> | void;

/**
 * Hook fired after a tool body executes successfully. Use it for audit
 * logging, metrics, and trace propagation. Throwing from this hook does
 * NOT roll back the tool call.
 */
export type PostCallHook = (input: {
  toolName: string;
  args: unknown;
  identity: VerifiedIdentity;
  durationMs: number;
  result: unknown;
}) => Promise<void> | void;

/**
 * Hook fired when the tool body or any earlier middleware step throws.
 * The middleware re-throws the error after running this hook so MCP
 * clients still observe the original failure mode.
 */
export type ErrorHook = (input: {
  toolName: string;
  args: unknown;
  identity: VerifiedIdentity | null;
  error: unknown;
}) => Promise<void> | void;

/**
 * Configuration for {@link withOpenAgent}.
 */
export interface OpenAgentMcpConfig {
  /** The agent that owns this MCP server (used for outbound signing). */
  agent: Agent;
  /**
   * Per-tool required scope set. Defaults to
   * `(toolName) => [`mcp:${toolName}:invoke`]`.
   */
  requireScopes?: ScopeDeriver;
  /**
   * If true (default), tool calls without an `_meta.openagent.identity`
   * envelope are rejected. Set to false to opt-in to permissive mode for
   * local development — the middleware will still run hooks but skip
   * verification.
   */
  requireIdentity?: boolean;
  /** Optional skills policy hook. */
  skillsPolicy?: SkillsPolicyHook;
  /** Optional pre-call hook. */
  preCall?: PreCallHook;
  /** Optional post-call hook for audit/log emission. */
  postCall?: PostCallHook;
  /** Optional error hook. */
  onError?: ErrorHook;
  /**
   * Override the default `mcp:<tool>:invoke` scope format. Receives the
   * tool name and returns the canonical scope string.
   */
  scopeFormat?: (toolName: string) => string;
}

/**
 * Default scope format used when {@link OpenAgentMcpConfig.scopeFormat} is
 * not supplied.
 */
export const defaultScopeFormat = (toolName: string): string =>
  `mcp:${toolName}:invoke`;

/**
 * Default scope deriver used when {@link OpenAgentMcpConfig.requireScopes}
 * is not supplied.
 */
export const defaultRequireScopes = (toolName: string): ReadonlyArray<string> =>
  [defaultScopeFormat(toolName)];
