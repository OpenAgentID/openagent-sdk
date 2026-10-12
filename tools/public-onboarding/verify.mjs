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
  packages = [await pack(join(root, 'sdks/typescript'), '@openagentid/sdk', '0.5.0', 'pack-sdk'),
    await pack(join(root, 'packages/create-openagent'), 'create-openagent', '0.3.0', 'pack-generator')];
  const tooling = join(fixture, 'tools');
  await mkdir(tooling);
  await writeFile(join(tooling, 'package.json'), JSON.stringify({ name: 'public-generator-consumer', private: true }));
  run('install-generator-archive', ['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund', packages[1].file], tooling);
  const generator = join(tooling, 'node_modules/.bin/create-openagent');
  assert.equal(run('installed-generator-version', [generator, '--version'], fixture).trim(), '0.3.0');
  run('generate-noninteractive-application', [generator, 'my-agent-app', '--yes'], fixture);
  const application = join(fixture, 'my-agent-app');
  const manifest = JSON.parse(await readFile(join(application, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dependencies, { '@openagentid/sdk': '0.5.0' });
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
  assert.equal(run('installed-sdk-cli-version', [cli, '--version'], application).trim(), '0.5.0');
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
      assert.equal(await page.locator('#skin option').count(), 17);
      assert.equal(await page.locator('#avatar svg').getAttribute('data-character-view'), 'avatar');
      assert.notEqual(await page.locator('#avatar svg').getAttribute('viewBox'), '0 0 512 512');
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
    await browserCheck(label + '-every-family-and-kind-preserves-actual-status-and-eyes', async () => {
      const catalog = await page.evaluate(async () => (await import('/character-player.js')).getCharacterSkins());
      assert.equal(catalog.reduce((sum, family) => sum + family.shapes.length, 0), 62);
      for (const family of catalog) {
        await page.selectOption('#skin', family.id);
        for (const shape of family.shapes) {
          await page.selectOption('#shape', shape);
          assert.equal(await page.locator('#avatar svg').getAttribute('data-character-shape'), shape);
          assert.equal(await page.locator('#avatar svg').getAttribute('data-character-status'), 'success');
          assert.equal(await page.locator('#avatar svg').getAttribute('data-character-expression'), 'happy');
          assert(await page.evaluate(() => document.querySelector('#avatar svg') === window.oaidOriginalSvg &&
            [...document.querySelectorAll('#avatar [data-character-eye]')].every((eye, index) => eye === window.oaidOriginalEyes[index])));
        }
      }
      await page.selectOption('#skin', 'autos');
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
    if (label === 'desktop') {
      await browserCheck('all-62-kinds-face-mask-expression-extremes-and-distinct-mount-paints', async () => {
        const result = await page.evaluate(async () => {
          const { mountCharacter, getCharacterSkins, getCharacterExpressions } = await import('/character-player.js');
          const gallery = document.createElement('section');
          gallery.id = 'family-gallery';
          gallery.style.cssText = 'background:#faf9f7;color:#242630;padding:24px;width:1200px;box-sizing:border-box;font:14px system-ui';
          document.body.append(gallery);
          const players = [], failures = [];
          const title = document.createElement('h2'); title.textContent = 'OpenAgent families · full character and face avatar'; gallery.append(title);
          for (const family of getCharacterSkins()) {
            const group = document.createElement('div'); group.dataset.characterFamily = family.id; gallery.append(group);
            const heading = document.createElement('h3'); heading.textContent = family.label; group.append(heading);
            const row = document.createElement('div'); row.style.cssText = 'display:flex;flex-wrap:wrap;gap:14px'; group.append(row);
            for (const shape of family.shapes) {
              const card = document.createElement('div'); card.style.cssText = 'width:210px;background:#fff;border-radius:18px;padding:8px;box-sizing:border-box'; row.append(card);
              const images = document.createElement('div'); images.style.cssText = 'display:flex;align-items:center'; card.append(images);
              const full = document.createElement('div'); const face = document.createElement('div'); images.append(full, face);
              face.style.cssText = 'border-radius:50%;overflow:hidden;width:88px;height:88px;flex-shrink:0';
              players.push(mountCharacter(full, 'did:oas:openagent:agent:family-qualification', { skin: family.id, shape, view: 'full', size: 104, reducedMotion: true }));
              const player = mountCharacter(face, 'did:oas:openagent:agent:family-qualification', { skin: family.id, shape, size: 88, reducedMotion: true });
              players.push(player);
              const svg = face.querySelector('svg'), originalEyes = [...face.querySelectorAll('[data-character-eye]')];
              for (const expression of getCharacterExpressions()) for (const x of [-1, 1]) for (const y of [-1, 1]) {
                player.update({ expression, gaze: { x, y }, blink: 0 });
                const box = svg.getBoundingClientRect(), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
                for (const eye of originalEyes) {
                  const rect = eye.getBoundingClientRect();
                  if ([rect.left, rect.right].some(px => [rect.top, rect.bottom].some(py => Math.hypot(px - cx, py - cy) > box.width / 2 - .5))) {
                    failures.push(family.id + '/' + shape + '/' + expression); break;
                  }
                }
              }
              player.update({ status: 'reasoning', expression: null, gaze: { x: 0, y: 0 } });
              player.setAppearance({ view: 'full' });
              if (svg.getAttribute('viewBox') !== '0 0 512 512') failures.push('full-view:' + family.id + '/' + shape);
              player.setAppearance({ view: 'avatar' });
              if (originalEyes.some((eye, i) => eye !== face.querySelectorAll('[data-character-eye]')[i]) || player.getState().status !== 'reasoning') failures.push('state-replaced:' + family.id + '/' + shape);
              const footer = document.createElement('div'); footer.style.cssText = 'display:flex;gap:8px;align-items:center;margin:8px'; card.append(footer);
              const mini = document.createElement('div'); mini.style.cssText = 'width:32px;height:32px;border-radius:50%;overflow:hidden'; footer.append(mini);
              players.push(mountCharacter(mini, 'did:oas:openagent:agent:family-qualification', { skin: family.id, shape, size: 32, reducedMotion: true }));
              const caption = document.createElement('span'); caption.textContent = shape; footer.append(caption);
            }
          }
          const ids = [...gallery.querySelectorAll('[id]')].map(element => element.id);
          if (new Set(ids).size !== ids.length) failures.push('duplicate-paint-ids');
          for (const element of gallery.querySelectorAll('[fill],[stroke]')) for (const attribute of ['fill', 'stroke']) {
            const value = element.getAttribute(attribute);
            if (value?.startsWith('url(')) {
              const match = /^url\(#([a-zA-Z0-9_-]+)\)$/.exec(value);
              if (!match || !element.closest('svg').querySelector('[id="' + match[1] + '"]')) failures.push('unresolved-local-paint');
            }
          }
          window.oaidGalleryPlayers = players;
          return { failures: [...new Set(failures)], families: getCharacterSkins().map(family => family.id) };
        });
        await page.locator('#family-gallery').screenshot({ path: join(out, 'all-character-families.png') });
        for (const family of result.families) await page.locator('[data-character-family="' + family + '"]').screenshot({ path: join(out, 'family-' + family + '.png') });
        assert.deepEqual(result.failures, []);
      });
      await page.evaluate(() => { window.oaidGalleryPlayers.forEach(player => player.dispose()); document.querySelector('#family-gallery').remove(); });
    }
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
