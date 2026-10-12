import { generateKeyPairSync, randomUUID, createHash, sign } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { encode } from 'cborg';

// Disposable, real broker keys for the local receiver example. These keys
// are not production identities and are never uploaded or printed.
const directory = resolve(process.env.OPENAGENT_EXAMPLE_DIR || '.receiver-example');
const command = process.argv[2];
if (command === 'init') {
  await mkdir(directory, { mode: 0o700 }); // Existing custody is never replaced.
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const x = publicKey.export({ format: 'jwk' }).x;
  const suffix = createHash('sha256').update(Buffer.from(x, 'base64url')).digest('hex').slice(0, 20);
  const config = { issuer: 'urn:openagent:local-broker:' + randomUUID(),
    audience: 'urn:openagent:local-receiver:' + randomUUID(), tenant: 'local-example',
    scope: 'profile:agent:read', did: 'did:oas:example:agent:' + suffix };
  await writeFile(join(directory, 'broker.pem'), privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' });
  await writeFile(join(directory, 'client.json'), JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  const env = { OPENAGENT_ISSUER: config.issuer, OPENAGENT_AUDIENCE: config.audience,
    OPENAGENT_TENANT: config.tenant, OPENAGENT_REQUIRED_SCOPE: config.scope,
    OPENAGENT_PUBLIC_KEYS: JSON.stringify([x]), OPENAGENT_REVOKED_TOKEN_IDS: '[]', OPENAGENT_REVOKED_SUBJECTS: '[]' };
  await writeFile(join(directory, 'receiver.env'), Object.entries(env).map(([k, v]) => k + '=' + v).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  console.log('Created local broker custody and public receiver policy in ' + directory);
  console.log('Run npm run docker:start, then npm run example:request in a second terminal.');
} else if (command === 'request') {
  const url = new URL('/api/agent', process.argv[3] || 'http://127.0.0.1:3100');
  if (url.username || url.password || (url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Use HTTPS or a numeric loopback address.');
  }
  const config = JSON.parse(await readFile(join(directory, 'client.json'), 'utf8'));
  const key = await readFile(join(directory, 'broker.pem'), 'utf8');
  const now = Math.floor(Date.now() / 1000);
  const claims = encode({ jti: randomUUID(), iss: config.issuer, sub: config.did, aud: config.audience,
    tenant_id: config.tenant, scope: [config.scope], iat: now, nbf: now, exp: now + 60 });
  const token = Buffer.from(encode({ v: 1, alg: 'Ed25519', claims,
    sig: new Uint8Array(sign(null, claims, key)) })).toString('base64url');
  const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'Hello from an authenticated OpenAgent capability.' }) });
  if (!response.ok) throw new Error('Receiver refused the capability: HTTP ' + response.status);
  const result = await response.json();
  if (result.did !== config.did || result.tenant !== config.tenant) throw new Error('Receiver returned an unexpected identity.');
  console.log(JSON.stringify(result, null, 2));
} else {
  throw new Error('Usage: node scripts/example.mjs init | request [receiver-origin]');
}
