/**
 * Server-side middleware for @openagentid/mcp.
 *
 * Wraps an MCP {@link McpServer} (from `@modelcontextprotocol/sdk`) so that
 * every tool registration runs through an OpenAgent authentication
 * pipeline:
 *
 *   1. Extract the identity envelope from `extra._meta.openagent.identity`.
 *   2. Verify it via the configured {@link IdentityVerifier} and check
 *      that the caller holds the scopes returned by `requireScopes`.
 *   3. Run the optional skills policy hook.
 *   4. Run the optional pre-call hook.
 *   5. Invoke the user's tool callback.
 *   6. Run the optional post-call hook with the result + duration.
 *   7. Stamp `audit_id` + `verified_did` into the result `_meta.openagent`.
 *   8. On error, run the optional onError hook and re-throw.
 *
 * Implementation note — version pinning:
 *   The middleware is built against `@modelcontextprotocol/sdk@^1.27.0`.
 *   The TypeScript SDK changed its tool registration API between 1.17 and
 *   1.27 (`tool(name, cb, ...)` → `registerTool(name, config, cb)`); both
 *   call sites are intercepted here so any 1.x server still works.
 *
 *   We deliberately do NOT touch the private `_registeredTools` map. The
 *   middleware uses a JavaScript {@link Proxy} so callbacks are wrapped
 *   exactly once at registration time, before the SDK's internal
 *   request handler ever sees them.
 */

import {
  AuthorizationDeniedError,
  IdentityVerificationError,
  MissingIdentityError,
  OpenAgentMcpError,
  SkillsPolicyDeniedError,
} from './errors.js';
import {
  Agent,
  AuditedResultMeta,
  ErrorHook,
  OpenAgentMcpConfig,
  OpenAgentRequestIdentity,
  PostCallHook,
  PreCallHook,
  ScopeDeriver,
  SkillsPolicyHook,
  VerifiedIdentity,
  defaultRequireScopes,
} from './types.js';
import { installRequestBoundary } from './request-boundary.js';

/**
 * Minimal McpServer surface used by the middleware. We avoid importing
 * concrete types from `@modelcontextprotocol/sdk` because peer-dep
 * versions vary across host applications and the SDK's own type exports
 * are subject to change. The shape below is the intersection of every
 * `1.x` McpServer release.
 */
export interface McpServerLike {
  tool(...args: unknown[]): unknown;
  registerTool(...args: unknown[]): unknown;
  connect?(transport: unknown, ...options: unknown[]): Promise<void>;
  readonly server?: { readonly transport?: unknown };
}

/**
 * Names of methods on the underlying server that take a tool callback as
 * one of their arguments. Both APIs are intercepted; if the SDK adds new
 * registration methods, append to this list.
 */
const TOOL_REGISTRATION_METHODS = ['tool', 'registerTool'] as const;

type ToolRegistrationMethod = (typeof TOOL_REGISTRATION_METHODS)[number];

/**
 * Wrap an MCP server so every tool call is authenticated against an
 * OpenAgent identity.
 *
 * @example
 * ```ts
 * import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
 * import { withOpenAgent } from '@openagentid/mcp';
 * import { agent } from './my-agent.js';
 *
 * const server = new McpServer({ name: 'my-tools', version: '0.1.0' });
 * const authedServer = withOpenAgent(server, { agent });
 *
 * authedServer.tool('search_web', searchHandler);
 * ```
 *
 * The returned proxy is type-compatible with the underlying server, so
 * existing code that calls `tool()`, `registerTool()`, `connect()`, etc.
 * keeps working without changes.
 */
export function withOpenAgent<T extends McpServerLike>(
  server: T,
  config: OpenAgentMcpConfig,
): T {
  validateConfig(config);
  const middleware = new ToolMiddleware(config, installRequestBoundary(server));

  return new Proxy(server, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') {
        return value;
      }
      if (
        typeof property === 'string' &&
        TOOL_REGISTRATION_METHODS.includes(property as ToolRegistrationMethod)
      ) {
        return wrapRegistrationMethod(
          value as (...args: unknown[]) => unknown,
          target,
          middleware,
        );
      }
      // Bind methods so `this` stays correct when destructured.
      return value.bind(target);
    },
  }) as T;
}

function validateConfig(config: OpenAgentMcpConfig): void {
  if (config === null || typeof config !== 'object') {
    throw new TypeError('OpenAgentMcpConfig must be an object');
  }
  if (config.agent === undefined || config.agent === null) {
    throw new TypeError('OpenAgentMcpConfig.agent is required');
  }
  if (
    config.agent.verifier === undefined ||
    typeof config.agent.verifier.verify !== 'function'
  ) {
    throw new TypeError('OpenAgentMcpConfig.agent.verifier.verify is required');
  }
}

/**
 * Wrap a single registration method so the user-supplied callback gets
 * replaced by an auth-wrapped one. The MCP SDK accepts the callback in
 * different positional slots depending on overload — we walk the args
 * list and replace the FIRST function we find. This is the same approach
 * the SDK itself uses internally.
 */
function wrapRegistrationMethod(
  original: (...args: unknown[]) => unknown,
  thisArg: unknown,
  middleware: ToolMiddleware,
): (...args: unknown[]) => unknown {
  return function wrapped(this: unknown, ...args: unknown[]): unknown {
    const toolName = extractToolName(args);
    const callbackIndex = findCallbackIndex(args);
    if (callbackIndex === -1) {
      // No callback in the args — defensive: forward as-is so we don't
      // mask SDK-level errors that the host would otherwise see.
      return original.apply(thisArg, args);
    }
    const userCallback = args[callbackIndex] as (
      ...callbackArgs: unknown[]
    ) => unknown;
    const wrappedCallback = middleware.wrap(toolName, userCallback);
    const newArgs = [...args];
    newArgs[callbackIndex] = wrappedCallback;
    return original.apply(thisArg, newArgs);
  };
}

function extractToolName(args: ReadonlyArray<unknown>): string {
  if (args.length > 0 && typeof args[0] === 'string') {
    return args[0];
  }
  // registerTool's first arg is also a string in 1.27, so this should
  // never trigger — kept as a safety net.
  return '<unknown>';
}

function findCallbackIndex(args: ReadonlyArray<unknown>): number {
  // Walk the args from the end so we find the LAST function — that's
  // the tool body in every overload of both `tool()` and
  // `registerTool()`.
  for (let i = args.length - 1; i >= 0; i -= 1) {
    if (typeof args[i] === 'function') {
      return i;
    }
  }
  return -1;
}

/**
 * Holds the middleware configuration and wraps individual tool callbacks.
 */
class ToolMiddleware {
  private readonly agent: Pick<Agent, 'did' | 'verifier'>;
  private readonly requireScopes: ScopeDeriver;
  private readonly requireIdentity: boolean;
  private readonly skillsPolicy: SkillsPolicyHook | undefined;
  private readonly preCall: PreCallHook | undefined;
  private readonly postCall: PostCallHook | undefined;
  private readonly onError: ErrorHook | undefined;

  constructor(config: OpenAgentMcpConfig, private readonly requests: ReturnType<typeof installRequestBoundary>) {
    this.agent = config.agent;
    this.requireScopes = config.requireScopes ?? (config.scopeFormat ? tool => [config.scopeFormat!(tool)] : defaultRequireScopes);
    this.requireIdentity = config.requireIdentity ?? true;
    this.skillsPolicy = config.skillsPolicy;
    this.preCall = config.preCall;
    this.postCall = config.postCall;
    this.onError = config.onError;
  }

  wrap(
    toolName: string,
    userCallback: (...args: unknown[]) => unknown,
  ): (...args: unknown[]) => Promise<unknown> {
    const middleware = this;
    return async function wrappedCallback(
      this: unknown,
      ...callbackArgs: unknown[]
    ): Promise<unknown> {
      // The MCP SDK invokes tool callbacks in two shapes depending on
      // whether the tool has an input schema:
      //   (extra)                — no schema
      //   (args, extra)          — with schema
      // The `extra` is always the LAST arg.
      const { args, extra } = splitToolArgs(callbackArgs);
      const startedAt = nowMs();
      let identity: VerifiedIdentity | null = null;

      try {
        identity = await middleware.runAuthPipeline(toolName, args, extra);

        if (middleware.preCall !== undefined) {
          await middleware.preCall({ toolName, args, identity });
        }

        const result = await Promise.resolve(
          userCallback.apply(this, callbackArgs),
        );

        const stamped = stampAuditMeta(result, identity);

        if (middleware.postCall !== undefined) {
          await middleware.postCall({
            toolName,
            args,
            identity,
            durationMs: nowMs() - startedAt,
            result: stamped,
          });
        }
        return stamped;
      } catch (error: unknown) {
        if (middleware.onError !== undefined) {
          // The error hook MUST NOT throw — if it does, swallow so the
          // original error propagates to the caller intact.
          try {
            await middleware.onError({ toolName, args, identity, error });
          } catch {
            /* intentionally ignored */
          }
        }
        throw normalizeError(error);
      }
    };
  }

  private async runAuthPipeline(
    toolName: string,
    args: unknown,
    extra: unknown,
  ): Promise<VerifiedIdentity> {
    const identityEnvelope = extractIdentityEnvelope(extra);
    if (identityEnvelope === null) {
      if (this.requireIdentity) {
        throw new MissingIdentityError(toolName);
      }
      // Permissive mode: synthesize an "anonymous" identity so hooks
      // still run with a stable shape.
      return ANONYMOUS_IDENTITY;
    }

    const requiredScopes = this.requireScopes(toolName, args);
    let identity: VerifiedIdentity;
    try {
      // Identity binds the original transmitted request. Authorization policies
      // and tool callbacks intentionally use the SDK's parsed/effective arguments.
      const inbound = this.requests.getStore();
      if (inbound && inbound.toolName !== toolName) throw new Error('MCP request/tool binding mismatch');
      identity = await this.agent.verifier.verify(
        identityEnvelope,
        requiredScopes,
        inbound ?? { toolName, args },
      );
    } catch (cause: unknown) {
      throw new IdentityVerificationError(toolName, cause);
    }

    enforceScopes(toolName, requiredScopes, identity.scopes);

    if (this.skillsPolicy !== undefined) {
      const decision = await Promise.resolve(
        this.skillsPolicy({ toolName, args, identity }),
      );
      if (!decision.allow) {
        throw new SkillsPolicyDeniedError(toolName, decision.reason);
      }
    }

    return identity;
  }
}

function enforceScopes(
  toolName: string,
  required: ReadonlyArray<string>,
  held: ReadonlyArray<string>,
): void {
  const missing = required.filter((scope) => !held.includes(scope));
  if (missing.length > 0) {
    throw new AuthorizationDeniedError(toolName, required, held);
  }
}

function splitToolArgs(callbackArgs: ReadonlyArray<unknown>): {
  args: unknown;
  extra: unknown;
} {
  if (callbackArgs.length === 0) {
    return { args: undefined, extra: undefined };
  }
  if (callbackArgs.length === 1) {
    // Single argument is the `extra` object.
    return { args: undefined, extra: callbackArgs[0] };
  }
  return {
    args: callbackArgs[0],
    extra: callbackArgs[callbackArgs.length - 1],
  };
}

function extractIdentityEnvelope(
  extra: unknown,
): OpenAgentRequestIdentity | null {
  if (extra === null || typeof extra !== 'object') {
    return null;
  }
  const meta = (extra as { _meta?: unknown })._meta;
  if (meta === null || typeof meta !== 'object') {
    return null;
  }
  const openAgent = (meta as { openagent?: unknown }).openagent;
  if (openAgent === null || typeof openAgent !== 'object') {
    return null;
  }
  const identity = (openAgent as { identity?: unknown }).identity;
  if (identity === null || typeof identity !== 'object') {
    return null;
  }
  const candidate = identity as Record<string, unknown>;
  if (
    typeof candidate['did'] !== 'string' ||
    typeof candidate['proof'] !== 'string'
  ) {
    return null;
  }
  const envelope: OpenAgentRequestIdentity = {
    did: candidate['did'],
    proof: candidate['proof'],
  };
  if (typeof candidate['nonce'] === 'string') {
    envelope.nonce = candidate['nonce'];
  }
  if (
    typeof candidate['context'] === 'object' &&
    candidate['context'] !== null
  ) {
    envelope.context = candidate['context'] as Record<string, unknown>;
  }
  return envelope;
}

function stampAuditMeta(result: unknown, identity: VerifiedIdentity): unknown {
  if (result === null || typeof result !== 'object') {
    return result;
  }
  const auditMeta: AuditedResultMeta = {
    audit_id: identity.auditId,
    verified_did: identity.did,
    scopes: identity.scopes,
  };
  const existingMeta =
    typeof (result as { _meta?: unknown })._meta === 'object' &&
    (result as { _meta?: unknown })._meta !== null
      ? ((result as { _meta: Record<string, unknown> })._meta)
      : {};
  return {
    ...(result as Record<string, unknown>),
    _meta: {
      ...existingMeta,
      openagent: auditMeta,
    },
  };
}

function normalizeError(error: unknown): unknown {
  if (error instanceof OpenAgentMcpError) {
    // Surface the JSON-RPC code on the error so the SDK's error
    // serializer picks it up.
    const jsonRpc = error.toJsonRpcError();
    Object.assign(error, { code: jsonRpc.code, data: jsonRpc.data });
  }
  return error;
}

function nowMs(): number {
  if (
    typeof performance !== 'undefined' &&
    typeof performance.now === 'function'
  ) {
    return performance.now();
  }
  return Date.now();
}

const ANONYMOUS_IDENTITY: VerifiedIdentity = {
  did: 'did:oas:anonymous',
  scopes: [],
  auditId: 'anonymous',
  claims: {},
};

export { ANONYMOUS_IDENTITY };
