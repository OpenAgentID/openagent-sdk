import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { exportJWK, generateKeyPair, jwtVerify, SignJWT, type JWK } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { oidcDoctor, runCli, type CliIO } from '../src/cli.js';
import { IdentityVerifier } from '../src/identity-verification.js';
import { createIdentityVerificationHandler } from '../src/verification-api.js';
import { oasGlyph } from '../src/glyph.js';

const directories: string[] = [];
const servers: Server[] = [];
const glyphDid = 'did:oas:openagent:agent:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
  }
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function directory() {
  // Owned disposable fixtures live in the persistent checkout; production
  // source, build outputs and delivery receipts never depend on these files.
  const path = await mkdtemp(join(process.cwd(), '.oaid-cli-test-'));
  directories.push(path);
  return path;
}

function capture(fetcher?: typeof fetch): { io: CliIO; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [], stderr: string[] = [];
  return { stdout, stderr, io: { stdout: text => stdout.push(text), stderr: text => stderr.push(text), fetch: fetcher } };
}

/** Actual local HTTP requests; only the configured test authority is mapped. */
async function transport(origin: string, handler: (request: Request) => Promise<Response>): Promise<typeof fetch> {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Uint8Array[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string') headers.set(name, value);
      }
      const method = incoming.method ?? 'GET';
      const request = new Request(new URL(incoming.url ?? '/', origin), {
        method, headers, ...(method === 'GET' || method === 'HEAD' ? {} : { body }),
      });
      const response = await handler(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500, { 'content-type': 'application/json' });
      outgoing.end(JSON.stringify({ error: 'test_authority_failure' }));
    }
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP fixture did not bind');
  return async (input, init) => {
    const requestUrl = new URL(input instanceof Request ? input.url : String(input));
    if (requestUrl.origin !== origin) throw new Error('Unexpected authority origin');
    return fetch(`http://127.0.0.1:${address.port}${requestUrl.pathname}${requestUrl.search}`, init);
  };
}

async function provider() {
  const issuer = 'https://issuer.test';
  const pair = await generateKeyPair('RS256', { extractable: true });
  const publicKey = { ...(await exportJWK(pair.publicKey)), kid: randomUUID(), alg: 'RS256', use: 'sig' };
  const privateKey = { ...(await exportJWK(pair.privateKey)), kid: randomUUID(), alg: 'RS256', use: 'sig' };
  const discovery: Record<string, unknown> = {
    issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
    response_types_supported: ['code'], grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'], id_token_signing_alg_values_supported: ['RS256'],
  };
  let keys: JWK[] = [publicKey];
  let status = 200;
  const fetcher = await transport(issuer, async request => {
    const path = new URL(request.url).pathname;
    if (path !== '/.well-known/openid-configuration' && path !== '/jwks') return new Response(null, { status: 404 });
    return new Response(JSON.stringify(path === '/jwks' ? { keys } : discovery), { status, headers: { 'content-type': 'application/json' } });
  });
  return { issuer, discovery, publicKey, privateKey, fetcher, keys: (next: JWK[]) => { keys = next; }, status: (next: number) => { status = next; } };
}

async function identityService() {
  const origin = 'https://identity.test';
  const audience = `${origin}/verify`;
  const now = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(32).toString('base64url');
  const root = `did:oas:openagent:hmr:owner-${randomUUID()}`;
  const leaf = `did:oas:openagent:agent:worker-${randomUUID()}`;
  const rootPair = await generateKeyPair('EdDSA');
  const leafPair = await generateKeyPair('EdDSA');
  const lifeId = await generateKeyPair('EdDSA');
  const jwks = new Map([[root, await exportJWK(rootPair.publicKey)], [leaf, await exportJWK(leafPair.publicKey)]]);
  const ownerToken = await new SignJWT({}).setProtectedHeader({ alg: 'EdDSA' })
    .setIssuer('https://auth.life.one').setSubject(`signed-test-owner-${randomUUID()}`).setAudience(audience)
    .setIssuedAt(now - 10).setExpirationTime(now + 3600).sign(lifeId.privateKey);
  const revoked = new Set<string>();
  const consumed = new Set<string>();
  let challengeIssued = true;
  let ownerActive = true;
  const verifier = new IdentityVerifier({
    now: () => now,
    resolveDid: async did => {
      const publicKeyJwk = jwks.get(did);
      return publicKeyJwk ? { did, verificationMethods: [{ id: `${did}#signing`, publicKeyJwk }] } : null;
    },
    authorizeOwner: async did => {
      if (did !== root || !ownerActive) return null;
      const { payload } = await jwtVerify(ownerToken, lifeId.publicKey, {
        issuer: 'https://auth.life.one', audience, algorithms: ['EdDSA'], currentDate: new Date(now * 1000),
      });
      return { issuer: payload.iss!, subject: payload.sub! };
    },
    checkRevocation: async check => ({ revoked: revoked.has(check.did) || revoked.has(check.credentialId ?? ''), checkedAt: now }),
    replay: { consume: async claim => {
      const id = `${claim.issuer}:${claim.tokenId}`;
      if (!challengeIssued || claim.nonce !== nonce || claim.audience !== audience || consumed.has(id)) return false;
      challengeIssued = false;
      consumed.add(id);
      return true;
    } },
  });
  const delegation = await new SignJWT({}).setProtectedHeader({ alg: 'EdDSA', typ: 'oaid-delegation+jwt', kid: `${root}#signing` })
    .setIssuer(root).setSubject(leaf).setAudience(audience).setJti(randomUUID())
    .setIssuedAt(now - 10).setNotBefore(now - 10).setExpirationTime(now + 300).sign(rootPair.privateKey);
  const token = await new SignJWT({ nonce, kind: 'agent' }).setProtectedHeader({ alg: 'EdDSA', typ: 'oaid-proof+jwt', kid: `${leaf}#signing` })
    .setIssuer(leaf).setSubject(leaf).setAudience(audience).setJti(randomUUID())
    .setIssuedAt(now - 10).setNotBefore(now - 10).setExpirationTime(now + 60).sign(leafPair.privateKey);
  const handler = createIdentityVerificationHandler(verifier, { audience, resolveNonce: async request => {
    // The record exists before the request; its audience and single-use state
    // are authoritative. Merely receiving a nonce header is insufficient.
    if (!challengeIssued || request.headers.get('x-openagent-nonce') !== nonce) throw new Error('Challenge not issued or consumed');
    return nonce;
  } });
  const fetcher = await transport(origin, handler);
  const proofPath = join(await directory(), 'proof.json');
  await writeFile(proofPath, JSON.stringify({ token, delegations: [delegation] }), { flag: 'wx' });
  return { origin, audience, nonce, root, leaf, token, delegation, proofPath, fetcher, revoked,
    deactivateOwner: () => { ownerActive = false; } };
}

describe('OAID CLI', () => {
  it('prints deterministic glyphs and refuses to overwrite existing files', async () => {
    const output = capture();
    expect(await runCli(['glyph', glyphDid, '--size', '256'], output.io)).toBe(0);
    expect(output.stdout.join('')).toBe(oasGlyph(glyphDid, { size: 256 }) + '\n');
    const path = join(await directory(), 'avatar.svg');
    expect(await runCli(['glyph', glyphDid, '--output', path], output.io)).toBe(0);
    const first = await readFile(path, 'utf8');
    expect(first).toBe(oasGlyph(glyphDid) + '\n');
    expect(await runCli(['glyph', glyphDid, '--size', '256', '--output', path], output.io)).toBe(1);
    expect(await readFile(path, 'utf8')).toBe(first);
  });

  it('rejects glyph markup, invalid dimensions and duplicate/unrecognized options', async () => {
    for (const args of [
      ['glyph', '<script/>'], ['glyph', glyphDid, '--size', 'NaN'], ['glyph', glyphDid, '--size', '2049'],
      ['glyph', glyphDid, '--size', '256', '--size', '512'], ['glyph', glyphDid, '--unknown', 'value'],
    ]) {
      const output = capture();
      expect(await runCli(args, output.io)).toBe(1);
      expect(output.stdout).toEqual([]);
      expect(output.stderr.length).toBe(1);
    }
  });

  it('inspects real generated asymmetric JWKS through HTTP without claiming agent acceptance', async () => {
    const p = await provider();
    const output = capture(p.fetcher);
    expect(await runCli(['oidc', 'doctor', '--issuer', p.issuer], output.io)).toBe(0);
    expect(JSON.parse(output.stdout.join(''))).toMatchObject({ issuer: p.issuer, signingKeys: 1, pkce: 'S256',
      agentFederation: 'requires_real_agent_flow_verification' });
  });

  it('refuses mismatched issuers, insecure endpoints and missing S256/code support', async () => {
    for (const change of [
      { issuer: 'https://other.test' }, { jwks_uri: 'http://issuer.test/jwks' },
      { token_endpoint: 'https://user:credential@issuer.test/token' },
      { code_challenge_methods_supported: ['plain'] }, { response_types_supported: ['token'] },
      { grant_types_supported: ['client_credentials'] },
    ]) {
      const p = await provider();
      Object.assign(p.discovery, change);
      await expect(oidcDoctor(p.issuer, p.fetcher)).rejects.toThrow();
    }
  });

  it('refuses unsigned, symmetric and key/metadata algorithm mismatches', async () => {
    for (const algorithms of [['none'], ['HS256'], ['ES256']]) {
      const p = await provider();
      p.discovery.id_token_signing_alg_values_supported = algorithms;
      await expect(oidcDoctor(p.issuer, p.fetcher)).rejects.toThrow();
    }
    const p = await provider();
    p.keys([{ ...p.publicKey, alg: 'HS256' }]);
    await expect(oidcDoctor(p.issuer, p.fetcher)).rejects.toThrow();
    p.discovery.id_token_signing_alg_values_supported = ['EdDSA'];
    p.keys([{ ...p.publicKey, alg: 'EdDSA' }]);
    await expect(oidcDoctor(p.issuer, p.fetcher)).rejects.toThrow();
  });

  it('refuses real private key material, symmetric JWKS, duplicate IDs and unusable key sets', async () => {
    const p = await provider();
    for (const keys of [
      [p.privateKey], [{ ...p.publicKey, p: p.privateKey.p }],
      [{ kty: 'oct', kid: randomUUID(), k: randomBytes(32).toString('base64url') }],
      [p.publicKey, p.publicKey], [{ ...p.publicKey, use: 'enc' }], [{ ...p.publicKey, kid: undefined }], [],
    ]) {
      p.keys(keys);
      await expect(oidcDoctor(p.issuer, p.fetcher)).rejects.toThrow();
    }
    p.status(503);
    await expect(oidcDoctor(p.issuer, p.fetcher)).rejects.toThrow('HTTP 503');
  });

  it('verifies actual signed proof, owner binding and chain over a real HTTP handler, then rejects replay', async () => {
    const f = await identityService();
    const output = capture(f.fetcher);
    const args = ['verify', '--endpoint', f.audience, '--proof', f.proofPath, '--nonce', f.nonce];
    expect(await runCli(args, output.io)).toBe(0);
    expect(JSON.parse(output.stdout.join(''))).toMatchObject({ did: f.leaf, lineage: [f.root, f.leaf],
      owner: { issuer: 'https://auth.life.one' } });
    const second = capture(f.fetcher);
    expect(await runCli(args, second.io)).toBe(1);
    expect(second.stdout).toEqual([]);
    expect(second.stderr.join('')).not.toContain(f.token);
  });

  it.each(['revoked', 'owner', 'forged-signature', 'unissued-challenge'] as const)('refuses %s without printing a success identity or proof bytes', async failure => {
    const f = await identityService();
    if (failure === 'revoked') f.revoked.add(f.root);
    if (failure === 'owner') f.deactivateOwner();
    if (failure === 'forged-signature') {
      const parts = f.token.split('.');
      parts[2] = `${parts[2]![0] === 'A' ? 'B' : 'A'}${parts[2]!.slice(1)}`;
      await writeFile(f.proofPath, JSON.stringify({ token: parts.join('.'), delegations: [f.delegation] }));
    }
    const output = capture(f.fetcher);
    expect(await runCli(['verify', '--endpoint', f.audience, '--proof', f.proofPath, '--nonce',
      failure === 'unissued-challenge' ? randomBytes(32).toString('base64url') : f.nonce], output.io)).toBe(1);
    expect(output.stdout).toEqual([]);
    expect(output.stderr.join('')).not.toContain(f.token);
    expect(output.stderr.join('')).not.toContain(f.delegation);
  });

  it('refuses unsafe verification endpoints and requires every verification option', async () => {
    for (const args of [
      ['verify'], ['verify', '--endpoint', 'http://identity.test/verify', '--proof', 'unused', '--nonce', 'unused'],
      ['verify', '--endpoint', 'https://user:secret@identity.test/verify', '--proof', 'unused', '--nonce', 'unused'],
      ['verify', '--endpoint', 'https://identity.test/verify?key=secret', '--proof', 'unused', '--nonce', 'unused'],
    ]) {
      const output = capture();
      expect(await runCli(args, output.io)).toBe(1);
      expect(output.stdout).toEqual([]);
      expect(output.stderr.join('')).not.toContain('secret');
    }
    const output = capture();
    expect(await runCli(['--help'], output.io)).toBe(0);
    expect(output.stdout.join('')).toContain('oaid verify');
  });
});
