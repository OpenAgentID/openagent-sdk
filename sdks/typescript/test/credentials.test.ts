import { describe, it, expect, vi } from 'vitest';
import { createCredentialHandle, type ArsenalClient } from '../src/credentials.js';
import { CredentialError } from '../src/errors.js';

function makeArsenal(overrides: Partial<ArsenalClient> = {}): ArsenalClient {
  return {
    async requestCredential({ provider }) {
      return {
        provider,
        proxyUrl: 'https://proxy.invalid/issue?token=abc',
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      };
    },
    async release() {
      // no-op
    },
    ...overrides,
  };
}

describe('createCredentialHandle', () => {
  it('mints a handle with the correct shape', async () => {
    const arsenal = makeArsenal();
    const handle = await createCredentialHandle({
      agentDid: 'did:oas:l1fe:agent:bot',
      provider: 'openai',
      arsenal,
      fetchImpl: globalThis.fetch.bind(globalThis),
      requestTimeoutMs: 5_000,
    });
    expect(handle.provider).toBe('openai');
    expect(handle.agentDid).toBe('did:oas:l1fe:agent:bot');
    expect(typeof handle.fetch).toBe('function');
    expect(typeof handle.refresh).toBe('function');
    expect(typeof handle.release).toBe('function');
  });

  it('rejects invalid provider names', async () => {
    const arsenal = makeArsenal();
    await expect(
      createCredentialHandle({
        agentDid: 'did:oas:l1fe:agent:bot',
        provider: 'Bad Provider!',
        arsenal,
        fetchImpl: globalThis.fetch.bind(globalThis),
        requestTimeoutMs: 5_000,
      }),
    ).rejects.toThrow();
  });

  it('wraps broker failures in CredentialError', async () => {
    const arsenal: ArsenalClient = {
      async requestCredential() {
        throw new Error('broker down');
      },
    };
    await expect(
      createCredentialHandle({
        agentDid: 'did:oas:l1fe:agent:bot',
        provider: 'openai',
        arsenal,
        fetchImpl: globalThis.fetch.bind(globalThis),
        requestTimeoutMs: 5_000,
      }),
    ).rejects.toBeInstanceOf(CredentialError);
  });

  it('fetch() routes through the proxy URL and sets target header', async () => {
    const arsenal = makeArsenal();
    const fakeFetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init).toBeDefined();
      const headers = new Headers(init?.headers);
      expect(headers.get('X-Arsenal-Target')).toBe(
        'https://api.openai.com/v1/chat/completions',
      );
      expect(headers.get('X-Arsenal-Agent')).toBe('openai');
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;

    const handle = await createCredentialHandle({
      agentDid: 'did:oas:l1fe:agent:bot',
      provider: 'openai',
      arsenal,
      fetchImpl: fakeFetch,
      requestTimeoutMs: 5_000,
    });
    const res = await handle.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      body: '{}',
    });
    expect(res.status).toBe(200);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it('release is idempotent and safe to call repeatedly', async () => {
    const releaseSpy = vi.fn(async () => undefined);
    const arsenal = makeArsenal({ release: releaseSpy });
    const handle = await createCredentialHandle({
      agentDid: 'did:oas:l1fe:agent:bot',
      provider: 'openai',
      arsenal,
      fetchImpl: globalThis.fetch.bind(globalThis),
      requestTimeoutMs: 5_000,
    });
    await handle.release();
    await handle.release(); // second call is a no-op
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });

  it('fetch on a released handle throws', async () => {
    const arsenal = makeArsenal();
    const handle = await createCredentialHandle({
      agentDid: 'did:oas:l1fe:agent:bot',
      provider: 'openai',
      arsenal,
      fetchImpl: globalThis.fetch.bind(globalThis),
      requestTimeoutMs: 5_000,
    });
    await handle.release();
    await expect(handle.fetch('https://example.com')).rejects.toBeInstanceOf(CredentialError);
  });

  it('streaming responses are preserved (async iterator)', async () => {
    const arsenal = makeArsenal();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('chunk1'));
        controller.enqueue(encoder.encode('chunk2'));
        controller.close();
      },
    });
    const fakeFetch = vi.fn(async () => new Response(stream)) as unknown as typeof fetch;

    const handle = await createCredentialHandle({
      agentDid: 'did:oas:l1fe:agent:bot',
      provider: 'openai',
      arsenal,
      fetchImpl: fakeFetch,
      requestTimeoutMs: 5_000,
    });
    const res = await handle.fetch('https://api.openai.com/v1/chat/completions');
    expect(res.body).toBeTruthy();
    const reader = res.body!.getReader();
    const chunks: string[] = [];
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value));
    }
    expect(chunks).toEqual(['chunk1', 'chunk2']);
  });
});
