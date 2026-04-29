/**
 * OpenAgent Vercel Edge Middleware — runs at the edge before every request.
 *
 * Handles:
 *   /.well-known/openagent/*  — OpenAgent discovery & auth endpoints
 *   /oauth/token              — OIDC bridge token exchange
 *   /api/*                    — Authenticated API routes (agent DID injected)
 *   /*                        — Passes through (public routes)
 */

import { NextResponse, type NextRequest } from 'next/server';

/** Paths that require OpenAgent authentication. */
const PROTECTED_PREFIXES = ['/api/'];

/** Paths explicitly excluded from auth. */
const PUBLIC_PATHS = new Set([
  '/api/auth/callback',
  '/api/auth/login',
  '/api/health',
]);

/** Extract bearer token from request. */
function extractBearerToken(request: NextRequest): string | null {
  const auth = request.headers.get('authorization');
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match?.[1]) return match[1];
  }
  const custom = request.headers.get('x-openagent-token');
  if (custom) return custom.trim();
  const oa = request.nextUrl.searchParams.get('oa_token');
  if (oa) return oa.trim();
  return null;
}

/** JSON response helper. */
function jsonResponse(body: unknown, status = 200): NextResponse {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // ── Health check ──────────────────────────────────────────────────────────
  if (pathname === '/health') {
    return jsonResponse({ status: 'ok', service: 'openagent-vercel-edge' });
  }

  // ── Well-known endpoints ──────────────────────────────────────────────────
  if (pathname.startsWith('/.well-known/openagent/')) {
    return handleWellKnown(request, pathname);
  }

  // ── OIDC bridge ───────────────────────────────────────────────────────────
  if (pathname === '/oauth/token' && request.method === 'POST') {
    return handleOAuthToken(request);
  }

  // ── Public routes pass through ────────────────────────────────────────────
  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  // ── Protected API routes require auth ─────────────────────────────────────
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (!isProtected) {
    return NextResponse.next();
  }

  const token = extractBearerToken(request);
  if (!token) {
    return jsonResponse({ success: false, error: 'Authentication required' }, 401);
  }

  // Validate the token by calling the OAS resolver / AEGIS verifier.
  // In production, replace this with a real verification call.
  const verifierUrl = process.env.AEGIS_VERIFIER_URL;
  if (verifierUrl) {
    try {
      const verifyResponse = await fetch(`${verifierUrl}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ token }),
      });

      if (!verifyResponse.ok) {
        return jsonResponse({ success: false, error: 'Invalid token' }, 401);
      }

      const authCtx = (await verifyResponse.json()) as {
        did: string;
        root: string;
        scopes: string[];
      };

      // Inject authenticated context as headers for downstream API routes
      const response = NextResponse.next();
      response.headers.set('X-OpenAgent-DID', authCtx.did);
      response.headers.set('X-OpenAgent-Root', authCtx.root);
      response.headers.set('X-OpenAgent-Scopes', authCtx.scopes.join(','));
      return response;
    } catch {
      return jsonResponse({ success: false, error: 'Verification service unavailable' }, 503);
    }
  }

  // Stub mode: accept `stub:did:oas:*` tokens for local dev
  if (token.startsWith('stub:did:oas:')) {
    const did = token.slice('stub:'.length);
    const response = NextResponse.next();
    response.headers.set('X-OpenAgent-DID', did);
    response.headers.set('X-OpenAgent-Root', did);
    response.headers.set('X-OpenAgent-Scopes', '');
    return response;
  }

  return jsonResponse({ success: false, error: 'Invalid token format' }, 401);
}

// ─── Well-Known Handlers ─────────────────────────────────────────────────────

function handleWellKnown(request: NextRequest, pathname: string): NextResponse {
  const agentName = process.env.OPENAGENT_AGENT_NAME ?? 'vercel-agent';
  const parentDid = process.env.OPENAGENT_PARENT_DID ?? 'did:oas:l1fe:hmr:unconfigured';

  if (pathname === '/.well-known/openagent/agent.json') {
    return jsonResponse({
      did: `did:oas:l1fe:agent:${agentName}`,
      name: agentName,
      parent: parentDid,
      endpoints: {
        auth: '/.well-known/openagent/auth',
        challenge: '/.well-known/openagent/challenge',
      },
    });
  }

  if (pathname === '/.well-known/openagent/auth' && request.method === 'POST') {
    // Delegate to the API route for stateful operations
    return NextResponse.rewrite(new URL('/api/auth/openagent', request.url));
  }

  if (pathname === '/.well-known/openagent/challenge') {
    return NextResponse.rewrite(new URL('/api/auth/challenge', request.url));
  }

  return jsonResponse({ success: false, error: 'Not found' }, 404);
}

async function handleOAuthToken(request: NextRequest): Promise<NextResponse> {
  const issuerUrl = process.env.OIDC_ISSUER_URL;
  const clientId = process.env.OIDC_CLIENT_ID;
  const clientSecret = process.env.OIDC_CLIENT_SECRET;

  if (!issuerUrl || !clientId) {
    return jsonResponse({ success: false, error: 'OIDC bridge not configured' }, 501);
  }

  const contentType = request.headers.get('content-type') ?? '';
  let grantType: string;
  let code: string;
  let redirectUri: string;

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData();
    grantType = (form.get('grant_type') as string) ?? '';
    code = (form.get('code') as string) ?? '';
    redirectUri = (form.get('redirect_uri') as string) ?? '';
  } else {
    const body = (await request.json()) as Record<string, string>;
    grantType = body.grant_type ?? '';
    code = body.code ?? '';
    redirectUri = body.redirect_uri ?? '';
  }

  if (grantType !== 'authorization_code') {
    return jsonResponse({ success: false, error: 'Unsupported grant_type' }, 400);
  }

  const tokenUrl = `${issuerUrl}/token`;
  const upstream = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret ?? '',
    }),
  });

  if (!upstream.ok) {
    const errBody = await upstream.text();
    return jsonResponse(
      { success: false, error: `Upstream OIDC token exchange failed: ${errBody}` },
      502,
    );
  }

  const tokenData = await upstream.json();
  return jsonResponse({ success: true, data: tokenData });
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
