/**
 * OpenAgent AWS Lambda Handler — serverless auth gateway.
 *
 * Handles:
 *   GET  /.well-known/openagent/agent.json  — Agent discovery
 *   POST /.well-known/openagent/auth        — Token authentication
 *   POST /.well-known/openagent/challenge    — Issue challenge
 *   POST /.well-known/openagent/challenge/verify — Verify challenge
 *   POST /oauth/token                        — OIDC bridge
 *   GET  /health                             — Health check
 *
 * Deploy via SAM or CDK (see template.yaml).
 */

import { OpenAgent, type OpenAgentConfig } from '@openagentid/sdk';

interface LambdaEvent {
  readonly httpMethod: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string | null;
  readonly isBase64Encoded: boolean;
  readonly queryStringParameters: Readonly<Record<string, string | undefined>> | null;
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/** Environment variables. */
const env = {
  parentDid: (): string => process.env.OPENAGENT_PARENT_DID ?? 'did:oas:l1fe:hmr:unconfigured',
  agentName: (): string => process.env.OPENAGENT_AGENT_NAME ?? 'lambda-agent',
  oasResolverUrl: (): string | undefined => process.env.OAS_RESOLVER_URL,
  arsenalBrokerUrl: (): string | undefined => process.env.ARSENAL_BROKER_URL,
  aegisVerifierUrl: (): string | undefined => process.env.AEGIS_VERIFIER_URL,
  oidcIssuerUrl: (): string | undefined => process.env.OIDC_ISSUER_URL,
  oidcClientId: (): string | undefined => process.env.OIDC_CLIENT_ID,
  oidcClientSecret: (): string | undefined => process.env.OIDC_CLIENT_SECRET,
} as const;

function buildConfig(): OpenAgentConfig {
  return {
    endpoints: {
      oasResolver: env.oasResolverUrl(),
      arsenalBroker: env.arsenalBrokerUrl(),
      aegisVerifier: env.aegisVerifierUrl(),
    },
  };
}

function jsonResponse(body: unknown, statusCode = 200): LambdaResponse {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
    body: JSON.stringify(body),
  };
}

function errorResponse(message: string, statusCode: number): LambdaResponse {
  return jsonResponse({ success: false, error: message }, statusCode);
}

/** Convert Lambda event to a WHATWG Request for SDK compatibility. */
function toRequest(event: LambdaEvent): Request {
  const protocol = 'https';
  const host = event.headers.host ?? event.headers.Host ?? 'localhost';
  const url = `${protocol}://${host}${event.path}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers)) {
    if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const hasBody = event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD' && event.body;
  const body = hasBody
    ? event.isBase64Encoded
      ? Buffer.from(event.body as string, 'base64')
      : event.body
    : undefined;

  return new Request(url, {
    method: event.httpMethod,
    headers,
    body: body as BodyInit | undefined,
  });
}

function parseBody(event: LambdaEvent): Record<string, string> {
  if (!event.body) return {};
  try {
    const decoded = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;
    return JSON.parse(decoded) as Record<string, string>;
  } catch {
    return {};
  }
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

function handleAgentJson(): LambdaResponse {
  return jsonResponse({
    did: `did:oas:l1fe:agent:${env.agentName()}`,
    name: env.agentName(),
    parent: env.parentDid(),
    endpoints: {
      auth: '/.well-known/openagent/auth',
      challenge: '/.well-known/openagent/challenge',
    },
  });
}

async function handleAuth(event: LambdaEvent): Promise<LambdaResponse> {
  const runtime = OpenAgent.configure(buildConfig());
  const request = toRequest(event);
  try {
    const ctx = await runtime.authenticate(request);
    return jsonResponse({
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
    return errorResponse(message, 401);
  }
}

async function handleChallenge(): Promise<LambdaResponse> {
  const runtime = OpenAgent.configure(buildConfig());
  try {
    const { challenge, challengeId } = await runtime.verification().issueChallenge();
    const encoded = Buffer.from(challenge).toString('base64');
    return jsonResponse({
      success: true,
      data: { challengeId, challenge: encoded },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Challenge creation failed';
    return errorResponse(message, 500);
  }
}

async function handleChallengeVerify(event: LambdaEvent): Promise<LambdaResponse> {
  const runtime = OpenAgent.configure(buildConfig());
  const body = parseBody(event);
  try {
    const ctx = await runtime.verification().verifyChallengeResponse({
      challengeId: body.challengeId ?? '',
      agentDid: body.agentDid ?? '',
      signatureBase64: body.signatureBase64 ?? '',
    });
    return jsonResponse({ success: true, data: { did: ctx.did, scopes: ctx.scopes } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Challenge verification failed';
    return errorResponse(message, 401);
  }
}

async function handleOAuthToken(event: LambdaEvent): Promise<LambdaResponse> {
  const issuerUrl = env.oidcIssuerUrl();
  const clientId = env.oidcClientId();
  if (!issuerUrl || !clientId) {
    return errorResponse('OIDC bridge not configured', 501);
  }

  const body = parseBody(event);
  if (body.grant_type !== 'authorization_code') {
    return errorResponse('Unsupported grant_type', 400);
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
      client_secret: env.oidcClientSecret() ?? '',
    }),
  });

  if (!upstream.ok) {
    const errBody = await upstream.text();
    return errorResponse(`Upstream OIDC token exchange failed: ${errBody}`, 502);
  }

  const tokenData = await upstream.json();
  return jsonResponse({ success: true, data: tokenData });
}

// ─── Main Handler ────────────────────────────────────────────────────────────

export async function handler(event: LambdaEvent): Promise<LambdaResponse> {
  const { httpMethod: method, path } = event;

  if (path === '/health' && method === 'GET') {
    return jsonResponse({ status: 'ok', service: 'openagent-lambda' });
  }

  if (path === '/.well-known/openagent/agent.json' && method === 'GET') {
    return handleAgentJson();
  }

  if (path === '/.well-known/openagent/auth' && method === 'POST') {
    return handleAuth(event);
  }

  if (path === '/.well-known/openagent/challenge' && method === 'POST') {
    return handleChallenge();
  }

  if (path === '/.well-known/openagent/challenge/verify' && method === 'POST') {
    return handleChallengeVerify(event);
  }

  if (path === '/oauth/token' && method === 'POST') {
    return handleOAuthToken(event);
  }

  return errorResponse('Not found', 404);
}
