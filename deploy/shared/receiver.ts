import { act, didSchema, DID_REGEX, LEGACY_DID_REGEX, type ActClaims } from '@openagentid/sdk';

export interface ReceiverEnvironment {
  [key: string]: string | undefined;
  OPENAGENT_ISSUER?: string;
  OPENAGENT_AUDIENCE?: string;
  OPENAGENT_TENANT?: string;
  /** JSON array of base64url-encoded 32-byte broker public keys. No private keys. */
  OPENAGENT_PUBLIC_KEYS?: string;
  OPENAGENT_REQUIRED_SCOPE?: string;
  /** JSON arrays, applied on every request. Empty arrays are explicit configuration. */
  OPENAGENT_REVOKED_TOKEN_IDS?: string;
  OPENAGENT_REVOKED_SUBJECTS?: string;
}

function required(value: string | undefined): string {
  if (!value || value.length > 2048 || value.trim() !== value || /[\r\n]/.test(value)) throw new Error('Missing or invalid receiver policy');
  return value;
}
function list(value: string | undefined): string[] {
  const parsed: unknown = JSON.parse(required(value));
  if (!Array.isArray(parsed) || parsed.length > 10_000 || parsed.some(v => typeof v !== 'string' || !v || v.length > 2048)) {
    throw new Error('Invalid receiver policy array');
  }
  return parsed;
}
function decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new Error('Invalid base64url');
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
function policy(env: ReceiverEnvironment) {
  const issuer = required(env.OPENAGENT_ISSUER);
  const audience = required(env.OPENAGENT_AUDIENCE);
  const tenant = required(env.OPENAGENT_TENANT);
  const scope = required(env.OPENAGENT_REQUIRED_SCOPE);
  if (!/^[^:*\s]+:[^:*\s]+:[^:*\s]+$/.test(scope)) throw new Error('One literal required scope is required');
  const keys = list(env.OPENAGENT_PUBLIC_KEYS).map(decode);
  if (!keys.length || keys.length > 16 || keys.some(key => key.length !== 32)) throw new Error('Invalid broker public keys');
  return { issuer, audience, tenant, scope, keys, revokedIds: list(env.OPENAGENT_REVOKED_TOKEN_IDS),
    revokedSubjects: list(env.OPENAGENT_REVOKED_SUBJECTS) };
}

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  } });
}

/** One complete protected route. No identity is accepted from request headers. */
export async function handleAgentRequest(request: Request, env: ReceiverEnvironment): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/health' && request.method === 'GET') return json({ status: 'ok', service: 'openagent-receiver' });
  if (url.pathname !== '/api/agent') return json({ error: 'not_found' }, 404);
  if (request.method !== 'GET' && request.method !== 'POST') {
    const response = json({ error: 'method_not_allowed' }, 405);
    response.headers.set('allow', 'GET, POST');
    return response;
  }
  let configured: ReturnType<typeof policy>;
  try { configured = policy(env); } catch { return json({ error: 'receiver_not_configured' }, 503); }
  let claims: ActClaims;
  try {
    const authorization = request.headers.get('authorization');
    if (!authorization || authorization.length > 24_000) throw new Error('Missing token');
    const match = /^Bearer ([A-Za-z0-9_-]+)$/i.exec(authorization);
    if (!match) throw new Error('Invalid token');
    claims = await act.verify(decode(match[1]!)).issuer(configured.issuer).forAudience(configured.audience)
      .trustedKeys(configured.keys).requireScope(configured.scope)
      // Explicit host clock also works with SDK 0.7.2 / crypto-wasm 0.1.1.
      .atTime(Math.floor(Date.now() / 1000)).run();
    const kind = (DID_REGEX.exec(claims.sub) ?? LEGACY_DID_REGEX.exec(claims.sub))?.[1];
    if (claims.tenant_id !== configured.tenant || claims.cnf || claims.exp - claims.iat > 300
      || !didSchema.safeParse(claims.sub).success || (kind !== 'agent' && kind !== 'agent:instance')
      || configured.revokedIds.includes(claims.jti) || configured.revokedSubjects.includes(claims.sub)) {
      throw new Error('Capability policy refused');
    }
  } catch {
    const response = json({ error: 'invalid_capability' }, 401);
    response.headers.set('www-authenticate', 'Bearer realm="openagent"');
    return response;
  }
  const identity = { did: claims.sub, tenant: claims.tenant_id, scopes: claims.scope, expiresAt: claims.exp };
  if (request.method === 'GET') return json(identity);
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    return json({ error: 'json_required' }, 415);
  }
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 16_384)) return json({ error: 'body_too_large' }, 413);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: 'invalid_request' }, 400);
  try {
    let bytes = 0;
    let text = '';
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 16_384) return json({ error: 'body_too_large' }, 413);
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).join(',') !== 'message'
      || typeof (data as { message?: unknown }).message !== 'string'
      || !(data as { message: string }).message || (data as { message: string }).message.length > 4096) {
      return json({ error: 'invalid_request' }, 400);
    }
    return json({ ...identity, message: (data as { message: string }).message });
  } catch { return json({ error: 'invalid_request' }, 400); }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
