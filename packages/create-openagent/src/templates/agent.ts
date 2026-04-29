/**
 * Template: agent — standalone agent with identity and tools.
 */

import type { TemplateFile } from '../scaffold.js';
import type { ProjectOptions } from '../prompts.js';

export function generateAgentTemplate(options: ProjectOptions): TemplateFile[] {
  return [
    { path: 'package.json', content: packageJson(options) },
    { path: 'src/index.ts', content: indexTs() },
    { path: 'src/agent.ts', content: agentTs(options) },
    { path: 'src/tools.ts', content: toolsTs() },
    { path: 'README.md', content: readme(options) },
  ];
}

function packageJson(options: ProjectOptions): string {
  const deps: Record<string, string> = {
    '@openagent/sdk': '^0.1.0',
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
 * Entry point — creates the agent and runs it.
 */

import { createAgent } from './agent.js';
import { tools } from './tools.js';

async function main(): Promise<void> {
  const agent = await createAgent();

  process.stdout.write(\`Agent created: \${agent.did}\\n\`);
  process.stdout.write(\`Available tools: \${tools.map((t) => t.name).join(', ')}\\n\`);

  // Example: fetch credentials for a provider
  // const creds = await agent.credentialsFor('openai');
  // const res = await creds.fetch('https://api.openai.com/v1/chat/completions', { ... });
}

main().catch((err) => {
  process.stderr.write(\`Fatal: \${err instanceof Error ? err.message : String(err)}\\n\`);
  process.exit(1);
});
`;
}

function agentTs(options: ProjectOptions): string {
  return `/**
 * Agent identity and authentication setup.
 */

import { OpenAgent, type OpenAgentInstance } from '@openagent/sdk';

/** Configure the OpenAgent runtime. */
OpenAgent.configure({
  endpoints: {
    oasResolver: process.env.OAS_RESOLVER_URL,
    arsenalBroker: process.env.ARSENAL_BROKER_URL,
    aegisVerifier: process.env.AEGIS_VERIFIER_URL,
  },
});

/**
 * Create a new agent identity.
 *
 * In production, replace the parent DID and scopes with your own.
 */
export async function createAgent(): Promise<OpenAgentInstance> {
  const parentDid = process.env.OPENAGENT_PARENT_DID ?? 'did:oas:l1fe:hmr:alice';
  const agentName = process.env.OPENAGENT_AGENT_NAME ?? '${options.projectName}';

  return OpenAgent.createAgent({
    parent: parentDid,
    name: agentName,
    scopes: ['openai:chat:completions', 'github:repo:read'],
  });
}
`;
}

function toolsTs(): string {
  return `/**
 * Example MCP tools — define your agent's capabilities here.
 */

export interface Tool {
  readonly name: string;
  readonly description: string;
  execute(input: Record<string, unknown>): Promise<unknown>;
}

/** Echo tool — returns the input as-is. Useful for testing. */
const echoTool: Tool = {
  name: 'echo',
  description: 'Returns the input unchanged.',
  async execute(input) {
    return { echoed: input };
  },
};

/** Timestamp tool — returns the current ISO timestamp. */
const timestampTool: Tool = {
  name: 'timestamp',
  description: 'Returns the current UTC timestamp.',
  async execute() {
    return { timestamp: new Date().toISOString() };
  },
};

export const tools: readonly Tool[] = [echoTool, timestampTool];
`;
}

function readme(options: ProjectOptions): string {
  return `# ${options.projectName}

An OpenAgent-powered agent application.

## Setup

\`\`\`bash
npm install
cp .env.example .env
# Edit .env with your agent identity
\`\`\`

## Development

\`\`\`bash
npm run dev
\`\`\`

## Build & Run

\`\`\`bash
npm run build
npm start
\`\`\`

## Configuration

Set environment variables in \`.env\`:

- \`OPENAGENT_PARENT_DID\` — Your human root DID
- \`OPENAGENT_AGENT_NAME\` — Agent name
- \`OAS_RESOLVER_URL\` — OAS identity resolver (optional for dev)
- \`ARSENAL_BROKER_URL\` — Arsenal credential broker (optional for dev)
- \`AEGIS_VERIFIER_URL\` — AEGIS verifier (optional for dev)

## Learn More

- [OpenAgent Docs](https://openagent.id/docs)
- [OAS Specification](https://openagent.id/spec)
`;
}
