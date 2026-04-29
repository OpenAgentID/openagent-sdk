/**
 * Framework middleware factories for OAAP authentication.
 *
 * Works with Express, Hono, and any framework using the standard
 * Request/Response API.
 */

import type { SessionStore, ServerConfig, VerifySignatureFn, AuthResult } from './server.js';
import {
  authenticateRequest,
  handleDiscovery,
  handlePresent,
  handleProve,
  OaapServerError,
  InMemorySessionStore,
  createServerConfig,
} from './server.js';
import { CONTENT_TYPE_JSON } from './headers.js';

/** Options for creating OAAP middleware. */
export interface MiddlewareOptions {
  /** Server DID. */
  serverDid: string;
  /** Session store (default: in-memory). */
  store?: SessionStore;
  /** Required conformance level (default: L2). */
  requiredConformance?: 'L0' | 'L1' | 'L2';
  /** Session TTL in seconds (default: 300). */
  sessionTtlSecs?: number;
  /** Challenge expiry in seconds (default: 60). */
  challengeExpirySecs?: number;
  /** Signature verification function. */
  verifySignature: VerifySignatureFn;
  /** Paths to exclude from authentication (well-known paths are always excluded). */
  excludePaths?: string[];
}

/** Well-known paths that are always public (the handshake endpoints themselves). */
const OAAP_PUBLIC_PATHS = [
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
 * - Returns `undefined` for well-known routes (caller should send the JSON response)
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
   * Returns undefined for authenticated requests that should proceed to the app.
   */
  handle: (request: Request) => Promise<Response | AuthResult>;
} {
  const config = createServerConfig(options.serverDid, {
    requiredConformance: options.requiredConformance,
    sessionTtlSecs: options.sessionTtlSecs,
    challengeExpirySecs: options.challengeExpirySecs,
  });
  const store = options.store ?? new InMemorySessionStore();
  const excludePaths = [...OAAP_PUBLIC_PATHS, ...(options.excludePaths ?? [])];

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

    // Present endpoint.
    if (path === '/.well-known/openagent/auth' && request.method === 'POST') {
      try {
        const body: unknown = await request.json();
        const challenge = await handlePresent(config, store, body);
        return new Response(JSON.stringify(challenge), {
          status: 200,
          headers: { 'content-type': CONTENT_TYPE_JSON },
        });
      } catch (err) {
        if (err instanceof OaapServerError) {
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
        if (err instanceof OaapServerError) {
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

    // Check if path is excluded.
    if (excludePaths.some((p) => path === p || path.startsWith(p + '/'))) {
      return { authenticated: true, peerDid: 'excluded' };
    }

    // Authenticate the request.
    return authenticateRequest(request, store);
  };

  return { config, store, handle };
}

/**
 * Create Express-compatible middleware.
 *
 * Usage:
 * ```ts
 * app.use(createOpenAgentMiddleware({
 *   serverDid: 'did:oas:l1fe:service:api',
 *   verifySignature: async (did, payload, sig) => { ... },
 * }));
 * ```
 */
export function createOpenAgentMiddleware(options: MiddlewareOptions): (
  req: { url?: string; method?: string; headers: Record<string, string | string[] | undefined>; path?: string },
  res: { status: (code: number) => { json: (body: unknown) => void; end: () => void } },
  next: () => void,
) => Promise<void> {
  const { handle, store } = createOpenAgentHandler(options);

  return async (req, res, next) => {
    // Build a minimal Request-like object for the handler.
    const url = `http://localhost${req.path ?? req.url ?? '/'}`;
    const method = req.method ?? 'GET';
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') {
        headers.set(key, value);
      }
    }

    const request = new Request(url, { method, headers });
    const result = await handle(request);

    if (result instanceof Response) {
      const body = await result.text();
      res.status(result.status).json(JSON.parse(body));
      return;
    }

    // AuthResult
    if (!result.authenticated) {
      res.status(401).json({ error: result.error ?? 'Unauthorized' });
      return;
    }

    next();
  };
}
