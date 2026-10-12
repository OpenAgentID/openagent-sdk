import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { validateProjectName, type ProjectOptions } from './prompts.js';
import { generateStarterTemplate } from './templates/starter.js';

export interface TemplateFile { path: string; content: string }

/** The destination must be absent, including symlinks and empty directories. */
export async function scaffold(options: ProjectOptions, cwd = process.cwd()): Promise<void> {
  const name = validateProjectName(options.projectName);
  if (options.template !== 'starter' || options.adapters.length !== 0 || options.bridge !== 'none' ||
      options.deploy !== 'local' || options.bioagentic !== false || options.fabrics !== false) {
    throw new Error('Only the local starter is supported in 0.2; historical template options require migration.');
  }
  const files = generateStarterTemplate(name);
  const names = new Set<string>();
  for (const file of files) {
    if (!/^(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+$/.test(file.path) ||
        file.path.split('/').some(part => part === '.' || part === '..') || names.has(file.path)) {
      throw new Error('Invalid starter file path.');
    }
    names.add(file.path);
  }
  const root = resolve(cwd, name);
  try { mkdirSync(root, { recursive: false }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Destination already exists: ' + name + '. Choose a new directory.');
    throw error;
  }
  // Exclusive creation prevents accidental overwrites even if another process
  // starts writing into the newly created directory. Preserve partial work on error.
  for (const file of files) {
    const destination = join(root, file.path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, file.content, { encoding: 'utf8', flag: 'wx' });
  }
}
