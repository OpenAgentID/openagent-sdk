import {
  IdentityVerificationError,
  IdentityVerifier,
  assertVerifiedIdentity,
  type AgentIdentityProof,
  type VerifiedAgentIdentity,
} from './identity-verification.js';
import { DID_REGEX, LEGACY_DID_REGEX } from './config.js';
import { decodeJwt } from 'jose';

export interface IdentityVerificationHandlerOptions {
  /** The service's configured audience; never taken from request claims. */
  readonly audience: string;
  /**
   * Return the expected server-issued challenge for this request. Validate its
   * audience, session/tenant binding and expiry in authoritative storage; do not
   * merely echo X-OpenAgent-Nonce. replay.consume must atomically consume it.
   */
  resolveNonce(request: Request): Promise<string>;
  readonly maxBodyBytes?: number;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

async function readJson(response: Request | Response, limit: number): Promise<unknown> {
  const announced = response.headers.get('content-length');
  if (announced !== null && (!/^\d+$/.test(announced) || Number(announced) > limit)) {
    throw new RangeError('Verification body is too large');
  }
  if (!response.body) throw new SyntaxError('Missing verification body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) throw new RangeError('Verification body is too large');
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Host this handler at your chosen POST endpoint. No endpoint is auto-deployed. */
export function createIdentityVerificationHandler(
  verifier: IdentityVerifier,
  options: IdentityVerificationHandlerOptions,
): (request: Request) => Promise<Response> {
  if (!options || !options.audience || typeof options.resolveNonce !== 'function') {
    throw new TypeError('Fixed audience and authoritative challenge resolver are required');
  }
  const limit = options.maxBodyBytes ?? 131_072;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('Invalid verification body limit');
  return async (request) => {
    if (request.method !== 'POST') {
      const response = json({ error: 'method_not_allowed' }, 405);
      response.headers.set('allow', 'POST');
      return response;
    }
    if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      return json({ error: 'unsupported_media_type' }, 415);
    }
    let body: unknown;
    try {
      body = await readJson(request, limit);
    } catch (error) {
      return json({ error: error instanceof RangeError ? 'body_too_large' : 'invalid_request' },
        error instanceof RangeError ? 413 : 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some((key) => key !== 'proof') || !('proof' in body)) {
      return json({ error: 'invalid_request' }, 400);
    }
    try {
      const nonce = await options.resolveNonce(request);
      const identity = await verifier.verify((body as { proof: AgentIdentityProof }).proof,
        { audience: options.audience, nonce });
      return json({ identity }, 200);
    } catch (error) {
      if (error instanceof IdentityVerificationError) {
        return json({ error: error.code }, error.code === 'authority_unavailable' ? 503 : 401);
      }
      return json({ error: 'authority_unavailable' }, 503);
    }
  };
}

export interface RemoteIdentityVerificationOptions {
  readonly nonce: string;
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

function validDid(did: unknown): did is string {
  return typeof did === 'string' && did.length <= 512 &&
    (DID_REGEX.test(did) || LEGACY_DID_REGEX.test(did));
}

function agentDid(did: unknown): did is string {
  return validDid(did) && /:(?:agent|agent:instance):[A-Za-z0-9._-]+$/.test(did);
}

/** Decode for request/verdict correlation only. The remote authority verifies signatures. */
function correlateProof(proof: AgentIdentityProof, nonce: string): {
  proof: AgentIdentityProof;
  did: string;
  expiresAt: number;
  lineage: readonly string[];
} {
  try {
    if (!proof || typeof proof !== 'object' || Array.isArray(proof) ||
        typeof proof.token !== 'string' || !proof.token || proof.token.length > 32_768 ||
        !Array.isArray(proof.delegations) || proof.delegations.length > 16 ||
        proof.delegations.some(token => typeof token !== 'string' || !token || token.length > 32_768)) {
      throw new Error('Invalid proof envelope');
    }
    const copy = { token: proof.token, delegations: [...proof.delegations] };
    const claims = decodeJwt(copy.token);
    if (!agentDid(claims.sub) || claims.iss !== claims.sub || claims.kind !== 'agent' || claims.nonce !== nonce ||
        typeof claims.aud !== 'string' || !claims.aud || claims.aud.length > 2048 ||
        typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) {
      throw new Error('Invalid proof correlation claims');
    }
    const lineage: string[] = [];
    for (const token of copy.delegations) {
      const delegation = decodeJwt(token);
      if (!validDid(delegation.iss) || !validDid(delegation.sub) ||
          (lineage.length > 0 && lineage.at(-1) !== delegation.iss)) {
        throw new Error('Invalid proof lineage correlation');
      }
      if (lineage.length === 0) lineage.push(delegation.iss);
      lineage.push(delegation.sub);
    }
    if (lineage.length === 0) lineage.push(claims.sub);
    if (lineage.at(-1) !== claims.sub || new Set(lineage).size !== lineage.length) {
      throw new Error('Proof lineage does not match its agent');
    }
    return { proof: copy, did: claims.sub, expiresAt: claims.exp, lineage };
  } catch {
    throw new IdentityVerificationError('invalid_proof', 'Submitted identity proof does not match the issued challenge');
  }
}

/** The configured service is a trust authority. HTTPS protects its returned verdict. */
export async function verifyIdentityRemote(
  endpoint: string,
  proof: AgentIdentityProof,
  options: RemoteIdentityVerificationOptions,
): Promise<VerifiedAgentIdentity> {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) {
    throw new TypeError('Verification requires a configured HTTPS endpoint without credentials or query parameters');
  }
  if (typeof options?.nonce !== 'string' || !options.nonce || options.nonce.length > 512 || /[\r\n]/.test(options.nonce)) {
    throw new TypeError('Issued verification nonce is required');
  }
  const correlation = correlateProof(proof, options.nonce);
  const timeout = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1) throw new TypeError('Invalid verification timeout');
  const transport = options.fetch ?? globalThis.fetch;
  if (typeof transport !== 'function') throw new TypeError('A fetch implementation is required');
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await transport(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-openagent-nonce': options.nonce },
      body: JSON.stringify({ proof: correlation.proof }),
      signal: controller.signal,
      redirect: 'error',
      credentials: 'omit',
    });
    if (!response.ok) throw new IdentityVerificationError(
      response.status >= 500 ? 'authority_unavailable' : 'invalid_proof',
      'Remote identity verification was refused');
    if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      throw new IdentityVerificationError('authority_unavailable', 'Remote identity authority returned an invalid response');
    }
    const body = await readJson(response, 65_536);
    const identity = body && typeof body === 'object' && 'identity' in body
      ? (body as { identity: unknown }).identity : undefined;
    if (!validIdentity(identity) || identity.did !== correlation.did || identity.expiresAt > correlation.expiresAt ||
        identity.lineage.length !== correlation.lineage.length ||
        identity.lineage.some((did, index) => did !== correlation.lineage[index])) {
      throw new IdentityVerificationError('authority_unavailable', 'Remote identity authority returned an invalid identity');
    }
    return identity;
  } catch (error) {
    if (error instanceof IdentityVerificationError) throw error;
    throw new IdentityVerificationError('authority_unavailable', 'Remote identity authority is unavailable', { cause: error });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

function validIdentity(value: unknown): value is VerifiedAgentIdentity {
  try {
    assertVerifiedIdentity(value);
    return true;
  } catch {
    return false;
  }
}
