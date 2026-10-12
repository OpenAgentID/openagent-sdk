#!/usr/bin/env node
// Run through Depot from the repository root. No dependency source aliases.
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile, readdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '../..');
const out = join(root, '.compatibility-artifacts');
const archives = join(out, 'archives');
await mkdir(archives, { recursive: true });
const results = [], packages = [], packed = {};
const paths = [
  'sdks/typescript', 'adapters/http/typescript', 'integrations/mcp/typescript',
  'integrations/claude-agent-sdk/typescript', 'bridges/scim/typescript',
  'sdks/testing', 'adapters/eas/typescript', 'bridges/oidc/typescript',
  'packages/create-openagent',
];
function run(label, cwd, command, args) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 600_000,
    maxBuffer: 32 * 1024 * 1024, env: { ...process.env, CI: '1' } });
  results.push({ label, code: result.status, passed: result.status === 0 });
  const log = (result.stdout ?? '') + (result.stderr ?? '') + (result.error?.stack ?? '');
  // Return the write promise so evidence is retained before an error is raised.
  return writeFile(join(out, label + '.log'), log).then(() => {
    console.log(JSON.stringify(results.at(-1)));
    if (result.status !== 0) throw new Error(`Compatibility stage failed: ${label}`);
    return result.stdout;
  });
}
async function pack(directory) {
  const stdout = await run('pack-' + directory.replaceAll('/', '-'), join(root, directory),
    'npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', archives]);
  const [info] = JSON.parse(stdout);
  const file = join(archives, info.filename);
  packed[info.name] = file;
  packages.push({ name: info.name, version: info.version, filename: info.filename,
    integrity: info.integrity, sha256: createHash('sha256').update(await readFile(file)).digest('hex') });
}
try {
  for (const directory of paths) {
    const cwd = join(root, directory), slug = directory.replaceAll('/', '-');
    const manifest = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
    await run(slug + '-install', cwd, 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
    for (const command of ['typecheck', 'build', 'test', 'example']) {
      if (manifest.scripts?.[command]) await run(slug + '-' + command, cwd, 'npm', ['run', command]);
    }
    await pack(directory);
  }
  // Rust/WASM is built and smoked separately, from this exact source snapshot.
  await pack('crates/openagent-crypto-wasm/pkg');
  const minimal = join(out, 'minimal-sdk'); await mkdir(minimal, { recursive: true });
  await writeFile(join(minimal, 'package.json'), JSON.stringify({ name: 'openagent-minimal-consumer',
    private: true, type: 'module', dependencies: { '@openagentid/sdk': 'file:' + packed['@openagentid/sdk'] },
    devDependencies: { typescript: '^5.4.5', '@types/node': '^20.11.30' } }, null, 2));
  await run('minimal-sdk-install', minimal, 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
  await writeFile(join(minimal, 'index.ts'), `import { OpenAgentRuntime, act, parseCharacterState } from '@openagentid/sdk';
import { OpenAgentWorkspace } from '@openagentid/sdk/local';
import { mountCharacter } from '@openagentid/sdk/browser';
export { OpenAgentRuntime, act, parseCharacterState, OpenAgentWorkspace, mountCharacter };
`);
  await run('minimal-sdk-types', minimal, 'node', ['node_modules/typescript/bin/tsc', '--noEmit', '--strict',
    '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', 'index.ts']);
  await run('minimal-oas-install', minimal, 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund',
    '@openagentid/oas-sdk@1.0.2']);
  await writeFile(join(minimal, 'oas.ts'), `import * as oas from '@openagentid/oas-sdk';
import { createOasIdentityProvider, type OasIdentityStore } from '@openagentid/sdk/integrations/oas';
export function configure(store: OasIdentityStore) {
  return createOasIdentityProvider({ oas, store, audience: 'urn:example:receiver',
    authorizeCreation: async input => input.scopes });
}
`);
  await run('minimal-oas-types', minimal, 'node', ['node_modules/typescript/bin/tsc', '--noEmit', '--strict',
    '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', 'oas.ts']);
  for (const directory of paths.slice(1, -1)) {
    const cwd = join(root, directory), slug = directory.replaceAll('/', '-');
    const manifest = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
    // Install a fresh dependency tree: npm's no-save overlay can leave optional
    // peer edges dangling when replacing a registry package with an archive.
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ ...manifest,
      devDependencies: { ...manifest.devDependencies, '@openagentid/sdk': 'file:' + packed['@openagentid/sdk'] } }, null, 2));
    await rm(join(cwd, 'node_modules'), { recursive: true, force: true });
    await rm(join(cwd, 'package-lock.json'), { force: true });
    await run(slug + '-candidate-install', cwd, 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
    for (const command of ['typecheck', 'test', 'example']) {
      if (manifest.scripts?.[command]) await run(slug + '-candidate-' + command, cwd, 'npm', ['run', command]);
    }
  }
  const consumer = join(out, 'consumer'); await mkdir(consumer, { recursive: true });
  const dependencies = JSON.parse(await readFile(join(root, 'tools/compatibility/published-packages.json')));
  for (const [name, file] of Object.entries(packed)) {
    // OIDC has no runtime changes in this release; exercise its actual npm archive.
    if (name !== '@openagentid/oidc') dependencies[name] = 'file:' + file;
  }
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'openagent-compatibility-consumer',
    private: true, type: 'module', dependencies }, null, 2));
  await run('all-packages-install', consumer, 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
  await run('all-packages-tree', consumer, 'npm', ['ls', '--all']);
  await copyFile(join(root, 'tools/compatibility/exports.mjs'), join(consumer, 'exports.mjs'));
  await run('all-package-exports', consumer, 'node', ['exports.mjs']);
  await copyFile(join(consumer, 'exports-result.json'), join(out, 'exports-result.json'));
  await copyFile(join(consumer, 'package-lock.json'), join(out, 'consumer-package-lock.json'));
  await copyFile(join(root, 'tools/compatibility/claude-oas.mjs'), join(consumer, 'claude-oas.mjs'));
  await run('packed-oas-sdk-claude', consumer, 'node', ['claude-oas.mjs']);
  await copyFile(join(consumer, 'claude-oas-result.json'), join(out, 'claude-oas-result.json'));
  await copyFile(join(root, 'tools/compatibility/keys.mjs'), join(consumer, 'keys.mjs'));
  await run('packed-key-recovery', consumer, 'node', ['keys.mjs']);
  for (const example of (await readdir(join(root, 'examples/typescript'))).filter(name => /^0[1-6]-/.test(name))) {
    const cwd = join(root, 'examples/typescript', example);
    const manifest = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
    const dependencies = { ...manifest.dependencies };
    for (const name of Object.keys(dependencies)) if (packed[name]) dependencies[name] = 'file:' + packed[name];
    // Test the unpacked example against the frozen release archives, not source aliases.
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ ...manifest, dependencies }, null, 2));
    await run(example + '-install', cwd, 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
    for (const command of ['typecheck', 'start']) {
      if (manifest.scripts?.[command]) await run(example + '-' + command, cwd, 'npm', ['run', command]);
    }
  }
} catch (error) {
  await writeFile(join(out, 'failure.txt'), String(error.stack ?? error));
  process.exitCode = 1;
} finally {
  await writeFile(join(out, 'summary.json'), JSON.stringify({ passed: process.exitCode !== 1,
    sourceSha: process.env.OAID_SOURCE_SHA ?? null, node: process.version, packages, results }, null, 2));
}
