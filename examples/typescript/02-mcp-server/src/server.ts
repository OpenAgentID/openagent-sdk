import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { assertScopes, OpenAgent, OpenAgentError } from '@openagentid/sdk';

OpenAgent.configure({
  brokerUrl: process.env.OPENAGENT_BROKER_URL ?? 'fake://in-memory',
  aegisUrl: process.env.OPENAGENT_AEGIS_URL ?? 'fake://in-memory',
  namespace: process.env.OPENAGENT_NAMESPACE ?? 'example',
});

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function handleToolCall(ctx: Awaited<ReturnType<typeof OpenAgent.authenticate>>, params: Record<string, unknown>) {
  const name = params.name as string;
  const args = (params.arguments ?? {}) as Record<string, unknown>;

  switch (name) {
    case 'summarize_url': {
      assertScopes(ctx, ['tavily:search:invoke']);
      const agent = await OpenAgent.loadAgent(ctx.did);
      const tavily = await agent.credentialsFor('tavily');

      const url = String(args.url ?? '');
      if (!url) throw new OpenAgentError('INVALID_REQUEST', 'missing argument: url');

      const res = await tavily.get(`https://api.tavily.com/search?q=${encodeURIComponent(url)}`);
      const text = await res.text();

      return { content: [{ type: 'text', text }] };
    }
    default:
      throw new OpenAgentError('INVALID_REQUEST', `unknown tool: ${name}`);
  }
}

async function handleRpc(req: IncomingMessage, res: ServerResponse) {
  const bodyStr = await readBody(req);
  let rpc: JsonRpcRequest;
  try {
    rpc = JSON.parse(bodyStr) as JsonRpcRequest;
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }));
    return;
  }

  try {
    const ctx = await OpenAgent.authenticate(req);
    let result: unknown;
    switch (rpc.method) {
      case 'initialize':
        result = { capabilities: { tools: {} }, serverInfo: { name: 'acme-tools', version: '0.1.0' } };
        break;
      case 'tools/list':
        result = {
          tools: [
            {
              name: 'summarize_url',
              description: 'Summarize a URL',
              inputSchema: {
                type: 'object',
                properties: { url: { type: 'string' } },
                required: ['url'],
              },
            },
          ],
        };
        break;
      case 'tools/call':
        result = await handleToolCall(ctx, rpc.params ?? {});
        break;
      default:
        throw new OpenAgentError('INVALID_REQUEST', `unknown method: ${rpc.method}`);
    }

    const response: JsonRpcResponse = { jsonrpc: '2.0', id: rpc.id, result };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response));
  } catch (err) {
    const oaErr = err instanceof OpenAgentError ? err : new OpenAgentError('INTERNAL', (err as Error).message);
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: rpc.id,
      error: {
        code: -32000,
        message: oaErr.message,
        data: { code: oaErr.code, httpStatus: oaErr.httpStatus },
      },
    };
    res.writeHead(oaErr.httpStatus, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response));
  }
}

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/mcp') {
    handleRpc(req, res).catch((err) => {
      console.error('unhandled error:', err);
      res.writeHead(500);
      res.end();
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

const PORT = Number(process.env.PORT ?? 3000);
server.listen(PORT, () => {
  console.log(`MCP server with OpenAgent auth listening on :${PORT}/mcp`);
});
