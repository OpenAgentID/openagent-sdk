import { chmod, link, lstat, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { blake3 } from '@noble/hashes/blake3';
import { base58 } from '@scure/base';
import { decodeJwt, exportJWK, generateKeyPair, importJWK, SignJWT } from 'jose';
import { build } from 'tsup';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LocalWorkspaceError, OpenAgentWorkspace,
  type LocalAgentDocument,
} from '../src/local-workspace.js';

const roots: string[] = [];
const execute = promisify(execFile);
const audience = 'urn:openagent:receiver-a';

async function directory(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.oaid-workspace-test-'));
  roots.push(root);
  return root;
}

async function fixture() {
  const root = await directory();
  const path = join(root, 'receiver');
  const workspace = await OpenAgentWorkspace.initialize(path, { audience });
  const agent = await workspace.createAgent('Real local agent');
  return { root, path, workspace, agent };
}

async function stored(path: string) {
  return JSON.parse(await readFile(join(path, 'state.json'), 'utf8'));
}

async function save(path: string, value: unknown): Promise<void> {
  await writeFile(join(path, 'state.json'), JSON.stringify(value) + '\n', { mode: 0o600 });
}

async function exchange(f: Awaited<ReturnType<typeof fixture>>) {
  const challenge = await f.workspace.issueChallenge(f.agent.did);
  const proof = await f.workspace.prove(f.agent.did, challenge);
  return { challenge, proof };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('public local identity workspace with real Ed25519 keys', () => {
  it('creates an exclusively private, git-ignored workspace and a portable key-derived DID', async () => {
    const f = await fixture();
    const doc = await f.workspace.exportIdentity(f.agent.did);
    expect(doc).toEqual({ schemaVersion: 1, did: f.agent.did, name: f.agent.name, publicKeyJwk: f.agent.publicKeyJwk });
    const digest = blake3(Buffer.from(doc.publicKeyJwk.x, 'base64url'));
    expect(doc.did).toBe(`did:oas:openagent:agent:${base58.encode(digest.subarray(0, 26))}`);
    expect(base58.decode(doc.did.split(':').at(-1)!)).toHaveLength(26);
    expect(f.agent.hasPrivateKey).toBe(true);
    expect(await readFile(join(f.path, '.gitignore'), 'utf8')).toBe('*\n');
    if (process.platform !== 'win32') {
      expect((await lstat(f.path)).mode & 0o777).toBe(0o700);
      for (const file of ['state.json', '.gitignore']) expect((await lstat(join(f.path, file))).mode & 0o777).toBe(0o600);
    }
    const state = await stored(f.path);
    const publicOutput = JSON.stringify([doc, f.agent, await f.workspace.listAgents(), await f.workspace.inspect()]);
    expect(state.agents[0].privateKeyJwk.d).toHaveLength(43);
    expect(publicOutput).not.toContain(state.agents[0].privateKeyJwk.d);
    expect(publicOutput).not.toContain('privateKeyJwk');
    expect(await f.workspace.inspect()).toEqual({ audience, namespace: 'openagent', agents: 1, signers: 1, revoked: 0 });
    await expect(OpenAgentWorkspace.initialize(f.path, { audience })).rejects.toBeInstanceOf(LocalWorkspaceError);
    expect((await stored(f.path)).agents[0].did).toBe(f.agent.did);
  });

  it('verifies real possession with explicit receiver-local self-root authority and no manufactured owner', async () => {
    const f = await fixture();
    const { challenge, proof } = await exchange(f);
    expect(decodeJwt(proof.token)).toMatchObject({ iss: f.agent.did, sub: f.agent.did, aud: audience, nonce: challenge.nonce, kind: 'agent' });
    const result = await f.workspace.verify(proof, challenge);
    expect(result).toMatchObject({ did: f.agent.did, owner: null, root: { kind: 'self', did: f.agent.did }, lineage: [f.agent.did] });
    expect(result.expiresAt).toBeLessThanOrEqual(challenge.expiresAt);
    const state = await stored(f.path);
    expect(result.root).toMatchObject({ authorizationId: state.agents[0].authorizationId, revision: state.agents[0].revision });
    expect(state.challenges[0].consumedAt).toBeTypeOf('number');
    expect(state.replays).toHaveLength(1);
  });

  it('retains keys, issued challenges and replay consumption across independent opens', async () => {
    const f = await fixture();
    const challenge = await f.workspace.issueChallenge(f.agent.did);
    const signer = await OpenAgentWorkspace.open(f.path);
    const proof = await signer.prove(f.agent.did, challenge);
    const restarted = await OpenAgentWorkspace.open(f.path);
    await expect(restarted.verify(proof, challenge)).resolves.toMatchObject({ did: f.agent.did, owner: null });
    await expect((await OpenAgentWorkspace.open(f.path)).verify(proof, challenge)).rejects.toMatchObject({ code: 'replayed' });
    expect(await restarted.exportIdentity(f.agent.did)).toEqual(await f.workspace.exportIdentity(f.agent.did));
  });

  it('allows explicit foreign trust without importing a signer, and binds exact recipient/DID', async () => {
    const f = await fixture();
    const receiver = await OpenAgentWorkspace.initialize(join(f.root, 'foreign'), { audience: 'urn:openagent:receiver-b' });
    await expect(receiver.issueChallenge(f.agent.did)).rejects.toMatchObject({ code: 'untrusted_identity' });
    const doc = await f.workspace.exportIdentity(f.agent.did);
    expect((await receiver.trustIdentity(doc)).hasPrivateKey).toBe(false);
    await expect(receiver.prove(f.agent.did, { audience, nonce: 'A'.repeat(43) })).rejects.toMatchObject({ code: 'no_signer' });
    const challenge = await receiver.issueChallenge(f.agent.did);
    const wrongRecipient = await f.workspace.prove(f.agent.did, { ...challenge, audience });
    await expect(receiver.verify(wrongRecipient, challenge)).rejects.toMatchObject({ code: 'invalid_proof' });
    const proof = await f.workspace.prove(f.agent.did, challenge);
    await expect(receiver.verify(proof, challenge)).resolves.toMatchObject({ did: f.agent.did, owner: null });
    const another = await f.workspace.createAgent('Another real signer');
    await receiver.trustIdentity(await f.workspace.exportIdentity(another.did));
    const next = await receiver.issueChallenge(f.agent.did);
    await expect(receiver.verify(await f.workspace.prove(another.did, next), next)).rejects.toMatchObject({ code: 'replayed' });
    await expect(receiver.verify(await f.workspace.prove(f.agent.did, next), next)).resolves.toMatchObject({ did: f.agent.did });
  });

  it('denies altered signed data and unrelated real signing keys without consuming a valid challenge', async () => {
    const f = await fixture();
    const { challenge, proof } = await exchange(f);
    const parts = proof.token.split('.');
    parts[1] = Buffer.from(JSON.stringify({ ...decodeJwt(proof.token), aud: 'urn:tampered' })).toString('base64url');
    await expect(f.workspace.verify({ token: parts.join('.'), delegations: [] }, challenge)).rejects.toMatchObject({ code: 'invalid_proof' });
    const attacker = await generateKeyPair('EdDSA');
    const forged = await new SignJWT(decodeJwt(proof.token)).setProtectedHeader({ alg: 'EdDSA', typ: 'oaid-proof+jwt', kid: `${f.agent.did}#signing` }).sign(attacker.privateKey);
    await expect(f.workspace.verify({ token: forged, delegations: [] }, challenge)).rejects.toMatchObject({ code: 'invalid_proof' });
    await expect(f.workspace.verify(proof, challenge)).resolves.toMatchObject({ did: f.agent.did });
  });

  it('never trusts proof-embedded keys or accepts an unissued nonce', async () => {
    const f = await fixture();
    const { challenge, proof } = await exchange(f);
    const state = await stored(f.path);
    const key = await importJWK(state.agents[0].privateKeyJwk, 'EdDSA');
    const embedded = await new SignJWT(decodeJwt(proof.token)).setProtectedHeader({ alg: 'EdDSA', typ: 'oaid-proof+jwt', kid: `${f.agent.did}#signing`, jwk: { ...f.agent.publicKeyJwk } }).sign(key);
    await expect(f.workspace.verify({ token: embedded, delegations: [] }, challenge)).rejects.toMatchObject({ code: 'invalid_proof' });
    const unissued = { nonce: 'A'.repeat(43), audience };
    await expect(f.workspace.verify(await f.workspace.prove(f.agent.did, unissued), unissued)).rejects.toMatchObject({ code: 'invalid_proof' });
    await expect(f.workspace.verify(proof, challenge)).resolves.toMatchObject({ did: f.agent.did });
  });

  it('atomically gives one verifier the nonce and durable proof ID', async () => {
    const f = await fixture();
    const { challenge, proof } = await exchange(f);
    const other = await OpenAgentWorkspace.open(f.path);
    const outcomes = await Promise.allSettled([f.workspace.verify(proof, challenge), other.verify(proof, challenge)]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const refusal = outcomes.find(result => result.status === 'rejected');
    expect(refusal?.status === 'rejected' && refusal.reason.code).toBe('replayed');
    expect((await stored(f.path)).replays).toHaveLength(1);
  });

  it('serializes two actual Node processes so exactly one verifies the same proof', async () => {
    const f = await fixture();
    const { challenge, proof } = await exchange(f);
    const outDir = join(f.root, 'bundle');
    // Remote test-only build of the actual source, not a replacement verifier.
    // No production dependency or private repository is used by this harness.
    await build({ config: false, entry: { workspace: fileURLToPath(new URL('../src/local-workspace.ts', import.meta.url)) }, outDir,
      format: ['esm'], platform: 'node', target: 'node20', dts: false, splitting: false,
      sourcemap: false, silent: true, external: ['node:*', 'jose', '@noble/hashes/blake3', '@scure/base', 'zod'],
      outExtension: () => ({ js: '.mjs' }) });
    const proofFile = join(f.root, 'proof.json');
    await writeFile(proofFile, JSON.stringify(proof), { mode: 0o600 });
    const script = `import {readFile} from 'node:fs/promises';
const {OpenAgentWorkspace}=await import(process.argv[1]);
try {const workspace=await OpenAgentWorkspace.open(process.argv[2]);
const proof=JSON.parse(await readFile(process.argv[3],'utf8'));
const identity=await workspace.verify(proof,{nonce:process.argv[4]});
process.stdout.write(JSON.stringify({verified:true,did:identity.did}));}
catch(error){process.stdout.write(JSON.stringify({verified:false,code:error.code}));}`;
    const args = ['--input-type=module', '-e', script, pathToFileURL(join(outDir, 'workspace.mjs')).href, f.path, proofFile, challenge.nonce];
    const children = await Promise.all([execute(process.execPath, args, { encoding: 'utf8', timeout: 10_000, maxBuffer: 65_536 }),
      execute(process.execPath, args, { encoding: 'utf8', timeout: 10_000, maxBuffer: 65_536 })]);
    const results = children.map(child => JSON.parse(child.stdout));
    expect(results.filter(result => result.verified)).toEqual([{ verified: true, did: f.agent.did }]);
    expect(results.filter(result => !result.verified)).toEqual([{ verified: false, code: 'replayed' }]);
    expect((await stored(f.path)).replays).toHaveLength(1);
  }, 20_000);

  it('rejects reused JTI under a different fresh nonce and preserves that nonce for an honest proof', async () => {
    const f = await fixture();
    const first = await exchange(f);
    await f.workspace.verify(first.proof, first.challenge);
    const second = await f.workspace.issueChallenge(f.agent.did);
    const state = await stored(f.path);
    const key = await importJWK(state.agents[0].privateKeyJwk, 'EdDSA');
    const time = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ kind: 'agent', nonce: second.nonce })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'oaid-proof+jwt', kid: `${f.agent.did}#signing` })
      .setIssuer(f.agent.did).setSubject(f.agent.did).setAudience(audience).setIssuedAt(time).setNotBefore(time)
      .setExpirationTime(time + 60).setJti(decodeJwt(first.proof.token).jti!).sign(key);
    await expect(f.workspace.verify({ token, delegations: [] }, second)).rejects.toMatchObject({ code: 'replayed' });
    await expect(f.workspace.verify(await f.workspace.prove(f.agent.did, second), second)).resolves.toMatchObject({ did: f.agent.did });
  });

  it('persists local revocation and cannot restore it through repeated public imports', async () => {
    const f = await fixture();
    const doc = await f.workspace.exportIdentity(f.agent.did);
    const { challenge, proof } = await exchange(f);
    await f.workspace.revoke(f.agent.did);
    const reopened = await OpenAgentWorkspace.open(f.path);
    expect((await reopened.trustIdentity(doc)).revoked).toBe(true);
    await expect(reopened.issueChallenge(f.agent.did)).rejects.toMatchObject({ code: 'revoked' });
    await expect(reopened.verify(proof, challenge)).rejects.toMatchObject({ code: 'revoked' });
    expect((await reopened.listAgents())[0]).toMatchObject({ did: f.agent.did, revoked: true, hasPrivateKey: true });
    // Revocation is receiver-local: retained signer may still prove possession
    // to an independent recipient that deliberately trusts the public key.
    const receiver = await OpenAgentWorkspace.initialize(join(f.root, 'independent'), { audience: 'urn:independent' });
    await receiver.trustIdentity(doc);
    const foreignChallenge = await receiver.issueChallenge(f.agent.did);
    await expect(receiver.verify(await reopened.prove(f.agent.did, foreignChallenge), foreignChallenge)).resolves.toMatchObject({ did: f.agent.did });
  });

  it('refreshes current authority checks days later without expiring the durable key pin or changing its revision', async () => {
    const f = await fixture();
    const first = await exchange(f);
    const accepted = await f.workspace.verify(first.proof, first.challenge);
    const future = Date.now() + 3 * 86_400_000;
    vi.spyOn(Date, 'now').mockReturnValue(future);
    const reopened = await OpenAgentWorkspace.open(f.path);
    const challenge = await reopened.issueChallenge(f.agent.did);
    const proof = await reopened.prove(f.agent.did, challenge);
    const later = await reopened.verify(proof, challenge);
    expect(later.root).toEqual(accepted.root);
    expect(later.expiresAt).toBeGreaterThan(Math.floor(future / 1000));
  });

  it('rejects expired proofs/challenges using a real signature and receiver clock', async () => {
    const f = await fixture();
    const { challenge, proof } = await exchange(f);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
    await expect(f.workspace.verify(proof, challenge)).rejects.toMatchObject({ code: 'invalid_proof' });
  });

  it('refuses unknown keys, mismatched public-DID documents, private imports and input excesses', async () => {
    const f = await fixture();
    const other = await f.workspace.createAgent('Other signer');
    const wrong = { ...(await f.workspace.exportIdentity(other.did)), did: f.agent.did };
    await expect(f.workspace.trustIdentity(wrong)).rejects.toBeInstanceOf(LocalWorkspaceError);
    const doc = await f.workspace.exportIdentity(f.agent.did);
    await expect(f.workspace.trustIdentity({ ...doc, publicKeyJwk: { ...doc.publicKeyJwk, d: 'A'.repeat(43) } } as LocalAgentDocument)).rejects.toBeInstanceOf(LocalWorkspaceError);
    await expect(f.workspace.createAgent('')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(f.workspace.createAgent('x'.repeat(129))).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(f.workspace.prove(f.agent.did, { nonce: 'x', audience })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(f.workspace.verify({ token: 'x'.repeat(32769), delegations: [] }, { nonce: 'A'.repeat(43) })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(OpenAgentWorkspace.initialize(join(f.root, 'bad'), { audience: 'x'.repeat(2049) })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(OpenAgentWorkspace.initialize(join(f.root, 'bad'), { audience, namespace: '../outside' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('does not reset corrupt/missing state or expose parser/private-key excerpts', async () => {
    const f = await fixture();
    const marker = 'private-key-material-that-must-never-appear-in-errors';
    await writeFile(join(f.path, 'state.json'), `{"secret":"${marker}`, { mode: 0o600 });
    const failure = await OpenAgentWorkspace.open(f.path).catch(error => error);
    expect(failure).toMatchObject({ code: 'invalid_state' });
    expect(String(failure)).not.toContain(marker);
    expect(await readFile(join(f.path, 'state.json'), 'utf8')).toContain(marker);
    await unlink(join(f.path, 'state.json'));
    await expect(OpenAgentWorkspace.open(f.path)).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(readFile(join(f.path, 'state.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects private/public signer corruption and revision/collection exhaustion', async () => {
    const f = await fixture();
    const original = await stored(f.path);
    const attacker = await generateKeyPair('EdDSA', { extractable: true });
    const corrupt = structuredClone(original);
    corrupt.agents[0].privateKeyJwk.d = (await exportJWK(attacker.privateKey)).d;
    await save(f.path, corrupt);
    await expect(OpenAgentWorkspace.open(f.path)).rejects.toMatchObject({ code: 'invalid_state' });
    await save(f.path, { ...original, generation: Number.MAX_SAFE_INTEGER });
    const reopened = await OpenAgentWorkspace.open(f.path);
    await expect(reopened.issueChallenge(f.agent.did)).rejects.toMatchObject({ code: 'capacity' });
    expect((await stored(f.path)).challenges).toHaveLength(0);
    await save(f.path, { ...original, agents: Array.from({ length: 257 }, () => original.agents[0]) });
    await expect(OpenAgentWorkspace.open(f.path)).rejects.toMatchObject({ code: 'invalid_state' });
    await writeFile(join(f.path, 'state.json'), 'x'.repeat(4 * 1024 * 1024 + 1), { mode: 0o600 });
    await expect(OpenAgentWorkspace.open(f.path)).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('refuses abandoned locks and interrupted-write files without stealing or deleting them', async () => {
    const f = await fixture();
    const lock = JSON.stringify({ pid: 99999999, token: randomUUID() });
    await writeFile(join(f.path, '.lock'), lock, { mode: 0o600 });
    await expect(OpenAgentWorkspace.open(f.path)).rejects.toMatchObject({ code: 'locked' });
    expect(await readFile(join(f.path, '.lock'), 'utf8')).toBe(lock);
    await unlink(join(f.path, '.lock')); // Explicit fixture/operator intervention.
    const unfinished = join(f.path, '.state-write-' + randomUUID());
    await writeFile(unfinished, 'unfinished fixture', { mode: 0o600 });
    await expect(OpenAgentWorkspace.open(f.path)).rejects.toMatchObject({ code: 'unavailable' });
    expect(await readFile(unfinished, 'utf8')).toBe('unfinished fixture');
  });

  it.skipIf(process.platform === 'win32')('rejects unsafe permissions, symlinked paths/files and hardlinked private state', async () => {
    const f = await fixture();
    await chmod(join(f.path, 'state.json'), 0o644);
    await expect(OpenAgentWorkspace.open(f.path)).rejects.toMatchObject({ code: 'unavailable' });
    await chmod(join(f.path, 'state.json'), 0o600);
    await chmod(f.path, 0o755);
    await expect(OpenAgentWorkspace.open(f.path)).rejects.toMatchObject({ code: 'unavailable' });
    await chmod(f.path, 0o700);
    const alias = join(f.root, 'alias');
    await symlink(f.path, alias, 'dir');
    await expect(OpenAgentWorkspace.open(alias)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(OpenAgentWorkspace.initialize(join(alias, 'child'), { audience })).rejects.toMatchObject({ code: 'unavailable' });
    const duplicate = join(f.root, 'hardlink');
    await link(join(f.path, 'state.json'), duplicate);
    await expect(OpenAgentWorkspace.open(f.path)).rejects.toMatchObject({ code: 'unavailable' });
    await unlink(duplicate);
    const original = await readFile(join(f.path, 'state.json'));
    const target = join(f.root, 'outside-state');
    await writeFile(target, original, { mode: 0o600 });
    await unlink(join(f.path, 'state.json'));
    await symlink(target, join(f.path, 'state.json'));
    await expect(OpenAgentWorkspace.open(f.path)).rejects.toMatchObject({ code: 'invalid_state' });
    expect(await readFile(target)).toEqual(original);
  });
});
