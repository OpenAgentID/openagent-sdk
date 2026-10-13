import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { scaffold, generateStarterTemplate } from '../dist/index.js';

const bin = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const options = name => ({ projectName: name, template: 'starter', adapters: [], bridge: 'none',
  deploy: 'local', bioagentic: false, fabrics: false });
async function directory(t) {
  const root = await mkdtemp(join(tmpdir(), 'create-openagent-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
test('scaffold writes the public-only runnable starter and complete real-HTTP test suite', async t => {
  const root = await directory(t);
  await scaffold(options('app'), root);
  const files = generateStarterTemplate('app');
  for (const file of files) assert.equal(await readFile(join(root, 'app', file.path), 'utf8'), file.content);
  const manifest = JSON.parse(await readFile(join(root, 'app', 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dependencies, { '@openagentid/sdk': '0.7.3' });
  assert.equal(manifest.engines.node, '>=20.19.0');
  assert.equal(manifest.scripts.dev, 'node src/server.mjs');
  assert.equal(manifest.scripts.agent, 'node src/agent.mjs');
  assert.equal(manifest.scripts.test, 'node --test test/*.test.mjs');
  assert.deepEqual((await readdir(join(root, 'app'))).sort(), ['.gitignore', 'README.md', 'package.json', 'public', 'src', 'test'].sort());
  assert.match(await readFile(join(root, 'app', '.gitignore'), 'utf8'), /^\.openagent\/$/m);
});
test('generated appearance controls preserve the real receiver state and current choices before its first response', () => {
  const files = new Map(generateStarterTemplate('fidelity').map(file => [file.path, file.content]));
  const html = files.get('public/index.html');
  assert.match(html, /id="finish"><option value="plush">Soft plush/);
  assert.match(html, /id="eye-placement"><option value="face">On face/);
  const viewer = files.get('public/viewer.js');
  assert.match(viewer, /setAppearance\(\{ finish: finish.value \}\)/);
  assert.match(viewer, /setAppearance\(\{ eyePlacement: eyePlacement.value \}\)/);
  assert.match(viewer, /mountCharacter\([^;]+finish: finish.value, eyePlacement: eyePlacement.value, accessories: selectedAccessories\(\)/);
  assert.match(viewer, /latestStatus = state.status; player.update\(\{ status: latestStatus/);
  assert.doesNotMatch(viewer, /fetch\([^)]*,[^)]*method: ['"]POST/);
});
test('absent destination is required; files, directories and symlinks are preserved', async t => {
  const root = await directory(t);
  await mkdir(join(root, 'existing'));
  await writeFile(join(root, 'existing', 'important.txt'), 'preserve');
  await assert.rejects(scaffold(options('existing'), root), /already exists/);
  assert.equal(await readFile(join(root, 'existing', 'important.txt'), 'utf8'), 'preserve');
  await writeFile(join(root, 'file'), 'preserve-file');
  await assert.rejects(scaffold(options('file'), root), /already exists/);
  assert.equal(await readFile(join(root, 'file'), 'utf8'), 'preserve-file');
  await symlink(join(root, 'existing'), join(root, 'link'));
  await assert.rejects(scaffold(options('link'), root), /already exists/);
  assert.deepEqual(await readdir(join(root, 'existing')), ['important.txt']);
});
test('runtime scaffold options reject old templates and traversal before creating output', async t => {
  const root = await directory(t);
  await assert.rejects(scaffold(options('../outside'), root), /project name/);
  await assert.rejects(scaffold({ ...options('legacy'), template: 'agent' }, root), /starter/);
  await assert.rejects(scaffold({ ...options('legacy'), deploy: 'docker' }, root), /starter/);
  assert.deepEqual(await readdir(root), []);
});
test('actual CLI --yes and npm-style symlink entrypoints never wait for stdin', async t => {
  const root = await directory(t);
  const run = spawnSync(process.execPath, [bin, 'from-cli', '--yes'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 5000 });
  assert.equal(run.error, undefined); assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /npm install/); assert.match(run.stdout, /npm run dev/);
  assert.equal(JSON.parse(await readFile(join(root, 'from-cli', 'package.json'), 'utf8')).name, 'from-cli');
  const link = join(root, 'create-openagent-bin');
  await symlink(bin, link);
  const linked = spawnSync(process.execPath, [link, 'from-link', '--yes'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 5000 });
  assert.equal(linked.error, undefined); assert.equal(linked.status, 0, linked.stderr);
  assert.equal(JSON.parse(await readFile(join(root, 'from-link', 'package.json'), 'utf8')).name, 'from-link');
});
test('actual CLI help/version and unsupported legacy flags create no destination', async t => {
  const root = await directory(t);
  const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const args of [['--help'], ['--version']]) {
    const result = spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    if (args[0] === '--version') assert.equal(result.stdout.trim(), metadata.version);
    else assert.match(result.stdout, /--template starter/);
  }
  const result = spawnSync(process.execPath, [bin, 'legacy', '--template', 'agent', '--yes'], { cwd: root, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1); assert.match(result.stderr, /migration/);
  assert.deepEqual(await readdir(root), []);
});
