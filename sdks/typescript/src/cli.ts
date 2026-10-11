import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importJWK, type JWK } from 'jose';
import { verifyIdentityRemote } from './verification-api.js';
import { oasGlyph } from './glyph.js';
import type { AgentIdentityProof } from './identity-verification.js';

const usage = `oaid verify --endpoint HTTPS_URL --proof FILE --nonce ISSUED_NONCE
oaid glyph DID [--output FILE] [--size 32..2048]
oaid oidc doctor --issuer HTTPS_ISSUER

verify checks a signed proof through the configured trusted service, including
owner authority and revocation. A nonce must first be issued by that service.
glyph renders an avatar; it does not authenticate the identity.
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
    if (args[0] === 'verify') {
      const flags = options(args.slice(1), ['--endpoint', '--proof', '--nonce']);
      if (!flags['--endpoint'] || !flags['--proof'] || !flags['--nonce']) throw new Error('verify requires endpoint, proof and issued nonce');
      https(flags['--endpoint']);
      const content = await readFile(flags['--proof'], 'utf8');
      if (content.length > 131_072) throw new Error('Proof file exceeds size limit');
      const proof: AgentIdentityProof = JSON.parse(content);
      const identity = await verifyIdentityRemote(flags['--endpoint'], proof, { nonce: flags['--nonce'], fetch: io.fetch });
      io.stdout(JSON.stringify(identity, null, 2) + '\n');
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

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli(process.argv.slice(2), { stdout: text => process.stdout.write(text), stderr: text => process.stderr.write(text) })
    .then(code => { process.exitCode = code; });
}
