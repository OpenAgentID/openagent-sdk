import { createServer, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { createCredentialHandle } from '../src/credentials.js';

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});

async function receiver() {
  const requests: Array<{ method?: string; headers: IncomingMessage['headers']; body: string }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const received = { method: request.method, headers: request.headers, body: Buffer.concat(chunks).toString() };
    requests.push(received);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(received));
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  const proxyUrl = `http://127.0.0.1:${address.port}/credential`;
  const handle = await createCredentialHandle({
    agentDid: 'did:oas:agent:request-compatibility', provider: 'example',
    arsenal: { async requestCredential({ provider }) {
      return { provider, proxyUrl, expiresAt: Math.floor(Date.now() / 1000) + 60 };
    } },
    fetchImpl: fetch, requestTimeoutMs: 5_000,
  });
  return { handle, requests };
}

describe('credential fetch with native Request and real TCP transport', () => {
  it('preserves Request method, headers and body through the proxy', async () => {
    const { handle, requests } = await receiver();
    const input = new Request('https://service.example/v1/jobs?limit=2', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-trace-id': 'preserved' },
      body: JSON.stringify({ task: 'read documentation' }),
    });
    const response = await handle.fetch(input);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ method: 'POST', body: '{"task":"read documentation"}',
      headers: { 'x-trace-id': 'preserved', 'content-type': 'application/json',
        'x-arsenal-target': 'https://service.example/v1/jobs?limit=2', 'x-arsenal-agent': 'example' } });
    expect(requests).toHaveLength(1);
  });

  it('honors init overrides when input is a Request', async () => {
    const { handle } = await receiver();
    const input = new Request('https://service.example/v1/jobs', {
      method: 'POST', headers: { 'x-old': 'discard' }, body: 'original',
    });
    const response = await handle.fetch(input, {
      method: 'PUT', headers: { 'x-new': 'kept' }, body: 'replacement',
    });
    const result = await response.json() as { method: string; body: string; headers: Record<string, string> };
    expect(result.method).toBe('PUT');
    expect(result.body).toBe('replacement');
    expect(result.headers['x-new']).toBe('kept');
    expect(result.headers['x-old']).toBeUndefined();
  });

  it('propagates an already cancelled Request without sending it', async () => {
    const { handle, requests } = await receiver();
    const controller = new AbortController();
    controller.abort(new Error('Caller cancelled'));
    await expect(handle.fetch(new Request('https://service.example/v1/jobs', {
      method: 'POST', body: 'never delivered', signal: controller.signal,
    }))).rejects.toThrow('Arsenal proxy request failed');
    expect(requests).toHaveLength(0);
  });

  it('keeps caller cancellation connected while a streaming response is read', async () => {
    let closed!: () => void;
    const connectionClosed = new Promise<void>(resolve => { closed = resolve; });
    const server = createServer((_request, response) => {
      response.on('close', closed);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: first\n\n');
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
    const handle = await createCredentialHandle({
      agentDid: 'did:oas:agent:stream-compatibility', provider: 'example',
      arsenal: { async requestCredential({ provider }) {
        return { provider, proxyUrl: `http://127.0.0.1:${address.port}/stream`,
          expiresAt: Math.floor(Date.now() / 1000) + 60 };
      } }, fetchImpl: fetch, requestTimeoutMs: 5_000,
    });
    const controller = new AbortController();
    const response = await handle.fetch(new Request('https://service.example/events', { signal: controller.signal }));
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('data: first');
    controller.abort();
    await expect(reader.read()).rejects.toThrow();
    await connectionClosed;
  });
});
