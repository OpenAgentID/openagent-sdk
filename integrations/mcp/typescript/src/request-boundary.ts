import { AsyncLocalStorage } from 'node:async_hooks';

export interface InboundToolRequest {
  readonly toolName: string;
  readonly args: unknown;
}

interface TransportLike {
  onmessage?: (message: unknown, ...extra: unknown[]) => unknown;
}

interface Connectable {
  connect?(transport: unknown, ...options: unknown[]): Promise<void>;
  readonly server?: { readonly transport?: unknown };
}

/** Capture the wire request before McpServer applies the tool's Zod schema.
 * Public transport callbacks are the only boundary touched. Async context keeps
 * concurrent calls isolated even when they reuse a JSON-RPC request ID. */
export function installRequestBoundary(server: Connectable): AsyncLocalStorage<InboundToolRequest | undefined> {
  const context = new AsyncLocalStorage<InboundToolRequest | undefined>();
  const wrap = (handler: NonNullable<TransportLike['onmessage']>, transport: object) =>
    (message: unknown, ...extra: unknown[]) => {
      let request: InboundToolRequest | undefined;
      if (message && typeof message === 'object' && 'method' in message && message.method === 'tools/call' &&
          'params' in message && message.params && typeof message.params === 'object' &&
          'name' in message.params && typeof message.params.name === 'string') {
        // Snapshot before schemas or application transforms can mutate the input.
        request = { toolName: message.params.name,
          args: structuredClone('arguments' in message.params ? message.params.arguments : undefined) };
      }
      return context.run(request, () => handler.call(transport, message, ...extra));
    };

  // Also support wrapping an already-connected McpServer via its public transport.
  const existing = server.server?.transport;
  if (existing && typeof existing === 'object') {
    const transport = existing as TransportLike;
    if (transport.onmessage) transport.onmessage = wrap(transport.onmessage, transport);
  }
  const connect = server.connect;
  if (connect) {
    // Patch the public method so both rawServer.connect() and proxy.connect()
    // work; existing callers need not change which handle they connect.
    server.connect = async function (transport: unknown, ...options: unknown[]) {
      if (!transport || typeof transport !== 'object') throw new TypeError('MCP transport is required');
      const wrapped = new Proxy(transport as TransportLike, {
        set(target, key, value) {
          return Reflect.set(target, key, key === 'onmessage' && typeof value === 'function'
            ? wrap(value as NonNullable<TransportLike['onmessage']>, target) : value, target);
        },
        get(target, key) {
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      await connect.call(this, wrapped, ...options);
    };
  }
  return context;
}
