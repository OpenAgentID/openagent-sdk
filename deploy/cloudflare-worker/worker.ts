/**
 * OpenAgent Cloudflare Worker — drop-in serverless auth gateway.
 *
 * Handles:
 *   /.well-known/openagent/*   — OpenAgent discovery & auth endpoints
 *   /oauth/token               — OIDC bridge token exchange
 *   /*                         — Proxy with authenticated context
 *
 * Deploy: `wrangler deploy`
 */

import { OpenAgent, type AuthContext, type OpenAgentConfig } from '@openagent/sdk';

export interface Env {
  /** KV namespace for session and challenge state. */
  OPENAGENT_SESSIONS: KVNamespace;
  /** Optional D1 database for agent DID storage. */
  OPENAGENT_DB?: D1Database;
  /** Parent DID of this worker's agent identity. */
  OPENAGENT_PARENT_DID: string;
  /** Agent name registered in OAS. */
  OPENAGENT_AGENT_NAME: string;
  /** OAS resolver endpoint. */
  OAS_RESOLVER_URL?: string;
  /** Arsenal broker endpoint. */
  ARSENAL_BROKER_URL?: string;
  /** AEGIS verifier endpoint. */
  AEGIS_VERIFIER_URL?: string;
  /** OIDC issuer for the bridge (e.g. your IdP). */
  OIDC_ISSUER_URL?: string;
  /** OIDC client ID. */
  OIDC_CLIENT_ID?: string;
  /** OIDC client secret. */
  OIDC_CLIENT_SECRET?: string;
  /** Upstream origin to proxy authenticated requests to. */
  UPSTREAM_ORIGIN?: string;
}

/** Initialize the OpenAgent runtime for a given environment. */
function buildConfig(env: Env): OpenAgentConfig {
  return {
    endpoints: {
      oasResolver: env.OAS_RESOLVER_URL,
      arsenalBroker: env.ARSENAL_BROKER_URL,
      aegisVerifier: env.AEGIS_VERIFIER_URL,
    },
  };
}

/** JSON helper. */
function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

/** Error response helper. */
function errorJson(message: string, status: number): Response {
  return json({ success: false, error: message }, status);
}

// ─── Well-Known Endpoints ────────────────────────────────────────────────────

async function handleWellKnown(
  request: Request,
  path: string,
  env: Env,
): Promise<Response> {
  if (path === '/.well-known/openagent/agent.json') {
    return json({
      did: `did:oas:l1fe:agent:${env.OPENAGENT_AGENT_NAME}`,
      name: env.OPENAGENT_AGENT_NAME,
      parent: env.OPENAGENT_PARENT_DID,
      endpoints: {
        auth: '/.well-known/openagent/auth',
        challenge: '/.well-known/openagent/challenge',
      },
    });
  }

  if (path === '/.well-known/openagent/auth' && request.method === 'POST') {
    return handleAuthEndpoint(request, env);
  }

  if (path === '/.well-known/openagent/challenge' && request.method === 'POST') {
    return handleChallengeEndpoint(request, env);
  }

  if (path === '/.well-known/openagent/challenge/verify' && request.method === 'POST') {
    return handleChallengeVerifyEndpoint(request, env);
  }

  return errorJson('Not found', 404);
}

async function handleAuthEndpoint(request: Request, env: Env): Promise<Response> {
  const runtime = OpenAgent.configure(buildConfig(env));
  try {
    const ctx = await runtime.authenticate(request);
    const sessionId = crypto.randomUUID();
    await env.OPENAGENT_SESSIONS.put(
      `session:${sessionId}`,
      JSON.stringify(ctx),
      { expirationTtl: ctx.expiresAt - Math.floor(Date.now() / 1000) },
    );
    return json({
      success: true,
      data: {
        sessionId,
        did: ctx.did,
        root: ctx.root,
        scopes: ctx.scopes,
        expiresAt: ctx.expiresAt,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Authentication failed';
    return errorJson(message, 401);
  }
}

async function handleChallengeEndpoint(_request: Request, env: Env): Promise<Response> {
  const runtime = OpenAgent.configure(buildConfig(env));
  try {
    const { challenge, challengeId } = await runtime.verification().issueChallenge();
    const encoded = btoa(String.fromCharCode(...challenge));
    await env.OPENAGENT_SESSIONS.put(
      `challenge:${challengeId}`,
      encoded,
      { expirationTtl: 300 },
    );
    return json({
      success: true,
      data: { challengeId, challenge: encoded },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Challenge creation failed';
    return errorJson(message, 500);
  }
}

async function handleChallengeVerifyEndpoint(request: Request, env: Env): Promise<Response> {
  const runtime = OpenAgent.configure(buildConfig(env));
  try {
    const body = (await request.json()) as {
      challengeId: string;
      agentDid: string;
      signatureBase64: string;
    };
    const ctx = await runtime.verification().verifyChallengeResponse({
      challengeId: body.challengeId,
      agentDid: body.agentDid,
      signatureBase64: body.signatureBase64,
    });
    await env.OPENAGENT_SESSIONS.delete(`challenge:${body.challengeId}`);
    return json({ success: true, data: { did: ctx.did, scopes: ctx.scopes } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Challenge verification failed';
    return errorJson(message, 401);
  }
}

// ─── OIDC Bridge ─────────────────────────────────────────────────────────────

async function handleOAuthToken(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return errorJson('Method not allowed', 405);
  }
  if (!env.OIDC_ISSUER_URL || !env.OIDC_CLIENT_ID) {
    return errorJson('OIDC bridge not configured', 501);
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
    return errorJson('Unsupported grant_type', 400);
  }

  // Exchange code with upstream IdP
  const tokenUrl = `${env.OIDC_ISSUER_URL}/token`;
  const upstreamResponse = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: env.OIDC_CLIENT_ID,
      client_secret: env.OIDC_CLIENT_SECRET ?? '',
    }),
  });

  if (!upstreamResponse.ok) {
    const errBody = await upstreamResponse.text();
    return errorJson(`Upstream OIDC token exchange failed: ${errBody}`, 502);
  }

  const tokenData = (await upstreamResponse.json()) as Record<string, unknown>;
  return json({
    success: true,
    data: tokenData,
  });
}

// ─── Upstream Proxy ──────────────────────────────────────────────────────────

async function proxyWithAuth(
  request: Request,
  env: Env,
  ctx: AuthContext,
): Promise<Response> {
  const origin = env.UPSTREAM_ORIGIN;
  if (!origin) {
    return errorJson('No upstream origin configured', 502);
  }

  const url = new URL(request.url);
  const targetUrl = `${origin}${url.pathname}${url.search}`;

  const headers = new Headers(request.headers);
  headers.set('X-OpenAgent-DID', ctx.did);
  headers.set('X-OpenAgent-Root', ctx.root);
  headers.set('X-OpenAgent-Scopes', ctx.scopes.join(','));

  return fetch(targetUrl, {
    method: request.method,
    headers,
    body: request.body,
  });
}

// ─── Main Handler ────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Health check
    if (path === '/health') {
      return json({ status: 'ok', service: 'openagent-worker' });
    }

    // OpenAgent well-known endpoints
    if (path.startsWith('/.well-known/openagent/')) {
      return handleWellKnown(request, path, env);
    }

    // OIDC bridge token endpoint
    if (path === '/oauth/token') {
      return handleOAuthToken(request, env);
    }

    // All other requests: authenticate then proxy
    const runtime = OpenAgent.configure(buildConfig(env));
    try {
      const authCtx = await runtime.authenticate(request);
      return proxyWithAuth(request, env, authCtx);
    } catch {
      return errorJson('Unauthorized', 401);
    }
  },
} satisfies ExportedHandler<Env>;
