import { describe, it, expect } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { IdentityVerifier } from '@openagentid/sdk';
import { createOpenAgentHandler, createOpenAgentMiddleware } from '../src/middleware.js';
import { createSdkIdentityKeyResolver } from '../src/sdk.js';
import { HttpAuthClient } from '../src/client.js';
import { verifyNodeSignature } from '../src/node.js';
import { makeIdentity } from './crypto-fixture.js';
import type { AuthResult } from '../src/server.js';

function authorities() {
  const identity = makeIdentity();
  let revoked = false;
  const createdAt = Math.floor(Date.now() / 1000) - 1;
  const resolveDid = async (did: string) => did === identity.did ? { did,
    verificationMethods: [{ id: `${did}#signing`, publicKeyJwk: identity.jwk, purposes: ['authentication'] as const }],
  } : null;
  const verifier = new IdentityVerifier({
    resolveDid, authorizeOwner: async () => null,
    authorizeSelfRoot: async (did, { audience }) => did === identity.did ? {
      did, audience, authorizationId: 'explicit-local-registration', revision: '1', issuedAt: createdAt,
      notBefore: createdAt, checkedAt: Math.floor(Date.now() / 1000), expiresAt: Math.floor(Date.now() / 1000) + 300,
    } : null,
    checkRevocation: async () => ({ revoked, checkedAt: Math.floor(Date.now() / 1000) }),
    resolveDelegations: async () => [], replay: { consume: async () => { throw new Error('Lineage resolution must not consume possession proofs'); } },
  });
  return { identity, resolve: createSdkIdentityKeyResolver({ verifier, resolveDid, audience: 'http-tests' }), revoke: () => { revoked = true; } };
}

describe('Fetch and real Express + SDK integration', () => {
  it('handles a real proof in Fetch and keeps well-known descendants protected', async () => {
    const { identity, resolve } = authorities();
    const { handle } = createOpenAgentHandler({ origin: 'https://api.example.com', resolveIdentityKey: resolve, verifySignature: verifyNodeSignature });
    const response = await handle(new Request('https://api.example.com/.well-known/openagent/auth', { method: 'POST' })) as Response;
    const proof = await identity.proof(await response.json());
    const result = await handle(new Request('https://api.example.com/.well-known/openagent/auth/prove', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(proof),
    })) as Response;
    expect(result.status).toBe(200);
    expect((await result.json()).did).toBe(identity.did);
    expect((await handle(new Request('https://api.example.com/.well-known/openagent/private')) as AuthResult).authenticated).toBe(false);
    expect((await handle(new Request('https://api.example.com/.well-known/openagent/auth')) as Response).status).toBe(405);
  });

  it('authenticates over TCP, preserves application JSON/query, attaches trusted DID and rejects revocation', async () => {
    const { identity, resolve, revoke } = authorities();
    const app = express();
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    app.use(express.json());
    app.use(createOpenAgentMiddleware({ origin, resolveIdentityKey: resolve, verifySignature: verifyNodeSignature }));
    app.post('/echo', (req, res) => res.json({ body: req.body, query: req.query,
      did: (req as typeof req & { openAgent: AuthResult }).openAgent.peerDid }));
    try {
      const client = new HttpAuthClient({ config: { did: identity.did }, sign: identity.sign,
        publicKey: async () => identity.publicKeyBase64Url });
      const session = await client.authenticate(origin);
      expect(session.getPeerDid()).toBe(identity.did);
      const result = await session.post('/echo?mode=real', { prompt: 'Keep this JSON body', count: 3 });
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({ body: { prompt: 'Keep this JSON body', count: 3 }, query: { mode: 'real' }, did: identity.did });
      revoke();
      expect((await session.post('/echo', { denied: true })).status).toBe(401);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it('fails with an actionable error when Express JSON parsing is missing', async () => {
    const agent = makeIdentity();
    const app = express();
    app.use(createOpenAgentMiddleware({ origin: 'https://api.example.com', resolveIdentityKey: agent.resolve, verifySignature: verifyNodeSignature }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/.well-known/openagent/auth/prove`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
      });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/express.json/);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
