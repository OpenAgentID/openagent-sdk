import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import { createReceiverServer } from '../docker/server.js';

const exec = promisify(execFile);
it('runs the documented setup and client with separate real broker custody and receiver trust', async () => {
  const parent = resolve('.receiver-example');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = join(parent, 'test-' + randomUUID());
  const env = { ...process.env, OPENAGENT_EXAMPLE_DIR: directory };
  const script = resolve('scripts/example.mjs');
  const setup = await exec(process.execPath, [script, 'init'], { env });
  expect(setup.stdout).toContain('Created local broker custody');
  expect((await stat(join(directory, 'broker.pem'))).mode & 0o777).toBe(0o600);
  const before = await readFile(join(directory, 'broker.pem'), 'utf8');
  await expect(exec(process.execPath, [script, 'init'], { env })).rejects.toThrow();
  expect(await readFile(join(directory, 'broker.pem'), 'utf8')).toBe(before);
  const policy = Object.fromEntries((await readFile(join(directory, 'receiver.env'), 'utf8')).trim().split('\n').map(line => {
    const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)];
  }));
  const config = JSON.parse(await readFile(join(directory, 'client.json'), 'utf8'));
  const server = createReceiverServer(policy).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing receiver port');
  try {
    const reply = await exec(process.execPath, [script, 'request', `http://127.0.0.1:${address.port}`], { env });
    expect(JSON.parse(reply.stdout)).toMatchObject({ did: config.did, tenant: config.tenant,
      message: 'Hello from an authenticated OpenAgent capability.' });
    await expect(exec(process.execPath, [script, 'request', 'http://example.com'], { env })).rejects.toThrow();
  } finally { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); }
}, 15_000);
