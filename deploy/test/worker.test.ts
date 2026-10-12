import { expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { resolve } from 'node:path';
import { signingFixture } from './fixture.js';

it('runs the released WASM in workerd and handles actual signed HTTP requests', async () => {
  const { env, did, mint } = signingFixture();
  const worker = new Miniflare({ modules: true, scriptPath: resolve('cloudflare-worker/dist/worker.js'),
    modulesRoot: resolve('cloudflare-worker/dist'), compatibilityDate: '2026-07-01',
    modulesRules: [{ type: 'CompiledWasm', include: ['**/*.wasm'], fallthrough: true }],
    bindings: env as Record<string, string> });
  try {
    const send = (token: string) => worker.dispatchFetch('https://receiver.example/api/agent', {
      method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: '{"message":"workerd round trip"}',
    });
    const response = await send(mint());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ did, message: 'workerd round trip' });
    expect((await send(mint({ tenant_id: 'other' }))).status).toBe(401);
    expect((await send(signingFixture().mint())).status).toBe(401);
    expect((await send('stub:did:oas:example:agent:fake')).status).toBe(401);
    const now = Math.floor(Date.now() / 1000);
    expect((await send(mint({ iat: now - 60, nbf: now - 60, exp: now - 1 }))).status).toBe(401);
  } finally { await worker.dispose(); }
}, 30_000);
