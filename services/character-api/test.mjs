import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { createCharacterServer } from './server.mjs';
import { generateCharacter, getCharacterSkins } from '../../sdks/typescript/dist/characters.js';
import { glyphEndpoint } from '../../sdks/typescript/dist/glyph.js';

const did = 'did:oas:openagent:agent:preview';
let server;
let origin;
const endpoint = path => `${origin}${path}`;
const didPath = `/v1/characters/${encodeURIComponent(did)}`;
const svgPath = `/v1/characters/svg/${encodeURIComponent(did)}`;
const cors = response => assert.equal(response.headers.get('access-control-allow-origin'), '*');

before(async () => {
  server = createCharacterServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
});

test('serves the first-party demo, controls, assets and versioned API schema over HTTP', async () => {
  const page = await fetch(endpoint('/'));
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  const html = await page.text();
  assert.match(html, /id="preview"/);
  assert.match(html, /value="did:oas:openagent:agent:preview"/);
  for (const id of ['skin', 'shape', 'expression', 'blink', 'gaze-x', 'gaze-y', 'animated']) {
    assert.ok(html.includes(`id="${id}"`));
  }
  assert.ok(!/https?:\/\//.test(html));
  const script = await fetch(endpoint('/demo.js'));
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);
  const javascript = await script.text();
  assert.ok(javascript.includes("fetch('/v1/characters/skins'"));
  assert.ok(javascript.includes('prefers-reduced-motion'));
  assert.ok(javascript.includes('expression.value'));
  assert.ok(!/https?:\/\//.test(javascript));
  assert.equal((await fetch(endpoint('/demo.css'))).status, 200);
  const schema = await fetch(endpoint('/v1/characters/openapi.json'));
  assert.equal(schema.status, 200);
  cors(schema);
  const contract = await schema.json();
  assert.equal(contract.openapi, '3.1.0');
  assert.deepEqual(contract.servers, [{ url: '/v1/characters' }]);
  assert.deepEqual(contract.security, []);
  assert.ok(contract.paths['/skins']);
  assert.ok(contract.paths['/generate'].post);
});

test('completes HTTP catalog, descriptor, SVG and POST generation using the real built SDK', async () => {
  const catalog = await fetch(endpoint('/v1/characters/skins'));
  assert.equal(catalog.status, 200);
  assert.deepEqual(await catalog.json(), getCharacterSkins());
  const options = { skin: 'spacex', shape: 'hexagon', expression: 'curious', size: 128,
    animated: false, state: { blink: 0.25, gaze: { x: 0.5, y: -1 } } };
  const query = '?skin=spacex&shape=hexagon&expression=curious&size=128&animated=false&blink=0.25&gazeX=0.5&gazeY=-1';
  const descriptorResponse = await fetch(endpoint(didPath + query));
  assert.equal(descriptorResponse.status, 200);
  cors(descriptorResponse);
  const descriptor = await descriptorResponse.json();
  assert.deepEqual(descriptor, generateCharacter(did, options));
  const image = await fetch(endpoint(svgPath + query));
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
  assert.equal(image.headers.get('content-security-policy'), "default-src 'none'; img-src 'none'; style-src 'none'; sandbox");
  cors(image);
  assert.equal(await image.text(), descriptor.svg);
  const generated = await fetch(endpoint('/v1/characters/generate'), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ did, ...options }),
  });
  assert.equal(generated.status, 200);
  assert.equal(generated.headers.get('cache-control'), 'no-store');
  assert.equal(generated.headers.get('etag'), null);
  cors(generated);
  assert.deepEqual(await generated.json(), descriptor);
});

test('serves the default Autos character with native live-v1 animation over HTTP', async () => {
  const response = await fetch(endpoint(didPath));
  assert.equal(response.status, 200);
  const character = await response.json();
  assert.deepEqual(character, generateCharacter(did));
  assert.equal(character.skin, 'autos');
  assert.equal(character.expression, 'neutral');
  assert.equal(character.eyeStyle, 'live-v1');
  assert.equal(character.animated, true);
  assert.ok(character.svg.includes('<animate'));
  assert.ok(!/<(?:script|style|image|foreignObject)\b/i.test(character.svg));
});

test('publishes the unchanged SDK Glyph SVG, HEAD, validators and refusal behavior with CORS', async () => {
  const identities = [did,
    'did:oas:openagent:agent:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    'did:l1fe:agent:public-glyph-fixture'];
  for (const identity of identities) {
    const url = endpoint(`/v1/glyph/svg/${encodeURIComponent(identity)}?size=128&background=false`);
    const expected = glyphEndpoint(new Request(url));
    assert.equal(expected.status, 200);
    const response = await fetch(url);
    assert.equal(response.status, expected.status);
    for (const [key, value] of expected.headers) assert.equal(response.headers.get(key), value);
    cors(response);
    assert.equal(await response.text(), await expected.text());
    const head = await fetch(url, { method: 'HEAD' });
    const expectedHead = glyphEndpoint(new Request(url, { method: 'HEAD' }));
    assert.equal(head.status, expectedHead.status);
    for (const [key, value] of expectedHead.headers) assert.equal(head.headers.get(key), value);
    assert.equal(await head.text(), '');
    cors(head);
    const validator = response.headers.get('etag');
    for (const method of ['GET', 'HEAD']) {
      const cached = await fetch(url, { method, headers: { 'if-none-match': validator } });
      const expectedCached = glyphEndpoint(new Request(url, { method, headers: { 'if-none-match': validator } }));
      assert.equal(cached.status, expectedCached.status);
      assert.equal(cached.status, 304);
      for (const [key, value] of expectedCached.headers) assert.equal(cached.headers.get(key), value);
      assert.equal(await cached.text(), '');
      cors(cached);
    }
  }
  for (const [path, method] of [
    ['/v1/glyph/svg/not-a-did', 'GET'],
    [`/v1/glyph/svg/${encodeURIComponent(did)}?size=31`, 'GET'],
    [`/v1/glyph/svg/${encodeURIComponent(did)}?background=invalid`, 'GET'],
    [`/v1/glyph/svg/${encodeURIComponent(did)}`, 'POST'],
  ]) {
    const expected = glyphEndpoint(new Request(endpoint(path), { method }));
    const response = await fetch(endpoint(path), { method });
    assert.equal(response.status, expected.status);
    for (const [key, value] of expected.headers) assert.equal(response.headers.get(key), value);
    assert.equal(await response.text(), await expected.text());
    cors(response);
  }
  const preflight = await fetch(endpoint(`/v1/glyph/svg/${encodeURIComponent(did)}`), { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, HEAD, OPTIONS');
  cors(preflight);
  assert.equal(await preflight.text(), '');
});

test('preserves GET/HEAD bytes, validators, conditional requests and CORS across the HTTP adapter', async () => {
  for (const path of ['/', '/demo.js', '/v1/characters/skins', didPath, svgPath]) {
    const get = await fetch(endpoint(path));
    const bytes = Buffer.from(await get.arrayBuffer());
    const etag = `"${createHash('sha256').update(bytes).digest('hex')}"`;
    assert.equal(get.headers.get('etag'), etag);
    assert.equal(get.headers.get('content-length'), String(bytes.byteLength));
    const head = await fetch(endpoint(path), { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    for (const name of ['etag', 'content-length', 'content-type', 'cache-control', 'content-security-policy']) {
      assert.equal(head.headers.get(name), get.headers.get(name));
    }
    const cached = await fetch(endpoint(path), { headers: { 'if-none-match': `"other", W/${etag}` } });
    assert.equal(cached.status, 304);
    assert.equal(await cached.text(), '');
    assert.equal(cached.headers.get('etag'), etag);
    if (path.startsWith('/v1/')) cors(cached);
    const cachedHead = await fetch(endpoint(path), { method: 'HEAD', headers: { 'if-none-match': '*' } });
    assert.equal(cachedHead.status, 304);
    assert.equal(await cachedHead.text(), '');
  }
});

test('returns usable CORS preflight and invalid query/body/media/method responses over HTTP', async () => {
  const preflight = await fetch(endpoint('/v1/characters/generate'), { method: 'OPTIONS', headers: {
    origin: 'https://client.example.org', 'access-control-request-method': 'POST',
    'access-control-request-headers': 'Content-Type',
  } });
  assert.equal(preflight.status, 204);
  cors(preflight);
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.equal(await preflight.text(), '');
  for (const query of ['?skin=autos&skin=spacex', '?skin=autos&shape=circle', '?expression=unknown', '?gazeX=0']) {
    const response = await fetch(endpoint(didPath + query), { headers: { 'if-none-match': '*' } });
    assert.equal(response.status, 400);
    cors(response);
    assert.deepEqual(await response.json(), { error: 'invalid_request' });
  }
  const invalidBody = await fetch(endpoint('/v1/characters/generate'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ did, avatarOverride: 'https://images.example.org/a.svg' }),
  });
  assert.equal(invalidBody.status, 400);
  cors(invalidBody);
  const wrongType = await fetch(endpoint('/v1/characters/generate'), {
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ did }),
  });
  assert.equal(wrongType.status, 415);
  cors(wrongType);
  const wrongMethod = await fetch(endpoint('/v1/characters/generate'));
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'POST, OPTIONS');
  cors(wrongMethod);
});

test('refuses oversized fixed and chunked uploads with a readable 413 response', async () => {
  const oversized = JSON.stringify({ did }) + ' '.repeat(16_384);
  const fixed = await fetch(endpoint('/v1/characters/generate'), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: oversized,
  });
  assert.equal(fixed.status, 413);
  cors(fixed);
  assert.deepEqual(await fixed.json(), { error: 'body_too_large' });
  const chunked = await new Promise((resolve, reject) => {
    const request = httpRequest(endpoint('/v1/characters/generate'), {
      method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.once('error', reject);
      response.once('end', () => resolve({ status: response.statusCode, headers: response.headers, text }));
    });
    request.once('error', reject);
    request.write(JSON.stringify({ did }));
    request.end(' '.repeat(16_384));
  });
  assert.equal(chunked.status, 413);
  assert.equal(chunked.headers['access-control-allow-origin'], '*');
  assert.deepEqual(JSON.parse(chunked.text), { error: 'body_too_large' });
});

test('ignores inbound proxy and Host headers and exposes health separately from generation', async () => {
  const response = await fetch(endpoint(didPath), { headers: {
    host: 'untrusted.example.org', 'x-forwarded-host': 'untrusted.example.org', 'x-forwarded-proto': 'https',
  } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), generateCharacter(did));
  const health = await fetch(endpoint('/healthz'));
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('cache-control'), 'no-store');
  const metadata = JSON.parse(readFileSync(new URL('../../sdks/typescript/package.json', import.meta.url), 'utf8'));
  assert.deepEqual(await health.json(), { status: 'ok', version: metadata.version });
  const missing = await fetch(endpoint('/not-a-route'));
  assert.equal(missing.status, 404);
  cors(missing);
});
