/**
 * Client-side interceptor for @openagentid/mcp.
 *
 * Adds an OpenAgent identity envelope (`_meta.openagent.identity`) to
 * outbound MCP `tools/call` requests so an authenticated server can
 * verify the caller. The interceptor wraps the MCP client's `callTool`
 * method via a JavaScript Proxy — the rest of the client surface (list
 * tools, list resources, prompts) is forwarded unchanged.
 *
 * Usage:
 *
 * ```ts
 * import { Client } from '@modelcontextprotocol/sdk/client/index.js';
 * import { withOpenAgentClient } from '@openagentid/mcp/client';
 *
 * const client = new Client({ name: 'my-agent', version: '0.1.0' });
 * const authedClient = withOpenAgentClient(client, { agent });
 *
 * await authedClient.callTool({ name: 'search_web', arguments: { q: 'mcp' } });
 * ```
 */

import { Agent } from './types.js';

/**
 * Minimal MCP client surface used by the interceptor. Like the server
 * adapter, we describe just the methods we need to keep peer-dep
 * compatibility broad.
 */
export interface McpClientLike {
  callTool(
    params: {
      name: string;
      arguments?: Record<string, unknown>;
      _meta?: Record<string, unknown>;
    },
    ...rest: unknown[]
  ): Promise<unknown>;
}

export interface OpenAgentClientConfig {
  /** The agent doing the calling — used to sign each request. */
  agent: Pick<Agent, 'did' | 'signRequest'>;
  /**
   * Optional audience DID. When set, it is passed to
   * {@link Agent.signRequest} so the proof can be bound to a specific
   * server. Most production deployments should set this.
   */
  audience?: string;
  /**
   * Optional hook fired before every outbound call. Use it for client-
   * side metrics or to mutate the params (e.g., add tracing headers).
   * Returning a value replaces the params.
   */
  beforeCall?: (params: {
    name: string;
    arguments?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
  }) => Promise<
    | { name: string; arguments?: Record<string, unknown>; _meta?: Record<string, unknown> }
    | void
  > | { name: string; arguments?: Record<string, unknown>; _meta?: Record<string, unknown> }
    | void;
}

/**
 * Wrap an MCP client so every outbound `callTool` carries an OpenAgent
 * identity envelope.
 */
export function withOpenAgentClient<T extends McpClientLike>(
  client: T,
  config: OpenAgentClientConfig,
): T {
  if (config === null || typeof config !== 'object') {
    throw new TypeError('OpenAgentClientConfig must be an object');
  }
  if (config.agent === undefined || config.agent === null) {
    throw new TypeError('OpenAgentClientConfig.agent is required');
  }
  if (typeof config.agent.signRequest !== 'function') {
    throw new TypeError('OpenAgentClientConfig.agent.signRequest is required');
  }

  const interceptor = new ClientInterceptor(config);

  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') {
        return value;
      }
      if (property === 'callTool') {
        return interceptor.wrapCallTool(
          value as McpClientLike['callTool'],
          target,
        );
      }
      return value.bind(target);
    },
  }) as T;
}

class ClientInterceptor {
  private readonly agent: Pick<Agent, 'did' | 'signRequest'>;
  private readonly audience: string | undefined;
  private readonly beforeCall: OpenAgentClientConfig['beforeCall'];

  constructor(config: OpenAgentClientConfig) {
    this.agent = config.agent;
    this.audience = config.audience;
    this.beforeCall = config.beforeCall;
  }

  wrapCallTool(
    original: McpClientLike['callTool'],
    thisArg: unknown,
  ): McpClientLike['callTool'] {
    const interceptor = this;
    return async function wrappedCallTool(
      this: unknown,
      params: {
        name: string;
        arguments?: Record<string, unknown>;
        _meta?: Record<string, unknown>;
      },
      ...rest: unknown[]
    ): Promise<unknown> {
      // Mutate first; the signature must cover the actual transmitted call.
      const replacement = await interceptor.beforeCall?.(params);
      const toSend = await interceptor.signParams(replacement ?? params);
      return original.call(thisArg, toSend, ...rest);
    };
  }

  private async signParams(params: {
    name: string;
    arguments?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
  }): Promise<{
    name: string;
    arguments?: Record<string, unknown>;
    _meta: Record<string, unknown>;
  }> {
    const identity = await this.agent.signRequest(params.name, this.audience, params.arguments);
    const existingMeta = params._meta ?? {};
    const existingOpenAgent =
      typeof existingMeta['openagent'] === 'object' &&
      existingMeta['openagent'] !== null
        ? (existingMeta['openagent'] as Record<string, unknown>)
        : {};
    return {
      ...params,
      _meta: {
        ...existingMeta,
        openagent: {
          ...existingOpenAgent,
          identity,
        },
      },
    };
  }
}

/**
 * Helper for tests and tools that want to construct the identity
 * envelope manually without going through a full Agent. Returns a `_meta`
 * object that can be merged into a CallToolRequest's params.
 */
export function buildIdentityMeta(identity: {
  did: string;
  proof: string;
  nonce?: string;
  context?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    openagent: {
      identity: {
        did: identity.did,
        proof: identity.proof,
        ...(identity.nonce !== undefined ? { nonce: identity.nonce } : {}),
        ...(identity.context !== undefined
          ? { context: identity.context }
          : {}),
      },
    },
  };
}
