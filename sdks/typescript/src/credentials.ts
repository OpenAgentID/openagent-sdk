/**
 * Arsenal credentials wrapper.
 *
 * Wraps an application's credential-proxy facade with a developer-friendly surface
 * centered on a single method: {@link CredentialHandle.fetch}. The returned
 * `fetch` is a drop-in replacement for the global `fetch` that transparently
 * injects the right Authorization / API-Key / OAuth bearer header for the
 * target provider.
 *
 * Usage:
 * ```ts
 * const creds = await agent.credentialsFor('openai');
 * const res = await creds.fetch('https://api.openai.com/v1/chat/completions', {
 *   method: 'POST',
 *   body: JSON.stringify({ model: 'gpt-4', messages }),
 * });
 * ```
 *
 * Streaming (Server-Sent Events, JSONL, chunk-at-a-time): the injected
 * `fetch` returns a standard `Response`, so consumers can use
 * `for await (const chunk of res.body)` — first-class async iterator support
 * is preserved.
 */

import { providerSchema } from './config.js';
import { CredentialError, ErrorCode, wrapError } from './errors.js';
import type { Did } from './identity.js';

/** A short-lived credential minted by the Arsenal broker. */
export interface IssuedCredential {
  /** Provider identifier this credential targets. */
  provider: string;
  /**
   * Credential material location. Arsenal's broker returns pre-signed proxy
   * URLs rather than raw secrets; raw tokens never leave the broker.
   */
  proxyUrl: string;
  /** Unix timestamp after which the credential is invalid. */
  expiresAt: number;
  /** Optional ceiling on how many requests this credential can issue. */
  remainingCalls?: number;
  /** Arbitrary metadata (tenant, project, region). */
  metadata?: Record<string, unknown>;
}

/**
 * Application-defined credential-proxy facade, injected by the application.
 * The published `@openagentid/arsenal-sdk` uses capabilities instead; connect it
 * with `createArsenalCapabilityFetch` from `@openagentid/sdk/integrations/arsenal`.
 * See `INTEGRATION_NOTES.md` for the two explicit protocols.
 */
export interface ArsenalClient {
  /** Request a scoped credential for `provider` on behalf of `agentDid`. */
  requestCredential(params: {
    agentDid: Did;
    provider: string;
    scopes?: readonly string[];
  }): Promise<IssuedCredential>;

  /** Optionally release / revoke a previously issued credential. */
  release?(credentialProxyUrl: string): Promise<void>;
}

/**
 * A live, fetch-ready credential bound to an agent DID + provider.
 *
 * The fetch method is a drop-in replacement for `globalThis.fetch`. The
 * underlying credential is refreshed lazily when the caller invokes
 * `refresh()` — auto-rotation stays out of the per-request hot path.
 */
export interface CredentialHandle {
  readonly provider: string;
  readonly agentDid: Did;
  readonly expiresAt: number;

  /**
   * Drop-in replacement for the global `fetch`. The `X-Arsenal-Target`
   * header is set to the original URL and the request is routed through
   * the Arsenal credential proxy.
   *
   * Streaming responses (SSE, chunked JSON, transfer-encoding: chunked)
   * are fully supported because the return value is a standard `Response`.
   */
  fetch: typeof fetch;

  /** Mint a fresh credential and return a new handle. */
  refresh(): Promise<CredentialHandle>;

  /** Release the credential (best-effort; safe to call multiple times). */
  release(): Promise<void>;
}

/** Arguments for constructing a credential handle. */
export interface CreateCredentialHandleParams {
  agentDid: Did;
  provider: string;
  arsenal: ArsenalClient;
  fetchImpl: typeof fetch;
  requestTimeoutMs: number;
  scopes?: readonly string[];
}

/** Create a {@link CredentialHandle} backed by an Arsenal client. */
export async function createCredentialHandle(
  params: CreateCredentialHandleParams,
): Promise<CredentialHandle> {
  const provider = providerSchema.parse(params.provider);
  const normalized: CreateCredentialHandleParams = { ...params, provider };
  return mintHandle(normalized);
}

async function mintHandle(params: CreateCredentialHandleParams): Promise<CredentialHandle> {
  let issued: IssuedCredential;
  try {
    issued = await params.arsenal.requestCredential({
      agentDid: params.agentDid,
      provider: params.provider,
      ...(params.scopes !== undefined ? { scopes: params.scopes } : {}),
    });
  } catch (err) {
    throw new CredentialError(
      `Failed to mint credential for provider "${params.provider}"`,
      {
        code: ErrorCode.CREDENTIAL_FETCH_FAILED,
        cause: err,
        context: { agentDid: params.agentDid, provider: params.provider },
      },
    );
  }

  let released = false;

  const handle: CredentialHandle = {
    provider: params.provider,
    agentDid: params.agentDid,
    expiresAt: issued.expiresAt,
    fetch: (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if (released) {
        throw new CredentialError('Credential handle has been released', {
          code: ErrorCode.CREDENTIAL_EXPIRED,
          context: { provider: params.provider, agentDid: params.agentDid },
        });
      }
      return arsenalProxiedFetch({
        input,
        init,
        credential: issued,
        fetchImpl: params.fetchImpl,
        requestTimeoutMs: params.requestTimeoutMs,
      });
    }) as typeof fetch,
    refresh: () => mintHandle(params),
    release: async () => {
      if (released) return;
      released = true;
      try {
        await params.arsenal.release?.(issued.proxyUrl);
      } catch (err) {
        // Release is best-effort — wrap but do not re-throw.
        throw wrapError(err, 'Failed to release credential');
      }
    },
  };

  return handle;
}

interface ArsenalProxiedFetchParams {
  input: Parameters<typeof fetch>[0];
  init: Parameters<typeof fetch>[1];
  credential: IssuedCredential;
  fetchImpl: typeof fetch;
  requestTimeoutMs: number;
}

/**
 * Execute a fetch via the Arsenal proxy.
 *
 * The Arsenal proxy expects:
 *  - `X-Arsenal-Target` header: the absolute target URL
 *  - `X-Arsenal-Agent` header: the provider/tenant identifier
 *  - The original method, headers, and body
 *  - An agent-scoped bearer that the broker returns inside `proxyUrl`'s
 *    query string (kept opaque to this client).
 */
async function arsenalProxiedFetch(params: ArsenalProxiedFetchParams): Promise<Response> {
  // Normalize exactly as fetch does, including Request input and init overrides.
  // A streaming Request body stays a stream; nothing is buffered or re-encoded.
  const original = new Request(params.input, params.init);
  const targetUrl = original.url;
  const headers = new Headers(original.headers);
  headers.set('X-Arsenal-Target', targetUrl);
  headers.set('X-Arsenal-Agent', params.credential.provider);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.requestTimeoutMs);
  // Native signal composition preserves caller cancellation after headers,
  // including while the caller consumes an SSE/chunked response body.
  const signal = AbortSignal.any([original.signal, controller.signal]);

  try {
    const proxied = new Request(params.credential.proxyUrl, original);
    const response = await params.fetchImpl(proxied, { headers, signal });
    return response;
  } catch (err) {
    throw new CredentialError('Arsenal proxy request failed', {
      code: ErrorCode.NETWORK_ERROR,
      cause: err,
      context: { provider: params.credential.provider, targetUrl },
    });
  } finally {
    clearTimeout(timeout);
  }
}
