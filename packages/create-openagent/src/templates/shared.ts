/**
 * Shared files generated for every template type.
 */

import type { TemplateFile } from '../scaffold.js';
import type { ProjectOptions } from '../prompts.js';

export function generateSharedFiles(options: ProjectOptions): TemplateFile[] {
  return [
    { path: 'tsconfig.json', content: tsconfig(options) },
    { path: '.gitignore', content: gitignore() },
    { path: '.env.example', content: envExample(options) },
  ];
}

function tsconfig(options: ProjectOptions): string {
  const jsx = options.template === 'web-dashboard' || options.template === 'full-stack';
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        lib: jsx ? ['ES2022', 'DOM', 'DOM.Iterable'] : ['ES2022'],
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        isolatedModules: true,
        resolveJsonModule: true,
        esModuleInterop: true,
        ...(jsx ? { jsx: 'preserve' } : {}),
        ...(jsx ? { plugins: [{ name: 'next' }] } : {}),
        ...(jsx ? { paths: { '@/*': ['./src/*'] } } : {}),
      },
      include: jsx ? ['src/**/*.ts', 'src/**/*.tsx', '.next/types/**/*.ts'] : ['src/**/*.ts'],
      exclude: ['node_modules', 'dist'],
    },
    null,
    2,
  );
}

function gitignore(): string {
  return `node_modules/
dist/
.next/
.env
.env.local
*.tsbuildinfo
coverage/
`;
}

function envExample(options: ProjectOptions): string {
  const lines = [
    '# OpenAgent Configuration',
    'OPENAGENT_PARENT_DID=did:oas:l1fe:hmr:your-human-root',
    'OPENAGENT_AGENT_NAME=my-agent',
    '',
    '# Endpoints (optional — SDK uses stubs when omitted)',
    '# OAS_RESOLVER_URL=https://resolver.openagent.id',
    '# ARSENAL_BROKER_URL=https://broker.arsenal.id',
    '# AEGIS_VERIFIER_URL=https://verify.aegis.id',
  ];

  if (options.bridge === 'oidc') {
    lines.push(
      '',
      '# OIDC Bridge',
      '# OIDC_ISSUER_URL=https://your-idp.example.com',
      '# OIDC_CLIENT_ID=your-client-id',
      '# OIDC_CLIENT_SECRET=your-client-secret',
    );
  }

  if (options.bioagentic) {
    lines.push('', '# Bioagentic', '# BIOAGENTIC_THRESHOLD=0.8');
  }

  lines.push('');
  return lines.join('\n');
}
