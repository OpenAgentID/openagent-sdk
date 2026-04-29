/**
 * Interactive prompts for project scaffolding.
 */

import * as p from '@clack/prompts';

export type TemplateType = 'agent' | 'mcp-server' | 'web-dashboard' | 'full-stack';
export type AuthAdapter = 'http' | 'websocket' | 'grpc';
export type EnterpriseBridge = 'oidc' | 'scim' | 'none';
export type DeployTarget = 'cloudflare' | 'vercel' | 'aws' | 'docker' | 'local';

export interface ProjectOptions {
  projectName: string;
  template: TemplateType;
  adapters: readonly AuthAdapter[];
  bridge: EnterpriseBridge;
  deploy: DeployTarget;
  bioagentic: boolean;
  fabrics: boolean;
}

/** Parse CLI flags to pre-fill options. */
function parseFlagValue(args: readonly string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.includes(flag);
}

export async function collectOptions(
  projectNameArg: string | undefined,
  args: readonly string[],
): Promise<ProjectOptions> {
  // Resolve project name
  const projectName =
    projectNameArg ??
    ((await p.text({
      message: 'Project name:',
      placeholder: 'my-agent-app',
      validate: (value) => {
        if (!value.trim()) return 'Project name is required.';
        if (!/^[a-z0-9][a-z0-9._-]*$/i.test(value)) {
          return 'Invalid project name (use alphanumeric, dashes, dots, underscores).';
        }
        return undefined;
      },
    })) as string);

  if (p.isCancel(projectName)) throw new Error('Cancelled');

  // Template type
  const templateFlag = parseFlagValue(args, '--template') as TemplateType | undefined;
  const template =
    templateFlag ??
    ((await p.select({
      message: 'What type of agent app?',
      options: [
        { value: 'agent', label: 'Agent', hint: 'Standalone agent with identity and tools' },
        { value: 'mcp-server', label: 'MCP Server', hint: 'Model Context Protocol server with auth' },
        { value: 'web-dashboard', label: 'Web Dashboard', hint: 'Next.js dashboard for agent management' },
        { value: 'full-stack', label: 'Full Stack', hint: 'Agent + MCP + Dashboard combined' },
      ],
    })) as TemplateType);

  if (p.isCancel(template)) throw new Error('Cancelled');

  // Auth adapters
  const adapterFlag = parseFlagValue(args, '--adapter');
  const adapters = adapterFlag
    ? ([adapterFlag] as AuthAdapter[])
    : ((await p.multiselect({
        message: 'Authentication adapters?',
        options: [
          { value: 'http', label: 'HTTP', hint: 'Bearer token / challenge-response' },
          { value: 'websocket', label: 'WebSocket', hint: 'Persistent connection auth' },
          { value: 'grpc', label: 'gRPC', hint: 'Protobuf-based auth' },
        ],
        initialValues: ['http'],
        required: true,
      })) as AuthAdapter[]);

  if (p.isCancel(adapters)) throw new Error('Cancelled');

  // Enterprise bridge
  const bridgeFlag = parseFlagValue(args, '--bridge') as EnterpriseBridge | undefined;
  const bridge =
    bridgeFlag ??
    ((await p.select({
      message: 'Enterprise bridge?',
      options: [
        { value: 'none', label: 'None', hint: 'Skip enterprise integration' },
        { value: 'oidc', label: 'OIDC', hint: 'OpenID Connect bridge for human SSO' },
        { value: 'scim', label: 'SCIM', hint: 'User provisioning bridge' },
      ],
    })) as EnterpriseBridge);

  if (p.isCancel(bridge)) throw new Error('Cancelled');

  // Deploy target
  const deployFlag = parseFlagValue(args, '--deploy') as DeployTarget | undefined;
  const deploy =
    deployFlag ??
    ((await p.select({
      message: 'Deploy target?',
      options: [
        { value: 'local', label: 'Local', hint: 'Run locally with Node.js' },
        { value: 'cloudflare', label: 'Cloudflare Workers', hint: 'Edge-first deployment' },
        { value: 'vercel', label: 'Vercel Edge', hint: 'Next.js-optimized deployment' },
        { value: 'aws', label: 'AWS Lambda', hint: 'Serverless with API Gateway' },
        { value: 'docker', label: 'Docker', hint: 'Container deployment' },
      ],
    })) as DeployTarget);

  if (p.isCancel(deploy)) throw new Error('Cancelled');

  // Optional features
  const bioagentic = hasFlag(args, '--bioagentic')
    ? true
    : ((await p.confirm({
        message: 'Include Bioagentic entity classification?',
        initialValue: false,
      })) as boolean);

  if (p.isCancel(bioagentic)) throw new Error('Cancelled');

  const fabrics = hasFlag(args, '--fabrics')
    ? true
    : ((await p.confirm({
        message: 'Include Fabrics routing?',
        initialValue: false,
      })) as boolean);

  if (p.isCancel(fabrics)) throw new Error('Cancelled');

  return {
    projectName: typeof projectName === 'string' ? projectName : 'my-agent-app',
    template: template as TemplateType,
    adapters: adapters as readonly AuthAdapter[],
    bridge: bridge as EnterpriseBridge,
    deploy: deploy as DeployTarget,
    bioagentic: bioagentic as boolean,
    fabrics: fabrics as boolean,
  };
}
