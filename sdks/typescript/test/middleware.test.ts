import { describe, it, expect, beforeEach } from 'vitest';
import { withAct } from '../src/middleware.js';
import { setActCryptoBinding, type ActClaims } from '../src/act.js';

const fixtureClaims: ActClaims = {
  jti: 'act-1',
  sub: 'did:oas:l1fe:agent:bot',
  iss: 'arsenal:broker:test-1',
  aud: ['omerta'],
  iat: 1800000000,
  nbf: 1800000000,
  exp: 1800000600,
  tenant_id: 'tenant-a',
  scope: ['tools:calendar:invoke'],
};

let shouldFail: Error | undefined;

function installMock(): void {
  shouldFail = undefined;
  setActCryptoBinding({
    act_verify() {
      if (shouldFail) throw shouldFail;
      return JSON.stringify(fixtureClaims);
    },
  });
}

const config = {
  issuer: 'arsenal:broker:test-1',
  audience: 'omerta',
  trustedKeys: [new Uint8Array(32)],
};

describe('withAct middleware', () => {
  beforeEach(installMock);

  it('passes verified claims to the handler', async () => {
    const handler = withAct(config, async (_req, claims) => {
      return new Response(JSON.stringify({ sub: claims.sub }), { status: 200 });
    });
    const token = Buffer.from('token-bytes').toString('base64url');
    const req = new Request('https://api.example.com/', {
      headers: { authorization: `Bearer ${token}` },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sub: 'did:oas:l1fe:agent:bot' });
  });

  it('rejects a request with no authorization header', async () => {
    let ran = false;
    const handler = withAct(config, () => {
      ran = true;
      return new Response('ok');
    });
    const res = await handler(new Request('https://api.example.com/'));
    expect(res.status).toBe(401);
    expect(ran).toBe(false);
  });

  it('rejects with the canonical reason when verification fails', async () => {
    shouldFail = new Error('token expired at 1800000600');
    const handler = withAct(config, () => new Response('ok'));
    const token = Buffer.from('token-bytes').toString('base64url');
    const req = new Request('https://api.example.com/', {
      headers: { authorization: `Bearer ${token}` },
    });
    const res = await handler(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('expired');
  });

  it('accepts the OpenAgent scheme as well as Bearer', async () => {
    const handler = withAct(config, () => new Response('ok', { status: 200 }));
    const token = Buffer.from('token-bytes').toString('base64url');
    const req = new Request('https://api.example.com/', {
      headers: { authorization: `OpenAgent ${token}` },
    });
    expect((await handler(req)).status).toBe(200);
  });

  it('honors a custom extractToken', async () => {
    const handler = withAct(
      { ...config, extractToken: () => new Uint8Array([9, 9]) },
      () => new Response('ok', { status: 200 }),
    );
    expect((await handler(new Request('https://api.example.com/'))).status).toBe(200);
  });
});
