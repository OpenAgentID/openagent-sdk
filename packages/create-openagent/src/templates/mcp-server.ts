/**
 * Template: mcp-server — MCP server with OpenAgent auth middleware.
 */

import type { TemplateFile } from '../scaffold.js';
import type { ProjectOptions } from '../prompts.js';

export function generateMcpServerTemplate(options: ProjectOptions): TemplateFile[] {
  return [
    { path: 'package.json', content: packageJson(options) },
    { path: 'src/index.ts', content: indexTs() },
    { path: 'src/server.ts', content: serverTs(options) },
    { path: 'src/tools/echo.ts', content: echoToolTs() },
    { path: 'src/tools/index.ts', content: toolsIndexTs() },
    { path: 'README.md', content: readme(options) },
  ];
}

function packageJson(options: ProjectOptions): string {
  const deps: Record<string, string> = {
    '@openagent/sdk': '^0.1.0',
    '@modelcontextprotocol/sdk': '^1.0.0',
  };

  if (options.bioagentic) {
    deps['@openagent/bioagentic'] = '^0.1.0';
  }

  if (options.fabrics) {
    deps['@openagent/fabrics'] = '^0.1.0';
  }

  return JSON.stringify(
    {
      name: options.projectName,
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: {
        build: 'tsup src/index.ts --format esm --target node20',
        start: 'node dist/index.js',
        dev: 'tsx src/index.ts',
        typecheck: 'tsc --noEmit',
      },
      dependencies: deps,
      devDependencies: {
        '@types/node': '^20.11.30',
        tsup: '^8.0.2',
        tsx: '^4.7.0',
        typescript: '^5.4.5',
      },
    },
    null,
    2,
  );
}

function indexTs(): string {
  return `/**
 * Entry point — starts the MCP server.
 */

import { startServer } from './server.js';

startServer().catch((err) => {
  process.stderr.write(\`Fatal: \${err instanceof Error ? err.message : String(err)}\\n\`);
  process.exit(1);
});
`;
}

function serverTs(options: ProjectOptions): string {
  return `/**
 * MCP Server with OpenAgent authentication middleware.
 *
 * Authenticates incoming tool calls using the OpenAgent SDK before
 * dispatching to tool handlers.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { OpenAgent, type AuthContext } from '@openagent/sdk';
import { tools } from './tools/index.js';

const PORT = parseInt(process.env.PORT ?? '3200', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

/** Configure OpenAgent runtime. */
OpenAgent.configure({
  endpoints: {
    oasResolver: process.env.OAS_RESOLVER_URL,
    arsenalBroker: process.env.ARSENAL_BROKER_URL,
    aegisVerifier: process.env.AEGIS_VERIFIER_URL,
  },
});

function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/** Convert IncomingMessage to WHATWG Request. */
function toRequest(req: IncomingMessage, body: string): Request {
  const host = req.headers.host ?? \`\${HOST}:\${PORT}\`;
  const url = \`http://\${host}\${req.url ?? '/'}\`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
  }
  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD' && body.length > 0;
  return new Request(url, { method, headers, body: hasBody ? body : undefined });
}

/** Authenticate the request and return the auth context, or null. */
async function authenticate(
  req: IncomingMessage,
  body: string,
): Promise<AuthContext | null> {
  const request = toRequest(req, body);
  try {
    return await OpenAgent.authenticate(request);
  } catch {
    return null;
  }
}

interface McpRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

async function handleMcpRequest(
  mcpReq: McpRequest,
  _authCtx: AuthContext,
): Promise<unknown> {
  if (mcpReq.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id: mcpReq.id,
      result: {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      },
    };
  }

  if (mcpReq.method === 'tools/call') {
    const toolName = (mcpReq.params?.name as string) ?? '';
    const args = (mcpReq.params?.arguments as Record<string, unknown>) ?? {};
    const tool = tools.find((t) => t.name === toolName);

    if (!tool) {
      return {
        jsonrpc: '2.0',
        id: mcpReq.id,
        error: { code: -32601, message: \`Tool not found: \${toolName}\` },
      };
    }

    const result = await tool.execute(args);
    return {
      jsonrpc: '2.0',
      id: mcpReq.id,
      result: { content: [{ type: 'text', text: JSON.stringify(result) }] },
    };
  }

  return {
    jsonrpc: '2.0',
    id: mcpReq.id,
    error: { code: -32601, message: \`Method not found: \${mcpReq.method}\` },
  };
}

export async function startServer(): Promise<void> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', \`http://\${req.headers.host ?? 'localhost'}\`);

    if (url.pathname === '/health') {
      sendJson(res, { status: 'ok', service: '${options.projectName}' });
      return;
    }

    if (url.pathname === '/.well-known/openagent/agent.json') {
      sendJson(res, {
        did: \`did:oas:l1fe:agent:\${process.env.OPENAGENT_AGENT_NAME ?? '${options.projectName}'}\`,
        name: process.env.OPENAGENT_AGENT_NAME ?? '${options.projectName}',
        parent: process.env.OPENAGENT_PARENT_DID ?? 'did:oas:l1fe:hmr:unconfigured',
        capabilities: { tools: tools.map((t) => t.name) },
      });
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, { error: 'Method not allowed' }, 405);
      return;
    }

    const body = await readBody(req);
    const authCtx = await authenticate(req, body);

    if (!authCtx) {
      sendJson(res, { error: 'Authentication required' }, 401);
      return;
    }

    try {
      const mcpReq = JSON.parse(body) as McpRequest;
      const result = await handleMcpRequest(mcpReq, authCtx);
      sendJson(res, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error';
      sendJson(res, { jsonrpc: '2.0', id: null, error: { code: -32700, message } }, 400);
    }
  });

  server.listen(PORT, HOST, () => {
    process.stdout.write(\`MCP server listening on http://\${HOST}:\${PORT}\\n\`);
    process.stdout.write(\`Tools: \${tools.map((t) => t.name).join(', ')}\\n\`);
  });
}
`;
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

An MCP server with OpenAgent authentication.

## Setup

\`\`\`bash
npm install
cp .env.example .env
\`\`\`

## Development

\`\`\`bash
npm run dev
\`\`\`

## Adding Tools

1. Create a new file in \`src/tools/\`
2. Export an \`McpTool\` object
3. Add it to the \`tools\` array in \`src/tools/index.ts\`

## Learn More

- [OpenAgent Docs](https://openagent.id/docs)
- [MCP Specification](https://modelcontextprotocol.io)
`;
}
