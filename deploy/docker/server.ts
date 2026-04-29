/**
 * OpenAgent Docker Server — standalone auth gateway.
 *
 * Runs as a minimal HTTP server using Node's built-in http module.
 * No external framework dependencies beyond @openagent/sdk.
 *
 * Endpoints:
 *   GET  /health                              — Health check
 *   GET  /.well-known/openagent/agent.json    — Agent discovery
 *   POST /.well-known/openagent/auth          — Token authentication
 *   POST /.well-known/openagent/challenge      — Issue challenge
 *   POST /.well-known/openagent/challenge/verify — Verify challenge
 *   POST /oauth/token                          — OIDC bridge
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { OpenAgent, type OpenAgentConfig } from '@openagent/sdk';

const PORT = parseInt(process.env.PORT ?? '3100', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

const config: OpenAgentConfig = {
  endpoints: {
    oasResolver: process.env.OAS_RESOLVER_URL,
    arsenalBroker: process.env.ARSENAL_BROKER_URL,
    aegisVerifier: process.env.AEGIS_VERIFIER_URL,
  },
};

const runtime = OpenAgent.configure(config);

const agentName = process.env.OPENAGENT_AGENT_NAME ?? 'docker-agent';
const parentDid = process.env.OPENAGENT_PARENT_DID ?? 'did:oas:l1fe:hmr:unconfigured';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

function sendError(res: ServerResponse, message: string, status: number): void {
  sendJson(res, { success: false, error: message }, status);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function parseJsonBody(raw: string): Record<string, string> {
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Convert Node IncomingMessage to WHATWG Request. */
function toRequest(req: IncomingMessage, body: string): Request {
  const protocol = 'http';
  const host = req.headers.host ?? `${HOST}:${PORT}`;
  const url = `${protocol}://${host}${req.url ?? '/'}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      const headerValue = Array.isArray(value) ? value.join(', ') : value;
      headers.set(key, headerValue);
    }
  }

  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD' && body.length > 0;

  return new Request(url, {
    method,
    headers,
    body: hasBody ? body : undefined,
  });
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

function handleHealth(res: ServerResponse): void {
  sendJson(res, { status: 'ok', service: 'openagent-docker', uptime: process.uptime() });
}

function handleAgentJson(res: ServerResponse): void {
  sendJson(res, {
    did: `did:oas:l1fe:agent:${agentName}`,
    name: agentName,
    parent: parentDid,
    endpoints: {
      auth: '/.well-known/openagent/auth',
      challenge: '/.well-known/openagent/challenge',
    },
  });
}

async function handleAuth(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const request = toRequest(req, body);
  try {
    const ctx = await runtime.authenticate(request);
    sendJson(res, {
      success: true,
      data: {
        did: ctx.did,
        root: ctx.root,
        scopes: ctx.scopes,
        expiresAt: ctx.expiresAt,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Authentication failed';
    sendError(res, message, 401);
  }
}

async function handleChallenge(res: ServerResponse): Promise<void> {
  try {
    const { challenge, challengeId } = await runtime.verification().issueChallenge();
    const encoded = Buffer.from(challenge).toString('base64');
    sendJson(res, { success: true, data: { challengeId, challenge: encoded } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Challenge creation failed';
    sendError(res, message, 500);
  }
}

async function handleChallengeVerify(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);
  const body = parseJsonBody(raw);
  try {
    const ctx = await runtime.verification().verifyChallengeResponse({
      challengeId: body.challengeId ?? '',
      agentDid: body.agentDid ?? '',
      signatureBase64: body.signatureBase64 ?? '',
    });
    sendJson(res, { success: true, data: { did: ctx.did, scopes: ctx.scopes } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Challenge verification failed';
    sendError(res, message, 401);
  }
}

async function handleOAuthToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const issuerUrl = process.env.OIDC_ISSUER_URL;
  const clientId = process.env.OIDC_CLIENT_ID;
  if (!issuerUrl || !clientId) {
    sendError(res, 'OIDC bridge not configured', 501);
    return;
  }

  const raw = await readBody(req);
  const body = parseJsonBody(raw);
  if (body.grant_type !== 'authorization_code') {
    sendError(res, 'Unsupported grant_type', 400);
    return;
  }

  const tokenUrl = `${issuerUrl}/token`;
  const upstream = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: body.code ?? '',
      redirect_uri: body.redirect_uri ?? '',
      client_id: clientId,
      client_secret: process.env.OIDC_CLIENT_SECRET ?? '',
    }),
  });

  if (!upstream.ok) {
    const errBody = await upstream.text();
    sendError(res, `Upstream OIDC token exchange failed: ${errBody}`, 502);
    return;
  }

  const tokenData = await upstream.json();
  sendJson(res, { success: true, data: tokenData });
}

// ─── Router ──────────────────────────────────────────────────────────────────

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  try {
    if (path === '/health' && method === 'GET') {
      handleHealth(res);
      return;
    }

    if (path === '/.well-known/openagent/agent.json' && method === 'GET') {
      handleAgentJson(res);
      return;
    }

    if (path === '/.well-known/openagent/auth' && method === 'POST') {
      await handleAuth(req, res);
      return;
    }

    if (path === '/.well-known/openagent/challenge' && method === 'POST') {
      await handleChallenge(res);
      return;
    }

    if (path === '/.well-known/openagent/challenge/verify' && method === 'POST') {
      await handleChallengeVerify(req, res);
      return;
    }

    if (path === '/oauth/token' && method === 'POST') {
      await handleOAuthToken(req, res);
      return;
    }

    sendError(res, 'Not found', 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    sendError(res, message, 500);
  }
}

// ─── Server ──────────────────────────────────────────────────────────────────

const server = createServer((req, res) => {
  route(req, res).catch((err) => {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    sendError(res, message, 500);
  });
});

server.listen(PORT, HOST, () => {
  const addr = `http://${HOST}:${PORT}`;
  process.stdout.write(`OpenAgent auth server listening on ${addr}\n`);
  process.stdout.write(`  Agent: ${agentName}\n`);
  process.stdout.write(`  Parent: ${parentDid}\n`);
  process.stdout.write(`  Health: ${addr}/health\n`);
});
