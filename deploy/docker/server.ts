import '../shared/node-binding.js';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { handleAgentRequest, json, type ReceiverEnvironment } from '../shared/receiver.js';

export function createReceiverServer(env: ReceiverEnvironment = process.env) {
  const server = createServer({ maxHeaderSize: 32_768 }, async (incoming, outgoing) => {
    let response: Response;
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of incoming) {
        bytes += chunk.length;
        if (bytes > 16_384) {
          outgoing.writeHead(413, { 'content-type': 'application/json', 'connection': 'close' });
          outgoing.end('{"error":"body_too_large"}');
          return;
        }
        chunks.push(chunk);
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(',') : value);
      }
      const method = incoming.method ?? 'GET';
      const request = new Request(new URL(incoming.url ?? '/', 'http://receiver.openagent.invalid'), {
        method, headers, ...(!['GET', 'HEAD'].includes(method) ? { body: new Uint8Array(Buffer.concat(chunks)) } : {}),
      });
      response = await handleAgentRequest(request, env);
    } catch { response = json({ error: 'invalid_request' }, 400); }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(await response.text());
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 1_000;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? '3100');
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const server = createReceiverServer().listen(port, process.env.HOST ?? '0.0.0.0', () => {
    console.log('OpenAgent receiver listening on port ' + port);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
}
