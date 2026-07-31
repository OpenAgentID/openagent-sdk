/**
 * Verification middleware — one-liners for guarding routes with an ACT.
 *
 * The five-minute adoption moment: a service verifies the capability token
 * on an inbound request with no protocol machinery at all.
 *
 * ```ts
 * // Fetch-standard frameworks (Next.js route handlers, Hono, Workers):
 * export const POST = withAct(config, async (req, claims) => { ... });
 *
 * // Express:
 * app.use('/tools', requireActExpress(config));
 * ```
 */

import { act, type ActClaims } from './act.js';
import { VerificationError } from './errors.js';

/** Policy for the middleware: the verifier bindings plus optional scopes. */
export interface RequireActConfig {
  /** The trusted issuer string. */
  issuer: string;
  /** The audience this service answers for. */
  audience: string;
  /** Scopes every request must carry. Default: none. */
  scopes?: string[];
  /** Trusted Ed25519 public keys (raw 32 bytes each). */
  trustedKeys: Uint8Array[];
  /** Clock-skew allowance in seconds. Default: 0. */
  leewaySeconds?: number;
  /**
   * Extract the ACT envelope bytes from the request. Default: base64url of
   * the `Authorization: Bearer <token>` header value.
   */
  extractToken?: (req: Request) => Uint8Array | undefined;
  /**
   * Render the 401 response. Default: JSON `{ error }` with a
   * `WWW-Authenticate: OpenAgent` hint.
   */
  onUnauthorized?: (req: Request, reason: string) => Response;
}

function defaultExtract(req: Request): Uint8Array | undefined {
  const header = req.headers.get('authorization');
  if (!header) return undefined;
  const [scheme, ...rest] = header.trim().split(' ');
  const token = rest.join(' ').trim();
  if (
    !scheme ||
    !token ||
    (scheme.toLowerCase() !== 'bearer' && scheme.toLowerCase() !== 'openagent')
  ) {
    return undefined;
  }
  return base64UrlDecode(token);
}

function base64UrlDecode(input: string): Uint8Array {
  const b64 = input.replaceAll('-', '+').replaceAll('_', '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(padded, 'base64'));
  }
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function defaultUnauthorized(_req: Request, reason: string): Response {
  return new Response(JSON.stringify({ error: reason }), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'www-authenticate': 'OpenAgent',
    },
  });
}

/**
 * Fetch-standard middleware factory.
 *
 * Returns a handler that takes `(request, claims)`. A request whose token is
 * missing, malformed, forged, expired, wrong-audience, or under-scoped gets
 * a 401 with the reason — the handler never runs, and unauthenticated claims
 * never reach the application.
 */
export function withAct(
  config: RequireActConfig,
  handler: (req: Request, claims: ActClaims) => Promise<Response> | Response,
): (req: Request) => Promise<Response> {
  const extract = config.extractToken ?? defaultExtract;
  const onUnauthorized = config.onUnauthorized ?? defaultUnauthorized;

  return async (req: Request): Promise<Response> => {
    const token = extract(req);
    if (!token) {
      return onUnauthorized(req, 'missing or malformed capability token');
    }

    let claims: ActClaims;
    try {
      claims = await act
        .verify(token)
        .issuer(config.issuer)
        .forAudience(config.audience)
        .trustedKeys(config.trustedKeys)
        .withLeeway(config.leewaySeconds ?? 0)
        .requireScopes(config.scopes ?? [])
        .run();
    } catch (err) {
      const reason = err instanceof VerificationError ? err.message : 'verification failed';
      return onUnauthorized(req, reason);
    }

    return handler(req, claims);
  };
}

/**
 * Express-compatible middleware factory.
 *
 * On success, the verified claims land on `req.actClaims`; on failure the
 * request is rejected with a 401 and never reaches the route.
 */
export function requireActExpress(config: RequireActConfig) {
  const extract = config.extractToken ?? defaultExtract;
  const onUnauthorized = config.onUnauthorized ?? defaultUnauthorized;

  return async (
    req: { headers: Record<string, string | string[] | undefined>; actClaims?: ActClaims },
    res: { status: (code: number) => { json: (body: unknown) => unknown } },
    next: () => void,
  ): Promise<void> => {
    const headerValue = req.headers['authorization'];
    const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const headers = new Headers();
    if (header) headers.set('authorization', header);
    const request = new Request('http://localhost/', { headers });

    const token = extract(request);
    if (!token) {
      const rejection = onUnauthorized(request, 'missing or malformed capability token');
      res.status(rejection.status).json(await rejection.json());
      return;
    }

    try {
      const claims = await act
        .verify(token)
        .issuer(config.issuer)
        .forAudience(config.audience)
        .trustedKeys(config.trustedKeys)
        .withLeeway(config.leewaySeconds ?? 0)
        .requireScopes(config.scopes ?? [])
        .run();
      req.actClaims = claims;
      next();
    } catch (err) {
      const reason = err instanceof VerificationError ? err.message : 'verification failed';
      const rejection = onUnauthorized(request, reason);
      res.status(rejection.status).json(await rejection.json());
    }
  };
}
