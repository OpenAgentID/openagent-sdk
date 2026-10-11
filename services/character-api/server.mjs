import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCharacterApiHandler } from '../../sdks/typescript/dist/character-api.js';
import { glyphEndpoint } from '../../sdks/typescript/dist/glyph.js';

const version = JSON.parse(readFileSync(new URL('../../sdks/typescript/package.json', import.meta.url), 'utf8')).version;
const api = createCharacterApiHandler();
const assetHeaders = {
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};
const assets = new Map([
  ['/', ['demo.html', 'text/html; charset=utf-8']],
  ['/demo.js', ['demo.js', 'text/javascript; charset=utf-8']],
  ['/demo.css', ['demo.css', 'text/css; charset=utf-8']],
].map(([path, [file, contentType]]) => {
  const body = readFileSync(new URL(file, import.meta.url));
  return [path, { body, contentType, etag: `"${createHash('sha256').update(body).digest('hex')}"` }];
}));

function failure(status, error) {
  return Response.json({ error }, { status, headers: {
    'cache-control': 'no-store', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff',
  } });
}

function publicGlyphResponse(request) {
  let response;
  if (request.method === 'OPTIONS') {
    const validated = glyphEndpoint(new Request(request.url));
    response = validated.status === 200
      ? new Response(null, { status: 204, headers: { 'cache-control': 'no-store', 'access-control-max-age': '86400' } })
      : validated;
  } else response = glyphEndpoint(request);
  response.headers.set('access-control-allow-origin', '*');
  response.headers.set('access-control-allow-methods', 'GET, HEAD, OPTIONS');
  response.headers.set('access-control-allow-headers', 'If-None-Match');
  response.headers.set('access-control-expose-headers', 'ETag, Content-Length');
  return response;
}

function staticResponse(request, asset) {
  const headers = { ...assetHeaders, 'content-type': asset.contentType,
    'cache-control': 'public, max-age=300, must-revalidate', etag: asset.etag };
  const validators = request.headers.get('if-none-match');
  if (validators && validators.length <= 4096 && validators.split(',').some(value =>
    [asset.etag, `W/${asset.etag}`, '*'].includes(value.trim()))) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === 'HEAD' ? null : asset.body,
    { headers: { ...headers, 'content-length': String(asset.body.byteLength) } });
}

/** Stream without destroying the response socket when the handler refuses a body. */
function requestBody(incoming) {
  let controller;
  let cancelled = false;
  const detach = () => {
    incoming.removeListener('data', onData);
    incoming.removeListener('end', onEnd);
    incoming.removeListener('error', onError);
    incoming.removeListener('aborted', onAborted);
  };
  const onData = chunk => {
    incoming.pause();
    controller.enqueue(chunk);
  };
  const onEnd = () => {
    detach();
    controller.close();
  };
  const onError = error => {
    detach();
    controller.error(error);
  };
  const onAborted = () => onError(new Error('Request body was interrupted'));
  const stream = new ReadableStream({
    start(value) {
      controller = value;
      incoming.pause();
      incoming.on('data', onData);
      incoming.once('end', onEnd);
      incoming.once('error', onError);
      incoming.once('aborted', onAborted);
    },
    pull() { incoming.resume(); },
    cancel() {
      cancelled = true;
      incoming.pause();
      detach();
    },
  }, { highWaterMark: 0 });
  return { stream, get cancelled() { return cancelled; } };
}

async function respond(outgoing, response, method) {
  outgoing.statusCode = response.status;
  for (const [key, value] of response.headers) outgoing.setHeader(key, value);
  if (method === 'HEAD' || response.body === null) outgoing.end();
  else outgoing.end(Buffer.from(await response.arrayBuffer()));
}

/** Stateless first-party demo and public character generation; no proxy or resolver. */
export function createCharacterServer() {
  const server = createServer({ maxHeaderSize: 8192 }, async (incoming, outgoing) => {
    let body;
    incoming.on('error', () => outgoing.destroy());
    try {
      // Ignore Host and forwarding headers. Only an origin-form request target is accepted.
      if (typeof incoming.url !== 'string' || incoming.url.length > 8192 ||
          !incoming.url.startsWith('/') || incoming.url.startsWith('//')) {
        outgoing.setHeader('connection', 'close');
        await respond(outgoing, failure(400, 'invalid_request'), incoming.method);
        return;
      }
      const headers = new Headers();
      for (const key of ['content-type', 'content-length', 'content-encoding', 'if-none-match',
        'origin', 'access-control-request-method', 'access-control-request-headers']) {
        const value = incoming.headers[key];
        if (typeof value === 'string') headers.set(key, value);
      }
      const method = incoming.method ?? 'GET';
      const hasBody = incoming.headers['transfer-encoding'] !== undefined ||
        Number(incoming.headers['content-length'] ?? 0) > 0;
      if ((method === 'GET' || method === 'HEAD') && hasBody) {
        outgoing.setHeader('connection', 'close');
        await respond(outgoing, failure(400, 'invalid_request'), method);
        return;
      }
      if (hasBody) body = requestBody(incoming);
      const request = new Request(`http://characters.internal${incoming.url}`, {
        method, headers, ...(body ? { body: body.stream, duplex: 'half' } : {}),
      });
      const url = new URL(request.url);
      let response;
      const asset = assets.get(url.pathname);
      if (asset && !url.search) {
        response = method === 'GET' || method === 'HEAD' ? staticResponse(request, asset)
          : new Response(null, { status: 405, headers: { ...assetHeaders, allow: 'GET, HEAD' } });
      } else if (url.pathname === '/healthz' && !url.search) {
        response = method === 'GET' || method === 'HEAD'
          ? Response.json({ status: 'ok', version }, { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
          : new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
      } else if (url.pathname.startsWith('/v1/glyph/svg/')) response = publicGlyphResponse(request);
      else response = await api(request);
      // Unread/refused uploads close only after their error response is written.
      // Do not drain an attacker-controlled upload beyond the handler's byte limit.
      if (body && !body.stream.locked) await body.stream.cancel().catch(() => undefined);
      if (body?.cancelled) outgoing.setHeader('connection', 'close');
      await respond(outgoing, response, method);
    } catch {
      if (body && !body.stream.locked) await body.stream.cancel().catch(() => undefined);
      if (!outgoing.headersSent && !outgoing.destroyed) {
        outgoing.setHeader('connection', 'close');
        await respond(outgoing, failure(400, 'invalid_request'), incoming.method).catch(() => outgoing.destroy());
      } else outgoing.destroy();
    }
  });
  server.maxHeadersCount = 32;
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5000;
  server.setTimeout(15_000, socket => socket.destroy());
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configured = process.env.PORT ?? '8080';
  if (!/^\d{1,5}$/.test(configured) || Number(configured) > 65535) throw new TypeError('PORT must be from 0 to 65535');
  const server = createCharacterServer();
  server.listen(Number(configured), '0.0.0.0', () => {
    console.info(`OpenAgentID character API ${version} listening on port ${server.address().port}`);
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 10_000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
