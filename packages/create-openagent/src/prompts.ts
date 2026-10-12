import * as p from '@clack/prompts';

// Retained types let the historical template sources remain readable. Only
// starter is admitted by the 0.2 scaffolder; those sources are not generated.
export type TemplateType = 'starter' | 'agent' | 'mcp-server' | 'web-dashboard' | 'full-stack';
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
export interface CreateArguments {
  readonly kind: 'create';
  readonly projectName?: string;
  readonly yes: boolean;
  readonly template: 'starter';
}
export type ParsedArguments = CreateArguments | { readonly kind: 'help' | 'version' };

export function validateProjectName(value: unknown): string {
  if (typeof value !== 'string' || /\s/.test(value) || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|node_modules)$/i.test(value)) {
    throw new Error('Use a project name of 1–64 lowercase letters, numbers, dashes or underscores; no paths or reserved names.');
  }
  return value;
}

/** Reject ambiguous input before prompting or touching the filesystem. */
export function parseArguments(args: readonly string[]): ParsedArguments {
  let projectName: string | undefined;
  let yes = false;
  let special: 'help' | 'version' | undefined;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (typeof arg !== 'string' || arg.length === 0) throw new Error('Empty arguments are not supported.');
    const flag = arg === '-y' ? '--yes' : arg === '-h' ? '--help' : arg === '-v' ? '--version' : arg;
    if (['--yes', '--help', '--version', '--template'].includes(flag)) {
      if (seen.has(flag)) throw new Error('Duplicate option: ' + flag);
      seen.add(flag);
      if (flag === '--yes') yes = true;
      else if (flag === '--help' || flag === '--version') {
        if (special) throw new Error('Use --help or --version on its own.');
        special = flag === '--help' ? 'help' : 'version';
      } else {
        const value = args[++index];
        if (value !== 'starter') throw new Error('Only --template starter is supported in 0.2. Historical templates need migration to the current SDK.');
      }
    } else if (arg.startsWith('-')) {
      throw new Error('Unsupported option: ' + arg + '. Use the local starter: create-openagent app --yes. Adapter, bridge, deploy and historical template options are not supported in 0.2.');
    } else {
      if (projectName !== undefined) throw new Error('Provide exactly one project name.');
      projectName = validateProjectName(arg);
    }
  }
  if (special) {
    if (args.length !== 1) throw new Error('Use --help or --version on its own.');
    return Object.freeze({ kind: special });
  }
  if (yes && projectName === undefined) throw new Error('With --yes, provide a project name: create-openagent app --yes.');
  return Object.freeze({ kind: 'create', projectName, yes, template: 'starter' });
}

export async function collectOptions(input: CreateArguments, interactive = Boolean(process.stdin.isTTY)): Promise<ProjectOptions> {
  let name = input.projectName;
  if (name === undefined) {
    if (input.yes || !interactive) throw new Error('Provide a project name: create-openagent app --yes.');
    const answer = await p.text({
      message: 'Project name:',
      placeholder: 'my-agent-app',
      validate(value) { try { validateProjectName(value); return undefined; } catch (error) { return (error as Error).message; } },
    });
    if (p.isCancel(answer)) throw new Error('Cancelled.');
    name = validateProjectName(answer);
  }
  return { projectName: validateProjectName(name), template: 'starter', adapters: [], bridge: 'none',
    deploy: 'local', bioagentic: false, fabrics: false };
}
