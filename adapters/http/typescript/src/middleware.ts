/**
 * Framework middleware factories for Core Protocol authentication.
 *
 * Works with Express, Hono, and any framework using the standard
 * Request/Response API.
 */

import type { SessionStore, ServerConfig, VerifySignatureFn, ResolveIdentityKeyFn, AuthResult } from './server.js';
import {
  authenticateRequest,
  handleDiscovery,
  handleChallenge,
  handleProve,
  CoreAuthError,
  InMemorySessionStore,
  createServerConfig,
} from './server.js';
import { CONTENT_TYPE_JSON } from './headers.js';

/** Options for creating OAAP middleware. */
export interface MiddlewareOptions {
  /** Canonical public HTTP origin, for example https://api.example.com. */
  origin: string;
  /** Optional server DID advertised in discovery. */
  serverDid?: string;
  /** Current authoritative DID-to-authentication-key binding. */
  resolveIdentityKey: ResolveIdentityKeyFn;
  /** Session store (default: in-memory). */
  store?: SessionStore;
  /** Required conformance level (default: L2). */
  requiredConformance?: 'L0' | 'L1' | 'L2';
  /** Session TTL in seconds (default: 300). */
  sessionTtlSecs?: number;
  /** Challenge TTL in seconds (default: 60). */
  challengeTtlSecs?: number;
  /** Signature verification function. */
  verifySignature: VerifySignatureFn;
  /** Explicit public paths (including their descendants). */
  excludePaths?: string[];
}

/** Well-known paths that are always public (the handshake endpoints themselves). */
const OAAP_ENDPOINT_PATHS = [
  '/.well-known/openagent',
  '/.well-known/openagent/auth',
  '/.well-known/openagent/auth/prove',
];

/**
 * Create a generic OAAP middleware using the standard fetch Request/Response API.
 *
 * Returns a function that:
 * - Handles OAAP well-known endpoints
 * - Validates authenticated requests
 * - Returns a Response for handshake routes and an AuthResult for application routes
 *
 * Works with Hono, Cloudflare Workers, Deno, Bun, and any fetch-based framework.
 */
export function createOpenAgentHandler(options: MiddlewareOptions): {
  config: ServerConfig;
  store: SessionStore;
  /**
   * Handle an incoming request.
   *
   * Returns a Response for well-known endpoints and auth failures.
   * Returns an AuthResult for application routes; check authenticated before proceeding.
   */
  handle: (request: Request) => Promise<Response | AuthResult>;
} {
  const config = createServerConfig(options.origin, {
    serverDid: options.serverDid,
    resolveIdentityKey: options.resolveIdentityKey,
    requiredConformance: options.requiredConformance,
    sessionTtlSecs: options.sessionTtlSecs,
    challengeTtlSecs: options.challengeTtlSecs,
  });
  const store = options.store ?? new InMemorySessionStore();
  if (typeof store.take !== 'function' || typeof options.verifySignature !== 'function') {
    throw new TypeError('An atomic SessionStore.take and signature verifier are required');
  }
  const excludePaths = options.excludePaths ?? [];

  const handle = async (request: Request): Promise<Response | AuthResult> => {
    const url = new URL(request.url);
    const path = url.pathname;

    // Discovery endpoint.
    if (path === '/.well-known/openagent' && request.method === 'GET') {
      const doc = handleDiscovery(config);
      return new Response(JSON.stringify(doc), {
        status: 200,
        headers: { 'content-type': CONTENT_TYPE_JSON },
      });
    }

    // Challenge endpoint.
    if (path === '/.well-known/openagent/auth' && request.method === 'POST') {
      try {
        const challenge = await handleChallenge(config, store);
        return new Response(JSON.stringify(challenge), {
          status: 200,
          headers: { 'content-type': CONTENT_TYPE_JSON },
        });
      } catch (err) {
        if (err instanceof CoreAuthError) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: err.statusCode,
            headers: { 'content-type': CONTENT_TYPE_JSON },
          });
        }
        return new Response(JSON.stringify({ error: 'Invalid request' }), {
          status: 400,
          headers: { 'content-type': CONTENT_TYPE_JSON },
        });
      }
    }

    // Prove endpoint.
    if (path === '/.well-known/openagent/auth/prove' && request.method === 'POST') {
      try {
        const body: unknown = await request.json();
        const established = await handleProve(config, store, body, options.verifySignature);
        return new Response(JSON.stringify(established), {
          status: 200,
          headers: { 'content-type': CONTENT_TYPE_JSON },
        });
      } catch (err) {
        if (err instanceof CoreAuthError) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: err.statusCode,
            headers: { 'content-type': CONTENT_TYPE_JSON },
          });
        }
        return new Response(JSON.stringify({ error: 'Authentication failed' }), {
          status: 401,
          headers: { 'content-type': CONTENT_TYPE_JSON },
        });
      }
    }

    if (OAAP_ENDPOINT_PATHS.includes(path)) {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { 'content-type': CONTENT_TYPE_JSON },
      });
    }

    // Check if path is excluded.
    if (excludePaths.some((p) => path === p || path.startsWith(p + '/'))) {
      return { authenticated: true, peerDid: 'excluded' };
    }

    // Authenticate the request.
    return authenticateRequest(request, store, options.resolveIdentityKey);
  };

  return { config, store, handle };
}

/** Express-compatible middleware. Register express.json() before this handler.
 * Only handshake JSON is copied; application bodies remain untouched. Verified
 * request identity is exposed as req.openAgent, never read from caller headers. */
export function createOpenAgentMiddleware(options: MiddlewareOptions): (
  req: { url?: string; originalUrl?: string; method?: string;
    headers: Record<string, string | string[] | undefined>; body?: unknown; openAgent?: AuthResult },
  res: { status: (code: number) => { json: (body: unknown) => void } },
  next: (error?: unknown) => void,
) => Promise<void> {
  const { handle } = createOpenAgentHandler(options);
  return async (req, res, next) => {
    try {
      const url = new URL(req.originalUrl ?? req.url ?? '/', options.origin);
      const method = req.method ?? 'GET';
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(', '));
      }
      const isProof = url.pathname === '/.well-known/openagent/auth/prove' && method === 'POST';
      if (isProof && (req.body === undefined || !headers.get('content-type')?.startsWith('application/json'))) {
        res.status(400).json({ error: 'JSON proof body required; register express.json() before OpenAgent middleware' });
        return;
      }
      const request = new Request(url, { method, headers,
        ...(isProof ? { body: JSON.stringify(req.body) } : {}) });
      const result = await handle(request);
      if (result instanceof Response) {
        res.status(result.status).json(await result.json());
        return;
      }
      if (!result.authenticated) {
        res.status(401).json({ error: result.error ?? 'Unauthorized' });
        return;
      }
      req.openAgent = result;
      next();
    } catch (error) {
      next(error);
    }
  };
}
