/**
 * Project scaffolding — writes template files to disk.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spinner } from '@clack/prompts';
import type { ProjectOptions } from './prompts.js';
import { generateAgentTemplate } from './templates/agent.js';
import { generateMcpServerTemplate } from './templates/mcp-server.js';
import { generateWebDashboardTemplate } from './templates/web-dashboard.js';
import { generateFullStackTemplate } from './templates/full-stack.js';
import { generateSharedFiles } from './templates/shared.js';

export interface TemplateFile {
  path: string;
  content: string;
}

export async function scaffold(options: ProjectOptions): Promise<void> {
  const s = spinner();
  s.start('Scaffolding project...');

  const root = join(process.cwd(), options.projectName);

  if (existsSync(root)) {
    s.stop('Directory already exists.');
    throw new Error(`Directory "${options.projectName}" already exists.`);
  }

  // Collect template files
  const files: TemplateFile[] = [];

  switch (options.template) {
    case 'agent':
      files.push(...generateAgentTemplate(options));
      break;
    case 'mcp-server':
      files.push(...generateMcpServerTemplate(options));
      break;
    case 'web-dashboard':
      files.push(...generateWebDashboardTemplate(options));
      break;
    case 'full-stack':
      files.push(...generateFullStackTemplate(options));
      break;
  }

  files.push(...generateSharedFiles(options));

  // Write all files
  for (const file of files) {
    const fullPath = join(root, file.path);
    const dir = dirname(fullPath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(fullPath, file.content, 'utf-8');
  }

  s.stop(`Created ${files.length} files in ${options.projectName}/`);
}
