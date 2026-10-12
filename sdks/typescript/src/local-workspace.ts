/**
 * Node-only, single-host identity custody and receiver-controlled trust.
 * No registry, remote owner, Life account or private SDK is consulted.
 * Filesystem custody is the authority: keep the workspace private and backed up.
 */
import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, unlink, type FileHandle } from 'node:fs/promises';
import { createPrivateKey, createPublicKey, randomBytes, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { TextDecoder } from 'node:util';
import { exportJWK, generateKeyPair, importJWK, SignJWT, type JWK } from 'jose';
import { blake3 } from '@noble/hashes/blake3';
import { base58 } from '@scure/base';
import {
  IdentityVerificationError, IdentityVerifier,
  type AgentIdentityProof, type VerifiedAgentIdentity,
} from './identity-verification.js';

/** Public Ed25519 material. Private JWK parameters are never exported. */
export interface LocalPublicKeyJwk {
  readonly kty: 'OKP';
  readonly crv: 'Ed25519';
  readonly x: string;
}

/** Local receiver registration metadata; this is not a global owner record. */
export interface LocalAgent {
  readonly did: string;
  readonly name: string;
  readonly publicKeyJwk: LocalPublicKeyJwk;
  /** Registration time at this receiver, Unix seconds. */
  readonly createdAt: number;
  readonly revoked: boolean;
  readonly hasPrivateKey: boolean;
}

/** Portable public identity document. Importing it requires explicit trust. */
export interface LocalAgentDocument {
  readonly schemaVersion: 1;
  readonly did: string;
  readonly name: string;
  readonly publicKeyJwk: LocalPublicKeyJwk;
}

/** Existing, receiver-issued challenge. All times are Unix seconds. */
export interface LocalChallenge {
  readonly nonce: string;
  readonly audience: string;
  readonly expiresAt: number;
}

export type LocalWorkspaceFailure =
  | 'invalid_input' | 'invalid_state' | 'unavailable' | 'locked'
  | 'untrusted_identity' | 'no_signer' | 'revoked' | 'capacity';

/** Workspace failures never include private material or state-file contents. */
export class LocalWorkspaceError extends Error {
  override readonly name = 'LocalWorkspaceError';
  constructor(readonly code: LocalWorkspaceFailure, message: string) { super(message); }
}

type PrivateJwk = LocalPublicKeyJwk & { readonly d: string };
interface AgentRecord {
  did: string; name: string; publicKeyJwk: LocalPublicKeyJwk;
  createdAt: number; revoked: boolean; authorizationId: string; revision: string;
  privateKeyJwk?: PrivateJwk;
}
interface ChallengeRecord {
  nonce: string; did: string; audience: string; issuedAt: number; expiresAt: number;
  consumedAt?: number;
}
interface ReplayRecord {
  issuer: string; tokenId: string; audience: string; expiresAt: number; consumedAt: number;
}
interface State {
  schemaVersion: 1; workspaceId: string; audience: string; namespace: string;
  createdAt: number; updatedAt: number; generation: number;
  agents: AgentRecord[]; challenges: ChallengeRecord[]; replays: ReplayRecord[];
}
interface Lock { handle: FileHandle; stat: Stats; content: string }

const STATE_FILE = 'state.json';
const LOCK_FILE = '.lock';
const WRITE_PREFIX = '.state-write-';
const MAX_STATE_BYTES = 4 * 1024 * 1024;
const MAX_AGENTS = 256;
const MAX_CHALLENGES = 1024;
const MAX_REPLAYS = 4096;
const CHALLENGE_SECONDS = 60;
const PROOF_SECONDS = 60;
const AUTHORITY_SECONDS = 120;
const LOCK_WAIT_MS = 2000;
const POSIX = process.platform !== 'win32';
const NOFOLLOW = POSIX ? constants.O_NOFOLLOW : 0;
const DIRECTORY = POSIX ? constants.O_DIRECTORY : 0;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NAMESPACE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DID = /^did:oas:([a-z0-9][a-z0-9-]{0,63}):agent:([1-9A-HJ-NP-Za-km-z]+)$/;
const NONCE = /^[A-Za-z0-9_-]{43}$/;

function fail(code: LocalWorkspaceFailure, message: string): never {
  throw new LocalWorkspaceError(code, message);
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}

function now(): number {
  const value = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(value) || value < 0) fail('unavailable', 'Workspace clock is unavailable');
  return value;
}

function record(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key))) fail('invalid_state', 'Invalid workspace record');
}

function text(value: unknown, max: number): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || value.trim() !== value ||
      /[\u0000-\u001f\u007f]/u.test(value)) fail('invalid_input', 'Expected a bounded nonempty string');
}

function timestamp(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail('invalid_state', 'Invalid workspace timestamp');
}

function publicKey(value: unknown): LocalPublicKeyJwk {
  record(value, ['kty', 'crv', 'x']);
  if (value.kty !== 'OKP' || value.crv !== 'Ed25519' || typeof value.x !== 'string' || !NONCE.test(value.x) ||
      Buffer.from(value.x, 'base64url').length !== 32 || Buffer.from(value.x, 'base64url').toString('base64url') !== value.x) {
    fail('invalid_input', 'Expected a public Ed25519 JWK without private parameters');
  }
  // Node's public-key decoder also rejects unsupported/corrupt key structures.
  try { createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: value.x }, format: 'jwk' }); }
  catch { fail('invalid_input', 'Invalid Ed25519 public key'); }
  return { kty: 'OKP', crv: 'Ed25519', x: value.x };
}

function identityDid(namespace: string, key: LocalPublicKeyJwk): string {
  return `did:oas:${namespace}:agent:${base58.encode(blake3(Buffer.from(key.x, 'base64url')).subarray(0, 26))}`;
}

function validateDocument(value: unknown): LocalAgentDocument {
  record(value, ['schemaVersion', 'did', 'name', 'publicKeyJwk']);
  if (value.schemaVersion !== 1) fail('invalid_input', 'Unsupported local identity document');
  text(value.did, 512); text(value.name, 128);
  const match = DID.exec(value.did);
  const key = publicKey(value.publicKeyJwk);
  if (!match || identityDid(match[1]!, key) !== value.did) fail('invalid_input', 'Public key does not match the literal local DID');
  return { schemaVersion: 1, did: value.did, name: value.name, publicKeyJwk: key };
}

function metadata(agent: AgentRecord): LocalAgent {
  return Object.freeze({ did: agent.did, name: agent.name, publicKeyJwk: Object.freeze({ ...agent.publicKeyJwk }),
    createdAt: agent.createdAt, revoked: agent.revoked, hasPrivateKey: agent.privateKeyJwk !== undefined });
}

function trusted(state: State, did: string): AgentRecord {
  text(did, 512);
  const agent = state.agents.find(candidate => candidate.did === did);
  if (!agent) fail('untrusted_identity', 'Identity is not explicitly trusted by this receiver');
  return agent;
}

function active(agent: AgentRecord): void {
  if (agent.revoked) fail('revoked', 'Identity trust is revoked at this receiver');
}

function validateState(value: unknown): State {
  record(value, ['schemaVersion', 'workspaceId', 'audience', 'namespace', 'createdAt', 'updatedAt', 'generation', 'agents', 'challenges', 'replays']);
  if (value.schemaVersion !== 1 || typeof value.workspaceId !== 'string' || !UUID.test(value.workspaceId) ||
      typeof value.namespace !== 'string' || !NAMESPACE.test(value.namespace)) fail('invalid_state', 'Invalid workspace header');
  text(value.audience, 2048);
  timestamp(value.createdAt); timestamp(value.updatedAt); timestamp(value.generation);
  if (value.updatedAt < value.createdAt || value.updatedAt > now() || value.generation < 1) fail('invalid_state', 'Invalid workspace revision or clock');
  if (!Array.isArray(value.agents) || value.agents.length > MAX_AGENTS ||
      !Array.isArray(value.challenges) || value.challenges.length > MAX_CHALLENGES ||
      !Array.isArray(value.replays) || value.replays.length > MAX_REPLAYS) fail('invalid_state', 'Workspace collections exceed their bounds');
  const dids = new Set<string>(); const grants = new Set<string>();
  for (const item of value.agents) {
    record(item, ['did', 'name', 'publicKeyJwk', 'createdAt', 'revoked', 'authorizationId', 'revision', 'privateKeyJwk']);
    const document = validateDocument({ schemaVersion: 1, did: item.did, name: item.name, publicKeyJwk: item.publicKeyJwk });
    timestamp(item.createdAt);
    if (item.createdAt < value.createdAt || item.createdAt > value.updatedAt || typeof item.revoked !== 'boolean' ||
        typeof item.authorizationId !== 'string' || !UUID.test(item.authorizationId) ||
        typeof item.revision !== 'string' || !UUID.test(item.revision) || dids.has(document.did) || grants.has(item.authorizationId)) {
      fail('invalid_state', 'Invalid or duplicate identity registration');
    }
    dids.add(document.did); grants.add(item.authorizationId);
    if (item.privateKeyJwk !== undefined) {
      record(item.privateKeyJwk, ['kty', 'crv', 'x', 'd']);
      const key = item.privateKeyJwk;
      if (key.kty !== 'OKP' || key.crv !== 'Ed25519' || key.x !== document.publicKeyJwk.x ||
          typeof key.d !== 'string' || !NONCE.test(key.d) || Buffer.from(key.d, 'base64url').length !== 32 ||
          Buffer.from(key.d, 'base64url').toString('base64url') !== key.d) fail('invalid_state', 'Invalid private signer');
      try {
        const actual = createPublicKey(createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', x: key.x, d: key.d }, format: 'jwk' })).export({ format: 'jwk' });
        if (actual.x !== document.publicKeyJwk.x) fail('invalid_state', 'Private signer does not match its public identity');
      } catch { fail('invalid_state', 'Private signer does not match its public identity'); }
    }
  }
  const nonces = new Set<string>();
  for (const item of value.challenges) {
    record(item, ['nonce', 'did', 'audience', 'issuedAt', 'expiresAt', 'consumedAt']);
    timestamp(item.issuedAt); timestamp(item.expiresAt);
    if (typeof item.nonce !== 'string' || !NONCE.test(item.nonce) || nonces.has(item.nonce) ||
        typeof item.did !== 'string' || !dids.has(item.did) || item.audience !== value.audience ||
        item.issuedAt < value.createdAt || item.issuedAt > value.updatedAt || item.expiresAt - item.issuedAt !== CHALLENGE_SECONDS) {
      fail('invalid_state', 'Invalid or duplicate challenge');
    }
    if (item.consumedAt !== undefined) {
      timestamp(item.consumedAt);
      if (item.consumedAt < item.issuedAt || item.consumedAt >= item.expiresAt || item.consumedAt > value.updatedAt) fail('invalid_state', 'Invalid challenge consumption');
    }
    nonces.add(item.nonce);
  }
  const claims = new Set<string>();
  for (const item of value.replays) {
    record(item, ['issuer', 'tokenId', 'audience', 'expiresAt', 'consumedAt']);
    text(item.tokenId, 512); timestamp(item.expiresAt); timestamp(item.consumedAt);
    const key = JSON.stringify([item.issuer, item.tokenId]);
    if (typeof item.issuer !== 'string' || !dids.has(item.issuer) || item.audience !== value.audience || claims.has(key) ||
        item.consumedAt < value.createdAt || item.consumedAt > value.updatedAt || item.expiresAt <= item.consumedAt ||
        item.expiresAt - item.consumedAt > PROOF_SECONDS) fail('invalid_state', 'Invalid or duplicate replay record');
    claims.add(key);
  }
  return value as unknown as State;
}

function secure(stat: Stats, directory: boolean): void {
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) ||
      (!directory && stat.nlink !== 1) || (POSIX && ((stat.mode & 0o777) !== (directory ? 0o700 : 0o600) ||
      (process.getuid && stat.uid !== process.getuid())))) fail('unavailable', 'Workspace permissions or file type are unsafe');
}

function sameFile(a: Stats, b: Stats): boolean { return a.dev === b.dev && a.ino === b.ino; }

async function ancestors(directory: string, allowMissing = false): Promise<void> {
  const root = parse(directory).root;
  let cursor = root;
  for (const component of relative(root, directory).split(/[\\/]/u).filter(Boolean)) {
    cursor = join(cursor, component);
    try {
      const stat = await lstat(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unavailable', 'Workspace paths may not contain symlinks');
    } catch (error) {
      if (allowMissing && errorCode(error) === 'ENOENT') return;
      throw error instanceof LocalWorkspaceError ? error : new LocalWorkspaceError('unavailable', 'Workspace path is unavailable');
    }
  }
}

function directoryPath(value: string): string {
  text(value, 4096);
  const directory = resolve(value);
  if (!isAbsolute(directory) || directory === parse(directory).root) fail('invalid_input', 'A dedicated workspace directory is required');
  return directory;
}

async function syncDirectory(directory: string): Promise<void> {
  if (!POSIX) return;
  const handle = await open(directory, constants.O_RDONLY | DIRECTORY | NOFOLLOW);
  try { secure(await handle.stat(), true); await handle.sync(); }
  finally { await handle.close(); }
}

async function readBounded(handle: FileHandle, limit: number): Promise<Buffer> {
  const bytes = Buffer.alloc(limit + 1);
  let count = 0;
  while (count < bytes.length) {
    const result = await handle.read(bytes, count, bytes.length - count, count);
    if (result.bytesRead === 0) break;
    count += result.bytesRead;
  }
  if (count > limit) fail('invalid_state', 'Workspace file exceeds its size limit');
  return bytes.subarray(0, count);
}

/** Durable, explicitly local trust and private signing-key custody. */
export class OpenAgentWorkspace {
  private constructor(private readonly directory: string, private readonly directoryStat: Stats,
    private readonly workspaceId: string, private readonly audience: string, private readonly namespace: string) {}

  /** Exclusively initialize an absent directory. Existing/corrupt state is never reset. */
  static async initialize(directory: string, options: { audience: string; namespace?: string }): Promise<OpenAgentWorkspace> {
    const path = directoryPath(directory);
    text(options?.audience, 2048);
    const audience = options.audience;
    const namespace = options.namespace ?? 'openagent';
    if (!NAMESPACE.test(namespace)) fail('invalid_input', 'Invalid OAS namespace');
    await ancestors(dirname(path), true);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await ancestors(dirname(path));
    try { await mkdir(path, { mode: 0o700 }); }
    catch { fail('unavailable', 'Workspace directory already exists or cannot be created'); }
    const stat = await lstat(path); secure(stat, true);
    const time = now();
    const state: State = { schemaVersion: 1, workspaceId: randomUUID(), audience, namespace,
      createdAt: time, updatedAt: time, generation: 1, agents: [], challenges: [], replays: [] };
    const workspace = new OpenAgentWorkspace(path, stat, state.workspaceId, state.audience, namespace);
    const lock = await workspace.acquire();
    try {
      // Only the new workspace is touched. An existing caller's .gitignore is
      // neither edited nor relied on to protect generated private keys.
      const ignore = await open(join(path, '.gitignore'), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | NOFOLLOW, 0o600);
      try { secure(await ignore.stat(), false); await ignore.writeFile('*\n'); await ignore.sync(); }
      finally { await ignore.close(); }
      await workspace.persist(state, true);
    }
    finally { await workspace.release(lock); }
    return workspace;
  }

  /** Open valid existing state. No repair, lock stealing or implicit initialization. */
  static async open(directory: string): Promise<OpenAgentWorkspace> {
    const path = directoryPath(directory);
    await ancestors(path);
    const stat = await lstat(path); secure(stat, true);
    const workspace = new OpenAgentWorkspace(path, stat, '', '', '');
    const lock = await workspace.acquire();
    try {
      const state = await workspace.read();
      return new OpenAgentWorkspace(path, stat, state.workspaceId, state.audience, state.namespace);
    } finally { await workspace.release(lock); }
  }

  private async checkDirectory(): Promise<void> {
    await ancestors(this.directory);
    const stat = await lstat(this.directory); secure(stat, true);
    if (!sameFile(stat, this.directoryStat)) fail('unavailable', 'Workspace directory changed');
  }

  private async acquire(): Promise<Lock> {
    const deadline = performance.now() + LOCK_WAIT_MS;
    for (;;) {
      await this.checkDirectory();
      try {
        const handle = await open(join(this.directory, LOCK_FILE), constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | NOFOLLOW, 0o600);
        try {
          const stat = await handle.stat(); secure(stat, false);
          const content = JSON.stringify({ pid: process.pid, token: randomUUID() });
          await handle.writeFile(content); await handle.sync();
          return { handle, stat, content };
        } catch (error) { await handle.close(); throw error; }
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error instanceof LocalWorkspaceError ? error : new LocalWorkspaceError('unavailable', 'Workspace lock is unavailable');
        try { secure(await lstat(join(this.directory, LOCK_FILE)), false); }
        catch (inspection) { if (errorCode(inspection) !== 'ENOENT') throw inspection; }
        if (performance.now() >= deadline) fail('locked', 'Workspace is locked; abandoned locks require explicit operator recovery');
        await delay(20);
      }
    }
  }

  private async release(lock: Lock): Promise<void> {
    try {
      await this.checkDirectory();
      const current = await lstat(join(this.directory, LOCK_FILE)); secure(current, false);
      if (!sameFile(current, lock.stat)) fail('unavailable', 'Workspace lock ownership changed');
      const actual = await open(join(this.directory, LOCK_FILE), constants.O_RDONLY | NOFOLLOW);
      try {
        const stat = await actual.stat(); secure(stat, false);
        if (!sameFile(stat, lock.stat) || (await readBounded(actual, 512)).toString('utf8') !== lock.content) fail('unavailable', 'Workspace lock ownership changed');
      }
      finally { await actual.close(); }
      await unlink(join(this.directory, LOCK_FILE));
    } finally { await lock.handle.close(); }
  }

  private async read(): Promise<State> {
    await this.checkDirectory();
    if ((await readdir(this.directory)).some(name => name.startsWith(WRITE_PREFIX))) fail('unavailable', 'Workspace has an unfinished atomic write; operator recovery is required');
    try {
      const handle = await open(join(this.directory, STATE_FILE), constants.O_RDONLY | NOFOLLOW);
      try {
        const stat = await handle.stat(); secure(stat, false);
        if (stat.size > MAX_STATE_BYTES) fail('invalid_state', 'Workspace state exceeds its size limit');
        const bytes = await readBounded(handle, MAX_STATE_BYTES);
        const state = validateState(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
        if (this.workspaceId && (state.workspaceId !== this.workspaceId || state.audience !== this.audience || state.namespace !== this.namespace)) fail('invalid_state', 'Workspace authority changed');
        return state;
      } finally { await handle.close(); }
    } catch (error) {
      if (error instanceof LocalWorkspaceError && error.code !== 'invalid_input') throw error;
      fail('invalid_state', 'Workspace state is missing, malformed or insecure');
    }
  }

  private async persist(state: State, initial = false): Promise<void> {
    validateState(state);
    const data = JSON.stringify(state) + '\n';
    if (Buffer.byteLength(data) > MAX_STATE_BYTES) fail('capacity', 'Workspace state exceeds its size limit');
    await this.checkDirectory();
    if (initial) {
      try { await lstat(join(this.directory, STATE_FILE)); fail('unavailable', 'Workspace already has state'); }
      catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
    } else { secure(await lstat(join(this.directory, STATE_FILE)), false); }
    const temporary = join(this.directory, WRITE_PREFIX + randomUUID());
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | NOFOLLOW, 0o600);
    try {
      secure(await handle.stat(), false);
      await handle.writeFile(data); await handle.sync(); await handle.close();
      await this.checkDirectory();
      await rename(temporary, join(this.directory, STATE_FILE));
      await syncDirectory(this.directory);
    } catch {
      await handle.close().catch(() => undefined);
      // Preserve unfinished writes/locks for deliberate recovery, never reset
      // state or guess which side of an interrupted rename was committed.
      fail('unavailable', 'Workspace atomic write failed; operator recovery may be required');
    }
  }

  private async transaction<T>(operation: (state: State) => Promise<{ value: T; write: boolean }>): Promise<T> {
    const lock = await this.acquire();
    try {
      const state = await this.read();
      const time = now();
      state.challenges = state.challenges.filter(challenge => challenge.expiresAt > time);
      state.replays = state.replays.filter(claim => claim.expiresAt > time);
      const result = await operation(state);
      if (result.write) {
        if (state.generation >= Number.MAX_SAFE_INTEGER) fail('capacity', 'Workspace revision is exhausted');
        state.generation += 1; state.updatedAt = now();
        await this.persist(state);
      }
      return result.value;
    } finally { await this.release(lock); }
  }

  /** Generate a real signer and deliberately authorize it at this receiver. */
  async createAgent(name: string): Promise<LocalAgent> {
    text(name, 128);
    return this.transaction(async state => {
      if (state.agents.length >= MAX_AGENTS) fail('capacity', 'Workspace identity limit reached');
      const keys = await generateKeyPair('EdDSA', { extractable: true });
      const pub = publicKey(await exportJWK(keys.publicKey));
      const privateJwk = await exportJWK(keys.privateKey);
      if (typeof privateJwk.d !== 'string') fail('unavailable', 'Ed25519 private-key export failed');
      const did = identityDid(state.namespace, pub);
      if (state.agents.some(agent => agent.did === did)) fail('unavailable', 'Generated identity collision');
      const agent: AgentRecord = { did, name, publicKeyJwk: pub, privateKeyJwk: { ...pub, d: privateJwk.d },
        createdAt: now(), revoked: false, authorizationId: randomUUID(), revision: randomUUID() };
      state.agents.push(agent);
      return { value: metadata(agent), write: true };
    });
  }

  /** Public registrations only, including receiver-local revocation/signer presence. */
  async listAgents(): Promise<LocalAgent[]> {
    return this.transaction(async state => ({ value: state.agents.map(metadata), write: false }));
  }

  /** Export public identity without granting trust to a different receiver. */
  async exportIdentity(did: string): Promise<LocalAgentDocument> {
    return this.transaction(async state => {
      const agent = trusted(state, did);
      return { value: Object.freeze({ schemaVersion: 1 as const, did: agent.did, name: agent.name,
        publicKeyJwk: Object.freeze({ ...agent.publicKeyJwk }) }), write: false };
    });
  }

  /** Explicit immutable key pin. An idempotent import never restores revoked trust. */
  async trustIdentity(document: LocalAgentDocument): Promise<LocalAgent> {
    const valid = validateDocument(document);
    return this.transaction(async state => {
      const existing = state.agents.find(agent => agent.did === valid.did);
      if (existing) {
        if (existing.publicKeyJwk.x !== valid.publicKeyJwk.x) fail('invalid_input', 'Existing identity key may not be replaced');
        return { value: metadata(existing), write: false };
      }
      if (state.agents.length >= MAX_AGENTS) fail('capacity', 'Workspace identity limit reached');
      const agent: AgentRecord = { did: valid.did, name: valid.name, publicKeyJwk: valid.publicKeyJwk,
        createdAt: now(), revoked: false, authorizationId: randomUUID(), revision: randomUUID() };
      state.agents.push(agent);
      return { value: metadata(agent), write: true };
    });
  }

  /** Persist a fresh, exact-DID/recipient challenge before returning it. */
  async issueChallenge(did: string): Promise<LocalChallenge> {
    return this.transaction(async state => {
      active(trusted(state, did));
      if (state.challenges.length >= MAX_CHALLENGES) fail('capacity', 'Workspace active challenge limit reached');
      const time = now();
      const nonce = randomBytes(32).toString('base64url');
      if (state.challenges.some(challenge => challenge.nonce === nonce)) fail('unavailable', 'Challenge collision');
      const challenge = { nonce, did, audience: state.audience, issuedAt: time, expiresAt: time + CHALLENGE_SECONDS };
      state.challenges.push(challenge);
      return { value: Object.freeze({ nonce, audience: state.audience, expiresAt: challenge.expiresAt }), write: true };
    });
  }

  /** Sign for an explicit recipient; this confers no trust or scopes there. */
  async prove(did: string, options: { nonce: string; audience: string }): Promise<AgentIdentityProof> {
    text(options?.audience, 2048);
    if (typeof options?.nonce !== 'string' || !NONCE.test(options.nonce)) fail('invalid_input', 'Expected a receiver-issued random challenge');
    const audience = options.audience;
    const nonce = options.nonce;
    return this.transaction(async state => {
      const agent = trusted(state, did);
      if (!agent.privateKeyJwk) fail('no_signer', 'Workspace has no private signer for this identity');
      const key = await importJWK(agent.privateKeyJwk as JWK, 'EdDSA');
      const time = now();
      const token = await new SignJWT({ kind: 'agent', nonce })
        .setProtectedHeader({ alg: 'EdDSA', typ: 'oaid-proof+jwt', kid: `${did}#signing` })
        .setIssuer(did).setSubject(did).setAudience(audience).setIssuedAt(time)
        .setNotBefore(time).setExpirationTime(time + PROOF_SECONDS).setJti(randomUUID()).sign(key);
      return { value: Object.freeze({ token, delegations: Object.freeze([]) }), write: false };
    });
  }

  /** Verify real signatures against this receiver's pin, then durably consume
   * nonce/JTI under the same cross-process transaction as revocation reads. */
  async verify(proof: AgentIdentityProof, options: { nonce: string }): Promise<VerifiedAgentIdentity> {
    record(proof, ['token', 'delegations']);
    if (typeof proof.token !== 'string' || Buffer.byteLength(proof.token) > 32768 ||
        !Array.isArray(proof.delegations) || proof.delegations.length !== 0 ||
        typeof options?.nonce !== 'string' || !NONCE.test(options.nonce)) fail('invalid_input', 'Expected a bounded self-root possession proof and issued nonce');
    const copiedProof: AgentIdentityProof = { token: proof.token, delegations: [] };
    const nonce = options.nonce;
    const result = await this.transaction(async state => {
      const challenge = state.challenges.find(candidate => candidate.nonce === nonce);
      if (!challenge || challenge.expiresAt <= now()) throw new IdentityVerificationError('invalid_proof', 'Receiver challenge is missing or expired');
      if (challenge.consumedAt !== undefined) throw new IdentityVerificationError('replayed', 'Receiver challenge was already consumed');
      const agent = trusted(state, challenge.did);
      if (agent.revoked) throw new IdentityVerificationError('revoked', 'Identity trust is revoked at this receiver');
      const verifier = new IdentityVerifier({
        now, maxProofAgeSeconds: PROOF_SECONDS,
        async resolveDid(did) {
          const pin = state.agents.find(candidate => candidate.did === did);
          return pin ? { did, verificationMethods: [{ id: `${did}#signing`, publicKeyJwk: { ...pin.publicKeyJwk },
            purposes: ['authentication'] }] } : null;
        },
        async authorizeOwner() { return null; },
        async authorizeSelfRoot(did, { audience }) {
          const pin = state.agents.find(candidate => candidate.did === did);
          if (!pin || pin.revoked || audience !== state.audience) return null;
          const time = now();
          return { did, audience, authorizationId: pin.authorizationId, revision: pin.revision,
            issuedAt: pin.createdAt, notBefore: pin.createdAt, checkedAt: time, expiresAt: time + AUTHORITY_SECONDS };
        },
        async checkRevocation({ did }) {
          const pin = state.agents.find(candidate => candidate.did === did);
          return { revoked: !pin || pin.revoked, checkedAt: now() };
        },
        replay: { async consume(claim) {
          const time = now();
          if (claim.issuer !== challenge.did || claim.audience !== state.audience || claim.nonce !== challenge.nonce ||
              claim.expiresAt <= time || challenge.expiresAt <= time || challenge.consumedAt !== undefined ||
              state.replays.some(entry => entry.issuer === claim.issuer && entry.tokenId === claim.tokenId)) return false;
          if (state.replays.length >= MAX_REPLAYS) fail('capacity', 'Workspace replay limit reached');
          challenge.consumedAt = time;
          state.replays.push({ issuer: claim.issuer, tokenId: claim.tokenId, audience: claim.audience,
            expiresAt: claim.expiresAt, consumedAt: time });
          return true;
        } },
      });
      const identity = await verifier.verify(copiedProof, { audience: state.audience, nonce: challenge.nonce });
      return { value: { ...identity, expiresAt: Math.min(identity.expiresAt, challenge.expiresAt) } as VerifiedAgentIdentity, write: true };
    });
    if (result.expiresAt <= now()) throw new IdentityVerificationError('invalid_proof', 'Proof expired during durable verification');
    return result;
  }

  /** Revoke only this receiver's trust; signer custody and other receivers remain independent. */
  async revoke(did: string): Promise<void> {
    await this.transaction(async state => {
      const agent = trusted(state, did);
      const changed = !agent.revoked; agent.revoked = true;
      return { value: undefined, write: changed };
    });
  }

  /** Metadata only. No keys, challenges, proof IDs or private state are printed. */
  async inspect(): Promise<{ audience: string; namespace: string; agents: number; signers: number; revoked: number }> {
    return this.transaction(async state => ({ value: { audience: state.audience, namespace: state.namespace,
      agents: state.agents.length, signers: state.agents.filter(agent => agent.privateKeyJwk !== undefined).length,
      revoked: state.agents.filter(agent => agent.revoked).length }, write: false }));
  }
}
