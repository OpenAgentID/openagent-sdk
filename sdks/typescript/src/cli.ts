import { open, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importJWK, type JWK } from 'jose';
import { verifyIdentityRemote } from './verification-api.js';
import { oasGlyph } from './glyph.js';
import { generateCharacter, getCharacterSkins, type CharacterShape, type CharacterView, type CharacterSkin } from './characters.js';
import { parseCharacterState } from './character-state.js';
import { getCharacterAccessories, parseCharacterAccessories } from './character-accessories.js';
import { OpenAgentWorkspace, type LocalAgentDocument } from './local-workspace.js';
import type { AgentIdentityProof } from './identity-verification.js';

const usage = `OpenAgentID 0.6.0 — identity on infrastructure you control

oaid init [--directory PATH] [--audience AUDIENCE] [--namespace NAME]
oaid agent create --name NAME [--directory PATH]
oaid agent list [--directory PATH]
oaid agent export --did DID [--output FILE] [--directory PATH]
oaid agent trust --document FILE [--directory PATH]
oaid agent revoke --did DID [--directory PATH]
oaid challenge --did DID [--directory PATH]
oaid prove --did DID --nonce NONCE --audience AUDIENCE [--output FILE] [--directory PATH]
oaid verify --local --proof FILE --nonce ISSUED_NONCE [--directory PATH]
oaid doctor [--directory PATH]
oaid avatar skins
oaid avatar accessories
oaid avatar DID [--skin FAMILY] [--shape KIND] [--view avatar|full] [--accessories glasses,headphones] [--status STATUS] [--expression EXPRESSION] [--size N] [--output FILE]
oaid verify --endpoint HTTPS_URL --proof FILE --nonce ISSUED_NONCE
oaid glyph DID [--output FILE] [--size 32..2048]
oaid oidc doctor --issuer HTTPS_ISSUER

Local commands default to .openagentid and need no account or hosted service.
init defaults the receiver audience to http://127.0.0.1:3000.
agent trust is explicit receiver consent to a public identity. It grants no
access in other applications. Keep workspace private keys out of source control.
verify --local uses this workspace's trust and revocation; --endpoint uses an
explicit trusted verification service. The receiver must issue the nonce first.
avatar and glyph render images; they do not authenticate the identity.
`;

export interface CliIO {
  stdout(text: string): void;
  stderr(text: string): void;
  fetch?: typeof globalThis.fetch;
}

function options(args: readonly string[], names: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!;
    const value = args[i + 1];
    if (!names.includes(key) || value === undefined || value.startsWith('--') || Object.hasOwn(values, key)) throw new Error('Invalid or duplicate command option');
    values[key] = value;
  }
  return values;
}

function required(flags: Record<string, string>, name: string): string {
  const value = flags[name];
  if (!value?.trim()) throw new Error(`Missing ${name}; run oaid --help`);
  return value;
}

/** Read bounded input without printing JSON parser excerpts of a signed proof. */
async function readJsonFile(path: string): Promise<unknown> {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 131_072) throw new Error('Input must be a JSON file of at most 128 KiB');
    const buffer = Buffer.alloc(131_073);
    let length = 0;
    while (length < buffer.length) {
      const result = await file.read(buffer, length, buffer.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > 131_072) throw new Error('Input must be a JSON file of at most 128 KiB');
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length))); }
    catch { throw new Error('Input is not valid UTF-8 JSON'); }
  } finally { await file.close(); }
}

async function emit(value: unknown, io: CliIO, output?: string): Promise<void> {
  const content = typeof value === 'string' ? value + '\n' : JSON.stringify(value, null, 2) + '\n';
  // Signed possession proofs are short-lived credentials; never overwrite a
  // caller's file or create a world-readable output.
  if (output) await writeFile(output, content, { flag: 'wx', mode: 0o600 });
  else io.stdout(content);
}

const workspace = (flags: Record<string, string>) => OpenAgentWorkspace.open(flags['--directory'] ?? '.openagentid');

function https(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new Error('Expected an HTTPS URL without credentials, query or fragment');
  return url;
}

async function getJson(url: URL, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`OIDC endpoint returned HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 131_072) throw new Error('OIDC response exceeds size limit');
  return JSON.parse(text);
}

/** Provider-neutral doctor migrated from legacy discovery/CLI behavior. */
export async function oidcDoctor(issuer: string, fetcher: typeof fetch = globalThis.fetch): Promise<Record<string, unknown>> {
  const base = https(issuer).href.replace(/\/$/, '');
  const raw = await getJson(new URL(base + '/.well-known/openid-configuration'), fetcher);
  if (!raw || typeof raw !== 'object') throw new Error('Invalid OIDC discovery');
  const doc = raw as Record<string, unknown>;
  if (doc.issuer !== base) throw new Error('OIDC discovery issuer mismatch');
  for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    if (typeof doc[key] !== 'string') throw new Error(`Missing ${key}`);
    https(doc[key]);
  }
  if (!Array.isArray(doc.response_types_supported) || !doc.response_types_supported.includes('code')) throw new Error('Issuer does not support authorization code');
  if (doc.grant_types_supported !== undefined && (!Array.isArray(doc.grant_types_supported) || !doc.grant_types_supported.includes('authorization_code'))) throw new Error('Issuer does not support authorization code grants');
  if (!Array.isArray(doc.code_challenge_methods_supported) || !doc.code_challenge_methods_supported.includes('S256')) throw new Error('Issuer does not support S256 PKCE');
  const algorithms = doc.id_token_signing_alg_values_supported;
  if (!Array.isArray(algorithms) || !algorithms.some(alg => alg === 'RS256' || alg === 'EdDSA' || alg === 'ES256')) throw new Error('Issuer lacks a supported asymmetric ID-token algorithm');
  const rawJwks = await getJson(https(doc.jwks_uri as string), fetcher);
  if (!rawJwks || typeof rawJwks !== 'object' || !Array.isArray((rawJwks as { keys?: unknown }).keys)) throw new Error('Invalid JWKS');
  const keys = (rawJwks as { keys: JWK[] }).keys;
  const kids = new Set<string>();
  let signingKeys = 0;
  for (const key of keys) {
    if (!key || typeof key !== 'object' || Array.isArray(key)) throw new Error('Invalid JWKS key');
    if (['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some(field => Object.hasOwn(key, field)) || key.kty === 'oct') throw new Error('JWKS exposes private or symmetric material');
    if (!key.kid || kids.has(key.kid)) throw new Error('JWKS keys require unique key IDs');
    kids.add(key.kid);
    if (key.use && key.use !== 'sig') continue;
    const alg = key.alg ?? (key.kty === 'RSA' ? 'RS256' : key.kty === 'OKP' && key.crv === 'Ed25519' ? 'EdDSA' : key.kty === 'EC' && key.crv === 'P-256' ? 'ES256' : '');
    if (!['RS256', 'EdDSA', 'ES256'].includes(alg) || !algorithms.includes(alg)) continue;
    if ((alg === 'RS256' && key.kty !== 'RSA') || (alg === 'EdDSA' && (key.kty !== 'OKP' || key.crv !== 'Ed25519')) || (alg === 'ES256' && (key.kty !== 'EC' || key.crv !== 'P-256'))) throw new Error('JWKS algorithm and key type do not match');
    await importJWK(key, alg);
    signingKeys++;
  }
  if (!signingKeys) throw new Error('JWKS has no usable public signing key');
  return { issuer: base, discovery: 'valid', signingKeys, pkce: 'S256', algorithms, agentFederation: 'requires_real_agent_flow_verification' };
}

export async function runCli(args: readonly string[], io: CliIO): Promise<number> {
  try {
    if (!args.length || args[0] === '--help' || args[0] === 'help') { io.stdout(usage); return 0; }
    if (args[0] === '--version' && args.length === 1) { io.stdout('0.6.0\n'); return 0; }
    if (args[0] === 'init') {
      const flags = options(args.slice(1), ['--directory', '--audience', '--namespace']);
      const created = await OpenAgentWorkspace.initialize(flags['--directory'] ?? '.openagentid', {
        audience: flags['--audience'] ?? 'http://127.0.0.1:3000',
        ...(flags['--namespace'] === undefined ? {} : { namespace: flags['--namespace'] }),
      });
      await emit({ initialized: true, ...await created.inspect() }, io);
      return 0;
    }
    if (args[0] === 'doctor') {
      const flags = options(args.slice(1), ['--directory']);
      await emit({ storage: 'valid', ...await (await workspace(flags)).inspect(),
        trust: 'receiver-controlled', hostedServiceRequired: false }, io);
      return 0;
    }
    if (args[0] === 'agent') {
      const command = args[1];
      const allowed: Record<string, readonly string[]> = {
        create: ['--name'], list: [], export: ['--did', '--output'],
        trust: ['--document'], revoke: ['--did'],
      };
      if (!command || !Object.hasOwn(allowed, command)) throw new Error('Unknown agent command; run oaid --help');
      const flags = options(args.slice(2), ['--directory', ...allowed[command]!]);
      const local = await workspace(flags);
      if (command === 'create') await emit(await local.createAgent(required(flags, '--name')), io);
      else if (command === 'list') await emit(await local.listAgents(), io);
      else if (command === 'export') await emit(await local.exportIdentity(required(flags, '--did')), io, flags['--output']);
      else if (command === 'trust') {
        const document = await readJsonFile(required(flags, '--document'));
        await emit(await local.trustIdentity(document as LocalAgentDocument), io);
      } else {
        const did = required(flags, '--did');
        await local.revoke(did);
        await emit({ did, revoked: true, authority: 'this receiver' }, io);
      }
      return 0;
    }
    if (args[0] === 'challenge') {
      const flags = options(args.slice(1), ['--did', '--directory']);
      await emit(await (await workspace(flags)).issueChallenge(required(flags, '--did')), io);
      return 0;
    }
    if (args[0] === 'prove') {
      const flags = options(args.slice(1), ['--did', '--nonce', '--audience', '--directory', '--output']);
      const proof = await (await workspace(flags)).prove(required(flags, '--did'), {
        nonce: required(flags, '--nonce'), audience: required(flags, '--audience'),
      });
      await emit(proof, io, flags['--output']);
      return 0;
    }
    if (args[0] === 'verify') {
      if (args.includes('--local')) {
        if (args.filter(value => value === '--local').length !== 1) throw new Error('Duplicate --local option');
        const flags = options(args.slice(1).filter(value => value !== '--local'), ['--proof', '--nonce', '--directory']);
        const proof = await readJsonFile(required(flags, '--proof')) as AgentIdentityProof;
        await emit(await (await workspace(flags)).verify(proof, { nonce: required(flags, '--nonce') }), io);
        return 0;
      }
      const flags = options(args.slice(1), ['--endpoint', '--proof', '--nonce']);
      if (!flags['--endpoint'] || !flags['--proof'] || !flags['--nonce']) throw new Error('verify requires endpoint, proof and issued nonce');
      https(flags['--endpoint']);
      const proof = await readJsonFile(flags['--proof']) as AgentIdentityProof;
      const identity = await verifyIdentityRemote(flags['--endpoint'], proof, { nonce: flags['--nonce'], fetch: io.fetch });
      io.stdout(JSON.stringify(identity, null, 2) + '\n');
      return 0;
    }
    if (args[0] === 'avatar' && args[1] === 'skins') {
      if (args.length !== 2) throw new Error('avatar skins takes no options');
      await emit(getCharacterSkins(), io);
      return 0;
    }
    if (args[0] === 'avatar' && args[1] === 'accessories') {
      if (args.length !== 2) throw new Error('avatar accessories takes no options');
      await emit(getCharacterAccessories(), io);
      return 0;
    }
    if (args[0] === 'avatar') {
      if (!args[1]) throw new Error('avatar requires a DID');
      const flags = options(args.slice(2), ['--skin', '--shape', '--view', '--accessories', '--status', '--expression', '--size', '--output']);
      const state = parseCharacterState({
        ...(flags['--status'] === undefined ? {} : { status: flags['--status'] }),
        ...(flags['--expression'] === undefined ? {} : { expression: flags['--expression'] }),
      });
      const character = generateCharacter(args[1], {
        skin: (flags['--skin'] ?? 'autos') as CharacterSkin,
        shape: flags['--shape'] as CharacterShape | undefined, view: flags['--view'] as CharacterView | undefined,
        accessories: parseCharacterAccessories(flags['--accessories'] === undefined ? undefined
          : flags['--accessories'] === '' ? [] : flags['--accessories'].split(',')),
        size: flags['--size'] === undefined ? undefined : Number(flags['--size']), state,
      });
      await emit(character.svg, io, flags['--output']);
      return 0;
    }
    if (args[0] === 'glyph') {
      if (!args[1]) throw new Error('glyph requires a DID');
      const flags = options(args.slice(2), ['--output', '--size']);
      const svg = oasGlyph(args[1], { size: flags['--size'] ? Number(flags['--size']) : undefined });
      if (flags['--output']) await writeFile(flags['--output'], svg + '\n', { flag: 'wx' });
      else io.stdout(svg + '\n');
      return 0;
    }
    if (args[0] === 'oidc' && args[1] === 'doctor') {
      const flags = options(args.slice(2), ['--issuer']);
      if (!flags['--issuer']) throw new Error('doctor requires an issuer');
      io.stdout(JSON.stringify(await oidcDoctor(flags['--issuer'], io.fetch), null, 2) + '\n');
      return 0;
    }
    throw new Error('Unknown command; run oaid --help');
  } catch (error) {
    // Verification errors never echo proof material, endpoints or response bodies.
    io.stderr((error instanceof Error ? error.message : 'Command failed') + '\n');
    return 1;
  }
}

function isCliEntry(): boolean {
  try { return !!process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); }
  catch { return false; }
}

if (isCliEntry()) {
  runCli(process.argv.slice(2), { stdout: text => process.stdout.write(text), stderr: text => process.stderr.write(text) })
    .then(code => { process.exitCode = code; });
}
