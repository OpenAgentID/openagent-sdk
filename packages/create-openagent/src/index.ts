/**
 * create-openagent — CLI scaffolding tool for OpenAgent projects.
 *
 * Usage:
 *   npx create-openagent my-agent-app
 *   npx create-openagent my-agent-app --template agent --deploy cloudflare
 */

import { intro, outro, isCancel } from '@clack/prompts';
import pc from 'picocolors';
import { collectOptions, type ProjectOptions } from './prompts.js';
import { scaffold } from './scaffold.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const projectName = args.find((arg) => !arg.startsWith('-'));

  intro(pc.bgCyan(pc.black(' create-openagent ')));

  let options: ProjectOptions;
  try {
    options = await collectOptions(projectName, args);
  } catch {
    outro(pc.red('Cancelled.'));
    process.exit(1);
  }

  if (isCancel(options)) {
    outro(pc.red('Cancelled.'));
    process.exit(1);
  }

  try {
    await scaffold(options);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    outro(pc.red(`Failed to scaffold project: ${message}`));
    process.exit(1);
  }

  outro(pc.green('Project created successfully!'));

  const relativePath = options.projectName;
  process.stdout.write('\n');
  process.stdout.write(pc.bold('Next steps:\n'));
  process.stdout.write(`  cd ${relativePath}\n`);
  process.stdout.write('  npm install\n');

  if (options.template === 'web-dashboard' || options.template === 'full-stack') {
    process.stdout.write('  npm run dev\n');
  } else {
    process.stdout.write('  npm run build\n');
    process.stdout.write('  npm start\n');
  }

  process.stdout.write('\n');
  process.stdout.write(pc.dim(`Docs: https://openagent.id/docs\n`));
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
