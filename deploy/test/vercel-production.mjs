import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { resolve } from 'node:path';
import { encode } from 'cborg';

const require = createRequire(import.meta.url);
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1',
  OPENAGENT_ISSUER: 'urn:openagent:vercel-test:broker', OPENAGENT_AUDIENCE: 'urn:openagent:vercel-test:receiver',
  OPENAGENT_TENANT: 'vercel-test-tenant', OPENAGENT_REQUIRED_SCOPE: 'profile:agent:read',
  OPENAGENT_PUBLIC_KEYS: JSON.stringify([publicKey.export({ format: 'jwk' }).x]),
  OPENAGENT_REVOKED_TOKEN_IDS: '[]', OPENAGENT_REVOKED_SUBJECTS: '[]' };
const did = 'did:oas:example:agent:vercel-production';
function mint(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = encode({ jti: randomUUID(), sub: did, iss: env.OPENAGENT_ISSUER, aud: env.OPENAGENT_AUDIENCE,
    tenant_id: env.OPENAGENT_TENANT, scope: [env.OPENAGENT_REQUIRED_SCOPE], iat: now, nbf: now, exp: now + 60, ...overrides });
  return Buffer.from(encode({ v: 1, alg: 'Ed25519', claims, sig: new Uint8Array(sign(null, claims, privateKey)) })).toString('base64url');
}
const reservation = createServer().listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const origin = 'http://127.0.0.1:' + port;
const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)],
  { cwd: resolve('vercel-edge'), env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', bytes => { output += bytes; });
server.stderr.on('data', bytes => { output += bytes; });
try {
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error('Next server exited: ' + output);
    try { ready = (await fetch(origin + '/health')).ok; } catch { /* startup */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'Next production server failed to become ready: ' + output);
  const send = token => fetch(origin + '/api/agent', { method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'x-openagent-did': 'spoofed' },
    body: '{"message":"built Next app round trip"}' });
  const accepted = await send(mint());
  assert.equal(accepted.status, 200);
  const body = await accepted.json();
  assert.equal(body.did, did);
  assert.equal(body.message, 'built Next app round trip');
  assert.equal(body.tenant, env.OPENAGENT_TENANT);
  assert.equal((await send(mint({ tenant_id: 'another-tenant' }))).status, 401);
  assert.equal((await send(mint({ aud: 'another-audience' }))).status, 401);
  assert.equal((await send('stub:did:oas:example:agent:fake')).status, 401);
  console.log('PASS: built Vercel Node app verified a real ACT and refused tenant/audience/stub violations.');
} finally {
  if (server.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); }
}
