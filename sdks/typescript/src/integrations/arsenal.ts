import type { ArsenalClient as PublishedArsenalClient, CapabilityHandle } from '@openagentid/arsenal-sdk';
import { didSchema } from '../config.js';

/** Explicit tenant/identity binding required before translating a DID into the
 * Arsenal client's independently assigned agent id and capability subject. */
export interface ArsenalIdentityBinding {
  readonly did: string;
  readonly agentId: string;
  readonly tenantId: string;
  readonly audience: string;
}

/** Use an actual broker-issued Arsenal capability for HTTP requests. Arsenal's
 * published proxy API buffers request/response bytes; this does not promise SSE
 * streaming. Secret template values remain broker-side. */
export function createArsenalCapabilityFetch(options: {
  client: PublishedArsenalClient;
  capability: CapabilityHandle;
  binding: ArsenalIdentityBinding;
  /** Fresh authority over the DID ↔ Arsenal agent/tenant/audience binding. */
  authorizeBinding(binding: ArsenalIdentityBinding): Promise<boolean>;
  /** Application-owned destination allowlist, in addition to broker policy. */
  allowedOrigins: readonly string[];
  maxRequestBytes?: number;
  timeoutMs?: number;
}): typeof fetch {
  didSchema.parse(options.binding.did);
  const binding = Object.freeze({ ...options.binding });
  const origins = new Set(options.allowedOrigins.map(origin => {
    const url = new URL(origin);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname))) || url.origin !== origin) {
      throw new TypeError('Arsenal destinations must be canonical HTTPS origins (HTTP loopback is allowed for local development)');
    }
    return origin;
  }));
  const max = options.maxRequestBytes ?? 1_048_576;
  const timeout = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(max) || max < 0 || !Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 300_000) {
    throw new TypeError('Invalid Arsenal request size or timeout');
  }
  return async (input, init) => {
    const request = new Request(input, init);
    const destination = new URL(request.url);
    if (!origins.has(destination.origin) || destination.username || destination.password) throw new Error('Arsenal destination is not authorized');
    request.signal.throwIfAborted();
    const { client, capability } = options;
    if (binding.agentId !== client.identity.id.toString() || binding.tenantId !== client.identity.tenantId.toString() ||
        capability.token.subject !== binding.agentId || capability.audience !== binding.audience ||
        capability.token.claims.tenant_id !== binding.tenantId || !capability.token.isSigned() ||
        !capability.token.isTimeValid() || !client.identity.isValid() || await options.authorizeBinding(binding) !== true) {
      throw new Error('Arsenal capability identity, tenant, audience or authority mismatch');
    }
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (request.body) {
      const reader = request.body.getReader();
      try {
        while (true) {
          request.signal.throwIfAborted();
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > max) { await reader.cancel(); throw new Error('Arsenal request body exceeds configured limit'); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    request.signal.throwIfAborted();
    if (!client.broker || !client.hasActiveSession()) throw new Error('Arsenal broker and active session are required');
    const response = await client.broker.proxyRequest({ method: request.method, url: request.url,
      headers: Object.fromEntries(request.headers), ...(request.body ? { body: bytes } : {}),
      capability_token: capability.encode(), timeout_ms: timeout },
      { fingerprintHex: client.identity.publicKeyFingerprint.toHex() });
    request.signal.throwIfAborted();
    if (!response.proxy_metadata.destination_verified || !response.proxy_metadata.fingerprint_verified) {
      throw new Error('Arsenal broker did not verify destination and fingerprint');
    }
    return new Response([204, 205, 304].includes(response.status) || request.method === 'HEAD' ? null : new Uint8Array(response.body),
      { status: response.status, headers: response.headers });
  };
}

