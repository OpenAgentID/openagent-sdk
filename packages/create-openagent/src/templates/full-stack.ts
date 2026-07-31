/**
 * Template: full-stack — Agent + MCP server + Web dashboard combined.
 */

import type { TemplateFile } from '../scaffold.js';
import type { ProjectOptions } from '../prompts.js';

export function generateFullStackTemplate(options: ProjectOptions): TemplateFile[] {
  return [
    { path: 'package.json', content: packageJson(options) },
    { path: 'next.config.ts', content: nextConfig() },
    { path: 'src/app/layout.tsx', content: layoutTsx(options) },
    { path: 'src/app/page.tsx', content: pageTsx(options) },
    { path: 'src/app/api/auth/route.ts', content: authRoute() },
    { path: 'src/app/api/agents/route.ts', content: agentsRoute() },
    { path: 'src/lib/openagent.ts', content: openagentLib() },
    { path: 'src/lib/auth.ts', content: authLib(options) },
    { path: 'src/tools/echo.ts', content: echoToolTs() },
    { path: 'src/tools/index.ts', content: toolsIndexTs() },
    { path: 'README.md', content: readme(options) },
  ];
}

function packageJson(options: ProjectOptions): string {
  const deps: Record<string, string> = {
    '@openagentid/sdk': '^0.1.0',
    '@modelcontextprotocol/sdk': '^1.0.0',
    next: '^15.0.0',
    react: '^19.0.0',
    'react-dom': '^19.0.0',
  };

  if (options.bioagentic) {
    deps['@openagentid/bioagentic'] = '^0.1.0';
  }

  if (options.fabrics) {
    deps['@openagentid/fabrics'] = '^0.1.0';
  }

  return JSON.stringify(
    {
      name: options.projectName,
      version: '0.1.0',
      private: true,
      scripts: {
        dev: 'next dev',
        build: 'next build',
        start: 'next start',
        typecheck: 'tsc --noEmit',
      },
      dependencies: deps,
      devDependencies: {
        '@types/node': '^20.11.30',
        '@types/react': '^19.0.0',
        '@types/react-dom': '^19.0.0',
        typescript: '^5.4.5',
      },
    },
    null,
    2,
  );
}

function nextConfig(): string {
  return `import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default config;
`;
}

function layoutTsx(options: ProjectOptions): string {
  return `import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: '${options.projectName} — OpenAgent Full Stack',
  description: 'Full-stack agent platform powered by OpenAgent.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: '2rem' }}>
        <header style={{ borderBottom: '1px solid #eee', paddingBottom: '1rem', marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '1.5rem', margin: 0 }}>
            ${options.projectName}
          </h1>
          <p style={{ color: '#666', margin: '0.25rem 0 0' }}>OpenAgent Full Stack</p>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
`;
}

function pageTsx(options: ProjectOptions): string {
  return `/**
 * Dashboard home — agent status, tools, and management.
 */

import { tools } from '@/tools';

export default async function HomePage() {
  const agentName = process.env.OPENAGENT_AGENT_NAME ?? '${options.projectName}';
  const parentDid = process.env.OPENAGENT_PARENT_DID ?? 'did:oas:l1fe:hmr:unconfigured';

  return (
    <div>
      <section style={{ marginBottom: '2rem' }}>
        <h2>Agent Status</h2>
        <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: '600px' }}>
          <tbody>
            <tr>
              <td style={{ padding: '0.5rem', fontWeight: 'bold' }}>Name</td>
              <td style={{ padding: '0.5rem' }}>{agentName}</td>
            </tr>
            <tr>
              <td style={{ padding: '0.5rem', fontWeight: 'bold' }}>Parent DID</td>
              <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                {parentDid}
              </td>
            </tr>
            <tr>
              <td style={{ padding: '0.5rem', fontWeight: 'bold' }}>Status</td>
              <td style={{ padding: '0.5rem', color: '#22c55e' }}>Active</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2>Available Tools</h2>
        <ul style={{ lineHeight: 2 }}>
          {tools.map((tool) => (
            <li key={tool.name}>
              <code>{tool.name}</code> — {tool.description}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>API Endpoints</h2>
        <ul style={{ lineHeight: 2 }}>
          <li><code>GET /api/agents</code> — List managed agents</li>
          <li><code>POST /api/agents</code> — Create a new agent</li>
          <li><code>POST /api/auth</code> — Authenticate request</li>
        </ul>
      </section>
    </div>
  );
}
`;
}

function authRoute(): string {
  return `/**
 * POST /api/auth — Authenticate an incoming agent request.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getRuntime } from '@/lib/openagent';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const runtime = getRuntime();

  try {
    const ctx = await runtime.authenticate(request as unknown as Request);
    return NextResponse.json({
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
    return NextResponse.json({ success: false, error: message }, { status: 401 });
  }
}
`;
}

function agentsRoute(): string {
  return `/**
 * GET /api/agents — List managed agents.
 * POST /api/agents — Create a new agent.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getRuntime } from '@/lib/openagent';

const agents: Array<{ did: string; name: string; createdAt: string }> = [];

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ success: true, data: agents });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const runtime = getRuntime();

  try {
    const body = (await request.json()) as { name: string; scopes: string[] };

    if (!body.name || !body.scopes?.length) {
      return NextResponse.json(
        { success: false, error: 'name and scopes are required' },
        { status: 400 },
      );
    }

    const parentDid = process.env.OPENAGENT_PARENT_DID ?? 'did:oas:l1fe:hmr:unconfigured';
    const agent = await runtime.createAgent({
      parent: parentDid,
      name: body.name,
      scopes: body.scopes,
    });

    const record = {
      did: agent.did,
      name: body.name,
      createdAt: new Date().toISOString(),
    };
    agents.push(record);

    return NextResponse.json({ success: true, data: record }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Agent creation failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
`;
}

function openagentLib(): string {
  return `/**
 * OpenAgent SDK setup — shared runtime instance.
 */

import { OpenAgent, type OpenAgentRuntime } from '@openagentid/sdk';

let runtime: OpenAgentRuntime | undefined;

export function getRuntime(): OpenAgentRuntime {
  if (!runtime) {
    runtime = OpenAgent.configure({
      endpoints: {
        oasResolver: process.env.OAS_RESOLVER_URL,
        arsenalBroker: process.env.ARSENAL_BROKER_URL,
        aegisVerifier: process.env.AEGIS_VERIFIER_URL,
      },
    });
  }
  return runtime;
}
`;
}

function authLib(options: ProjectOptions): string {
  const oidcPart =
    options.bridge === 'oidc'
      ? `

export const oidcConfig = {
  issuerUrl: process.env.OIDC_ISSUER_URL,
  clientId: process.env.OIDC_CLIENT_ID,
  clientSecret: process.env.OIDC_CLIENT_SECRET,
  redirectUri: process.env.OIDC_REDIRECT_URI ?? 'http://localhost:3000/api/auth/callback',
} as const;

export function isOidcConfigured(): boolean {
  return Boolean(oidcConfig.issuerUrl && oidcConfig.clientId);
}
`
      : '';

  return `/**
 * Authentication configuration — human + agent auth.
 */

import { getRuntime } from './openagent.js';

export async function authenticateRequest(request: Request) {
  const runtime = getRuntime();
  try {
    return await runtime.authenticate(request);
  } catch {
    return null;
  }
}
${oidcPart}`;
}

function echoToolTs(): string {
  return `/**
 * Echo tool — returns the input unchanged. Useful for testing.
 */

import type { McpTool } from './index.js';

export const echoTool: McpTool = {
  name: 'echo',
  description: 'Returns the input unchanged.',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Message to echo back.' },
    },
    required: ['message'],
  },
  async execute(input) {
    return { echoed: input };
  },
};
`;
}

function toolsIndexTs(): string {
  return `/**
 * Tool registry — add your tools here.
 */

import { echoTool } from './echo.js';

export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<unknown>;
}

export const tools: readonly McpTool[] = [echoTool];
`;
}

function readme(options: ProjectOptions): string {
  return `# ${options.projectName}

A full-stack OpenAgent application: agent identity, MCP tools, and web dashboard.

## Setup

\`\`\`bash
npm install
cp .env.example .env
\`\`\`

## Development

\`\`\`bash
npm run dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000).

## Structure

- \`src/app/\` — Next.js app directory (dashboard + API routes)
- \`src/lib/\` — OpenAgent SDK setup and auth configuration
- \`src/tools/\` — MCP tool implementations

## Adding Tools

1. Create a new file in \`src/tools/\`
2. Export an \`McpTool\` object
3. Add it to the \`tools\` array in \`src/tools/index.ts\`

## Learn More

- [OpenAgent Docs](https://openagent.id/docs)
- [MCP Specification](https://modelcontextprotocol.io)
- [Next.js Docs](https://nextjs.org/docs)
`;
}
