import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(root, '.public-tooling-artifacts');
await mkdir(out, { recursive: true });
const fixture = await mkdtemp(join(root, '.public-onboarding-'));
const checks = [];
let app, browser;

function run(name, command, cwd, timeout = 180_000) {
  const result = spawnSync(command[0], command.slice(1), {
    cwd, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, CI: 'true', npm_config_audit: 'false', npm_config_fund: 'false' },
  });
  awaitlessLog(name, (result.stdout ?? '') + (result.stderr ?? ''));
  assert.equal(result.status, 0, `${name} failed; inspect ${name}.log`);
  checks.push({ name, passed: true });
  return result.stdout;
}
// Only build/test process output is saved. No local proof or private-key command
// is logged; identity tests hold those values in their own disposable fixtures.
function awaitlessLog(name, value) {
  logWrites.push(writeFile(join(out, name + '.log'), value));
}
const logWrites = [];

async function pack(directory, expectedName, expectedVersion, label) {
  const result = JSON.parse(run(label, ['npm', 'pack', '--json', '--ignore-scripts', '--pack-destination', out], directory))[0];
  assert.equal(result.name, expectedName);
  assert.equal(result.version, expectedVersion);
  assert(result.files.some(file => file.path === 'LICENSE-MIT'));
  assert(result.files.some(file => file.path === 'LICENSE-APACHE'));
  assert(!result.files.some(file => /(?:^|\/)(?:\.openagent(?:id)?|node_modules)(?:\/|$)|(?:^|\/)(?:node\.key|state\.json|private.*\.jwk)$/.test(file.path)));
  const file = join(out, result.filename);
  return { name: result.name, version: result.version, filename: result.filename,
    sha256: createHash('sha256').update(await readFile(file)).digest('hex'), integrity: result.integrity, file };
}

async function browserCheck(name, operation) {
  await operation();
  checks.push({ name, passed: true });
}

let packages = [];
let failure;
let source = null;
try {
  source = run('source-commit', ['git', 'rev-parse', 'HEAD'], root).trim();
  assert.match(source, /^[0-9a-f]{40}$/);
  if (process.env.OAID_SOURCE_SHA) assert.equal(source, process.env.OAID_SOURCE_SHA);
  packages = [await pack(join(root, 'sdks/typescript'), '@openagentid/sdk', '0.4.0', 'pack-sdk'),
    await pack(join(root, 'packages/create-openagent'), 'create-openagent', '0.2.0', 'pack-generator')];
  const tooling = join(fixture, 'tools');
  await mkdir(tooling);
  await writeFile(join(tooling, 'package.json'), JSON.stringify({ name: 'public-generator-consumer', private: true }));
  run('install-generator-archive', ['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund', packages[1].file], tooling);
  const generator = join(tooling, 'node_modules/.bin/create-openagent');
  assert.equal(run('installed-generator-version', [generator, '--version'], fixture).trim(), '0.2.0');
  run('generate-noninteractive-application', [generator, 'my-agent-app', '--yes'], fixture);
  const application = join(fixture, 'my-agent-app');
  const manifest = JSON.parse(await readFile(join(application, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dependencies, { '@openagentid/sdk': '0.4.0' });
  // Before publication the exact review artifact substitutes for the declared
  // registry release. No source or transitive dependency is replaced.
  run('install-sdk-archive-in-application', ['npm', 'install', '--ignore-scripts', '--save-exact', '--no-audit', '--no-fund', packages[0].file], application);
  const lock = JSON.parse(await readFile(join(application, 'package-lock.json'), 'utf8'));
  for (const entry of Object.values(lock.packages)) {
    if (entry.resolved) assert(entry.resolved.startsWith('https://registry.npmjs.org/') ||
      entry.resolved.endsWith(packages[0].filename), 'Starter resolved a non-public dependency');
  }
  // Restore the generated manifest after npm records the candidate tarball in
  // this disposable fixture's lockfile. The shipped template remains pinned to
  // the public version, while qualification runs the exact release archive.
  await writeFile(join(application, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  checks.push({ name: 'public-registry-dependency-closure', passed: true });
  run('generated-real-http-restart-replay-revocation-tests', ['npm', 'test'], application);
  const cli = join(application, 'node_modules/.bin/oaid');
  assert.equal(run('installed-sdk-cli-version', [cli, '--version'], application).trim(), '0.4.0');
  assert(run('installed-sdk-cli-help', [cli, '--help'], application).includes('oaid agent trust'));

  const hello = join(fixture, 'hello-agent');
  await cp(join(root, 'examples/typescript/01-hello-agent'), hello, { recursive: true });
  run('install-hello-example', ['npm', 'install', '--ignore-scripts', '--no-save', '--no-audit', '--no-fund', packages[0].file], hello);
  run('hello-real-signature-and-replay', ['npm', 'start'], hello);
  run('hello-reopen-persisted-identity', ['npm', 'start'], hello);

  const { startServer } = await import(pathToFileURL(join(application, 'src/server.mjs')));
  const { sendAgentRequest } = await import(pathToFileURL(join(application, 'src/agent.mjs')));
  app = await startServer({ root: application, port: 0 });
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const label = viewport.width > 500 ? 'desktop' : 'mobile';
    const context = await browser.newContext({ viewport, reducedMotion: 'no-preference' });
    const page = await context.newPage();
    const errors = [], externalRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      if (new URL(route.request().url()).origin !== app.url) {
        externalRequests.push(route.request().url());
        await route.abort();
      } else await route.continue();
    });
    await page.goto(app.url);
    await page.waitForSelector('#avatar svg[data-character-skin="autos"]');
    await browserCheck(label + '-default-autos-and-owned-did', async () => {
      assert.equal(await page.locator('#identity').textContent(), app.did);
      assert.equal(await page.locator('#skin').inputValue(), 'autos');
      assert.equal(await page.locator('[data-character-eye]').count(), 2);
      await page.evaluate(() => { window.oaidOriginalSvg = document.querySelector('#avatar svg');
        window.oaidOriginalEyes = [...document.querySelectorAll('[data-character-eye]')]; });
    });
    // A real local signer obtains a new challenge and authenticates a request.
    // The viewer reads the receiver's resulting status; no browser state is set.
    const before = await (await fetch(app.url + '/state')).json();
    const message = 'Public onboarding request ' + randomUUID();
    const result = await sendAgentRequest({ root: application, url: app.url, message });
    assert.equal(result.did, app.did);
    assert.equal(result.digest, createHash('sha256').update(message).digest('hex'));
    await page.waitForFunction(count => document.querySelector('#status').textContent.includes(String(count) + ' verified request'), before.completedRequests + 1);
    await browserCheck(label + '-real-request-status-and-stable-eye-nodes', async () => {
      assert.equal(await page.locator('#avatar svg').getAttribute('data-character-status'), 'success');
      assert.equal(await page.locator('#avatar svg').getAttribute('data-character-expression'), 'happy');
      assert(await page.evaluate(() => document.querySelector('#avatar svg') === window.oaidOriginalSvg &&
        [...document.querySelectorAll('[data-character-eye]')].every((eye, index) => eye === window.oaidOriginalEyes[index])));
      assert.equal((await (await fetch(app.url + '/state')).json()).completedRequests, before.completedRequests + 1);
    });
    await page.selectOption('#skin', 'spacex');
    await browserCheck(label + '-spacex-preserves-live-state', async () => {
      assert.equal(await page.locator('#avatar svg').getAttribute('data-character-skin'), 'spacex');
      assert.equal(await page.locator('#avatar svg').getAttribute('data-character-status'), 'success');
      assert(await page.evaluate(() => document.querySelector('#avatar svg') === window.oaidOriginalSvg));
    });
    await page.selectOption('#expression', 'thoughtful');
    await browserCheck(label + '-smooth-expression-geometry', async () => {
      const frames = await page.evaluate(async () => {
        const frames = [];
        for (let i = 0; i < 24; i++) {
          await new Promise(requestAnimationFrame);
          const eye = document.querySelector('[data-character-eye="left"]');
          frames.push(['x', 'y', 'height', 'width', 'rx', 'transform'].map(key => eye.getAttribute(key)).join('|'));
        }
        return frames;
      });
      assert(new Set(frames).size > 3, 'Expected intermediate live eye geometry, not a static replacement');
      assert.equal(await page.locator('#avatar svg').getAttribute('data-character-expression'), 'thoughtful');
    });
    await page.selectOption('#expression', '');
    await page.waitForFunction(() => document.querySelector('#avatar svg').getAttribute('data-character-expression') === 'happy');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await browserCheck(label + '-system-reduced-motion', async () => {
      const samples = await page.evaluate(async () => {
        const read = () => [...document.querySelectorAll('[data-character-eye]')].map(eye => eye.outerHTML).join('');
        await new Promise(resolve => setTimeout(resolve, 50));
        const first = read();
        await new Promise(resolve => setTimeout(resolve, 150));
        return [first, read()];
      });
      assert.equal(samples[0], samples[1]);
    });
    await page.screenshot({ path: join(out, label + '-verified-starter.png'), fullPage: true });
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);
    checks.push({ name: label + '-no-external-runtime-network-or-browser-errors', passed: true });
    await context.close();
  }
} catch (error) {
  failure = error instanceof Error ? error.message : 'Qualification failed';
  process.exitCode = 1;
} finally {
  await browser?.close();
  await app?.close();
  await Promise.all(logWrites);
  await writeFile(join(out, 'receipt.json'), JSON.stringify({ passed: !failure, node: process.version,
    source, workflowRef: process.env.GITHUB_SHA ?? null, packages: packages.map(({ file, ...metadata }) => metadata),
    checks, failure, externalIdentityServiceUsed: false, productionProfileAcceptance: false }, null, 2) + '\n');
  // Only disposable generated keys/workspaces are removed; source, package
  // archives, logs and screenshots remain in their persistent artifact lane.
  await rm(fixture, { recursive: true, force: true });
}
