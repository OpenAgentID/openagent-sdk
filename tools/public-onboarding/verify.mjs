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
  if (process.env.OAID_RELEASE_PACKAGE_MANIFEST) {
    const manifest = JSON.parse(await readFile(process.env.OAID_RELEASE_PACKAGE_MANIFEST, 'utf8'));
    assert.equal(manifest.sourceSha, source, 'Prepacked archives must belong to this exact commit');
    const entry = manifest.packages.find(value => value.name === expectedName);
    assert(entry, `Missing reviewed archive: ${expectedName}`);
    assert.equal(entry.version, expectedVersion);
    const file = resolve(dirname(process.env.OAID_RELEASE_PACKAGE_MANIFEST), entry.file);
    const bytes = await readFile(file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.equal('sha512-' + createHash('sha512').update(bytes).digest('base64'), entry.integrity);
    assert.equal(file.split('/').at(-1), entry.filename);
    const paths = run(label + '-contents', ['tar', '-tzf', file], root).trim().split('\n');
    assert(paths.includes('package/LICENSE-MIT') && paths.includes('package/LICENSE-APACHE'));
    assert(!paths.some(path => /(?:^|\/)(?:\.openagent(?:id)?|node_modules)(?:\/|$)|(?:^|\/)(?:node\.key|state\.json|private.*\.jwk)$/.test(path)));
    const packedManifest = JSON.parse(run(label + '-metadata', ['tar', '-xOzf', file, 'package/package.json'], root));
    assert.equal(packedManifest.name, expectedName);
    assert.equal(packedManifest.version, expectedVersion);
    checks.push({ name: label + '-exact-reviewed-archive', passed: true });
    return { ...entry, file };
  }
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
  const sdkVersion = JSON.parse(await readFile(join(root, 'sdks/typescript/package.json'), 'utf8')).version;
  packages = [await pack(join(root, 'sdks/typescript'), '@openagentid/sdk', sdkVersion, 'pack-sdk'),
    await pack(join(root, 'packages/create-openagent'), 'create-openagent', '0.6.0', 'pack-generator')];
  const tooling = join(fixture, 'tools');
  await mkdir(tooling);
  await writeFile(join(tooling, 'package.json'), JSON.stringify({ name: 'public-generator-consumer', private: true }));
  run('install-generator-archive', ['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund', packages[1].file], tooling);
  const generator = join(tooling, 'node_modules/.bin/create-openagent');
  assert.equal(run('installed-generator-version', [generator, '--version'], fixture).trim(), '0.6.0');
  run('generate-noninteractive-application', [generator, 'my-agent-app', '--yes'], fixture);
  const application = join(fixture, 'my-agent-app');
  const manifest = JSON.parse(await readFile(join(application, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dependencies, { '@openagentid/sdk': '0.8.0' });
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
  assert.equal(run('installed-sdk-cli-version', [cli, '--version'], application).trim(), sdkVersion);
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
      assert.equal(await page.locator('#skin option').count(), 18);
      assert.equal(await page.locator('#avatar svg').getAttribute('data-character-view'), 'avatar');
      assert.notEqual(await page.locator('#avatar svg').getAttribute('viewBox'), '0 0 512 512');
      assert.equal(await page.locator('[data-character-eye]').count(), 2);
      assert.equal(await page.locator('[data-character-accessory]').count(), 0);
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
    await browserCheck(label + '-independent-accessories-preserve-real-status', async () => {
      await page.getByLabel('Glasses', { exact: true }).check();
      await page.getByLabel('Headphones', { exact: true }).check();
      assert.equal(await page.locator('#avatar [data-character-accessory]').count(), 2);
      assert.equal(await page.locator('#avatar svg').getAttribute('data-character-status'), 'success');
      assert(await page.evaluate(() => [...document.querySelectorAll('#avatar [data-character-eye]')]
        .every((eye, index) => eye === window.oaidOriginalEyes[index])));
    });
    await browserCheck(label + '-spacex-preserves-live-state', async () => {
      assert.equal(await page.locator('#avatar svg').getAttribute('data-character-skin'), 'spacex');
      assert.equal(await page.locator('#avatar svg').getAttribute('data-character-status'), 'success');
      assert(await page.evaluate(() => document.querySelector('#avatar svg') === window.oaidOriginalSvg));
    });
    await browserCheck(label + '-every-family-and-kind-preserves-actual-status-and-eyes', async () => {
      const catalog = await page.evaluate(async () => (await import('/character-player.js')).getCharacterSkins());
      assert.equal(catalog.reduce((sum, family) => sum + family.shapes.length, 0), 77);
      // The two-eyed families keep the same svg and eye nodes across every switch; the One family
      // replaces them with its own head and is checked on its own below.
      for (const family of catalog.filter(entry => entry.id !== 'one')) {
        await page.selectOption('#skin', family.id);
        for (const shape of family.shapes) {
          await page.selectOption('#shape', shape);
          assert.equal(await page.locator('#avatar svg').getAttribute('data-character-shape'), shape);
          assert.equal(await page.locator('#avatar svg').getAttribute('data-character-status'), 'success');
          assert.equal(await page.locator('#avatar svg').getAttribute('data-character-expression'), 'happy');
          assert.equal(await page.locator('#avatar [data-character-accessory]').count(), 2);
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
    await browserCheck(label + '-remove-accessories-without-resetting-state', async () => {
      await page.getByLabel('Glasses', { exact: true }).uncheck();
      await page.getByLabel('Headphones', { exact: true }).uncheck();
      assert.equal(await page.locator('#avatar [data-character-accessory]').count(), 0);
      assert.equal(await page.locator('#avatar svg').getAttribute('data-character-status'), 'success');
      assert(await page.evaluate(() => document.querySelector('#avatar svg') === window.oaidOriginalSvg));
    });
    await browserCheck(label + '-plush-and-raised-controls-preserve-real-status', async () => {
      await page.selectOption('#finish', 'flat');
      await page.selectOption('#eye-placement', 'raised');
      assert.equal(await page.locator('#avatar svg').getAttribute('data-character-finish'), 'flat');
      assert.equal(await page.locator('#avatar [data-character-eye-mount]').count(), 1);
      assert.equal(await page.locator('#avatar svg').getAttribute('data-character-status'), 'success');
      await page.selectOption('#finish', 'plush');
      assert.equal(await page.locator('#avatar filter').count(), 2);
      await page.selectOption('#eye-placement', 'face');
      assert(await page.evaluate(() => document.querySelector('#avatar svg') === window.oaidOriginalSvg &&
        [...document.querySelectorAll('#avatar [data-character-eye]')].every((eye, i) => eye === window.oaidOriginalEyes[i])));
    });
    await browserCheck(label + '-one-family-keeps-real-status-and-returns', async () => {
      await page.selectOption('#skin', 'one');
      await page.waitForSelector('#avatar svg[data-character-skin="one"]');
      assert.equal(await page.locator('#avatar svg').count(), 1);
      assert.equal(await page.locator('#avatar svg').getAttribute('data-character-status'), 'success');
      assert.equal(await page.locator('#avatar svg').getAttribute('data-one-face'), 'done');
      assert.equal(await page.locator('#avatar [data-one-eye]').count(), 1);
      assert.equal(await page.locator('#avatar [data-character-eye]').count(), 0);
      assert.equal(await page.locator('#avatar [data-character-accessory]').count(), 0);
      await page.selectOption('#skin', 'autos');
      await page.waitForSelector('#avatar svg[data-character-skin="autos"]');
      assert.equal(await page.locator('#avatar svg').count(), 1);
      assert.equal(await page.locator('#avatar [data-character-eye]').count(), 2);
      assert.equal(await page.locator('#avatar svg').getAttribute('data-character-status'), 'success');
    });
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
          const families = getCharacterSkins().filter(family => family.id !== 'one');
          for (const family of families) {
            const group = document.createElement('div'); group.dataset.characterFamily = family.id; gallery.append(group);
            const heading = document.createElement('h3'); heading.textContent = family.label; group.append(heading);
            const row = document.createElement('div'); row.style.cssText = 'display:flex;flex-wrap:wrap;gap:14px'; group.append(row);
            for (const shape of family.shapes) {
              const card = document.createElement('div'); card.style.cssText = 'width:210px;background:#fff;border-radius:18px;padding:8px;box-sizing:border-box'; row.append(card);
              const images = document.createElement('div'); images.style.cssText = 'display:flex;align-items:center'; card.append(images);
              const full = document.createElement('div'); const face = document.createElement('div'); images.append(full, face);
              face.style.cssText = 'border-radius:50%;overflow:hidden;width:88px;height:88px;flex-shrink:0';
              const accessories = ['glasses', 'headphones'];
              players.push(mountCharacter(full, 'did:oas:openagent:agent:family-qualification', { skin: family.id, shape, accessories, view: 'full', size: 104, reducedMotion: true }));
              const player = mountCharacter(face, 'did:oas:openagent:agent:family-qualification', { skin: family.id, shape, accessories, size: 88, reducedMotion: true });
              players.push(player);
              const svg = face.querySelector('svg'), originalEyes = [...face.querySelectorAll('[data-character-eye]')];
              // Sample the actual painted outline, including stroke, against the circular avatar mask.
              const mask = svg.getBoundingClientRect(), mx = mask.x + mask.width / 2, my = mask.y + mask.height / 2;
              for (const geometry of face.querySelectorAll('[data-character-accessories] path, [data-character-accessories] rect, [data-character-accessories] circle, [data-character-accessories] ellipse')) {
                const transform = geometry.getScreenCTM();
                const stroke = Number.parseFloat(getComputedStyle(geometry).strokeWidth) / 2 * Math.hypot(transform.a, transform.b);
                const length = geometry.getTotalLength();
                for (let sample = 0; sample <= 128; sample++) {
                  const point = geometry.getPointAtLength(length * sample / 128).matrixTransform(transform);
                  if (Math.hypot(point.x - mx, point.y - my) + stroke > mask.width / 2 - .25) {
                    failures.push('accessory-crop:' + family.id + '/' + shape); break;
                  }
                }
              }
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
              if (Number(svg.getAttribute('viewBox').split(' ')[2]) < 512) failures.push('full-view:' + family.id + '/' + shape);
              player.setAppearance({ view: 'avatar' });
              for (const accessories of [[], ['glasses'], ['headphones'], ['glasses', 'headphones']]) {
                player.setAppearance({ accessories });
                if (face.querySelectorAll('[data-character-accessory]').length !== accessories.length) failures.push('accessory-selection:' + family.id + '/' + shape);
              }
              for (const accessories of [null, 'glasses', ['unknown'], ['glasses', 'glasses']]) {
                const before = svg.outerHTML;
                try { player.setAppearance({ accessories }); failures.push('invalid-accessory-accepted'); } catch { /* expected refusal */ }
                if (svg.outerHTML !== before) failures.push('invalid-accessory-mutated-player');
              }
              if (originalEyes.some((eye, i) => eye !== face.querySelectorAll('[data-character-eye]')[i]) || player.getState().status !== 'reasoning') failures.push('state-replaced:' + family.id + '/' + shape);
              // Every placement shares fixed frame dimensions, exact eye gaze and a stable crop.
              for (const eyePlacement of ['face', 'raised']) {
                player.setAppearance({ eyePlacement, accessories: ['glasses', 'headphones'] });
                const crop = svg.getAttribute('viewBox');
                const dimensions = () => [...face.querySelectorAll('[data-glasses-frames] rect')].map(e => ['x', 'y', 'width', 'height', 'rx'].map(k => e.getAttribute(k)).join(','));
                const fixedFrames = dimensions();
                const headphone = face.querySelector('[data-character-accessory="headphones"]').outerHTML;
                for (const gaze of [{x:-1,y:-1},{x:1,y:1},{x:0,y:0}]) {
                  player.update({ gaze, expression: 'scared', blink: .6 });
                  const frameTranslate = face.querySelector('[data-glasses-frames]').getAttribute('transform').match(/-?[\d.]+/g).map(Number);
                  const eyeTranslate = face.querySelector('[data-character-eyes]').getAttribute('transform').match(/-?[\d.]+/g).map(Number);
                  const centerY = [...face.querySelectorAll('[data-character-eye]')].reduce((sum,e)=>sum+Number(e.getAttribute('y'))+Number(e.getAttribute('height'))/2,0)/2;
                  if (Math.abs(frameTranslate[0]-eyeTranslate[0])>.001 || Math.abs(264+frameTranslate[1]-centerY-eyeTranslate[1])>.001) failures.push('glasses-desynchronized');
                  if (JSON.stringify(dimensions()) !== JSON.stringify(fixedFrames)) failures.push('glasses-resized');
                  if (headphone !== face.querySelector('[data-character-accessory="headphones"]').outerHTML) failures.push('headphones-moved-with-eyes');
                  if (crop !== svg.getAttribute('viewBox')) failures.push('crop-breathes');
                  const box = svg.getBoundingClientRect(), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
                  for (const geometry of face.querySelectorAll('[data-character-accessories] path,[data-character-accessories] rect,[data-raised-eye-pods] ellipse')) {
                    const transform = geometry.getScreenCTM();
                    const stroke = Number.parseFloat(getComputedStyle(geometry).strokeWidth) / 2 * Math.hypot(transform.a, transform.b);
                    const length = geometry.getTotalLength();
                    for (let i = 0; i <= 48; i++) {
                      const p = geometry.getPointAtLength(length * i / 48).matrixTransform(transform);
                      if (Math.hypot(p.x-cx,p.y-cy)+stroke > box.width/2-.1) { failures.push('fidelity-crop:'+family.id+'/'+shape+'/'+eyePlacement); break; }
                    }
                  }
                }
              }
              player.setAppearance({ eyePlacement: 'face' });
              player.update({ status: 'reasoning', expression: null, blink: 0, gaze: {x:0,y:0} });
              const footer = document.createElement('div'); footer.style.cssText = 'display:flex;gap:8px;align-items:center;margin:8px'; card.append(footer);
              const mini = document.createElement('div'); mini.style.cssText = 'width:32px;height:32px;border-radius:50%;overflow:hidden'; footer.append(mini);
              players.push(mountCharacter(mini, 'did:oas:openagent:agent:family-qualification', { skin: family.id, shape, accessories, size: 32, reducedMotion: true }));
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
          return { failures: [...new Set(failures)], families: families.map(family => family.id) };
        });
        await page.locator('#family-gallery').screenshot({ path: join(out, 'all-character-families.png') });
        for (const family of result.families) await page.locator('[data-character-family="' + family + '"]').screenshot({ path: join(out, 'family-' + family + '.png') });
        assert.deepEqual(result.failures, []);
      });
      await page.evaluate(() => { window.oaidGalleryPlayers.forEach(player => player.dispose()); document.querySelector('#family-gallery').remove(); });
      await browserCheck('fidelity-large-render-and-synchronized-moving-frames', async () => {
        const result = await page.evaluate(async () => {
          const { mountCharacter } = await import('/character-player.js');
          const gallery = document.createElement('section'); gallery.id = 'fidelity-study';
          gallery.style.cssText = 'display:flex;gap:16px;background:#f7f5f1;padding:24px;color:#252938;width:1248px;box-sizing:border-box;font:14px system-ui';
          document.body.append(gallery); const players = [];
          for (const [label, skin, finish, eyePlacement] of [['Original vector','autos','flat','face'],['Shared plush','autos','plush','face'],['Raised eyes','autos','plush','raised'],['SpaceX raised','spacex','plush','raised']]) {
            const card = document.createElement('div'); gallery.append(card);
            const avatar = document.createElement('div'); avatar.style.cssText = 'width:280px;height:280px;border-radius:50%;overflow:hidden;background:#fff'; card.append(avatar);
            const caption = document.createElement('p'); caption.textContent = label; card.append(caption);
            players.push(mountCharacter(avatar,'did:oas:openagent:agent:character-vector',{skin,shape:skin==='autos'?'standard':'circle',finish,eyePlacement,accessories:['glasses','headphones'],size:280,reducedMotion:false,state:{status:'reasoning'}}));
          }
          const moving = players[1], svg = gallery.children[1].querySelector('svg');
          const frames = [], sizes = new Set(), crops = new Set();
          moving.update({gaze:{x:1,y:-1},expression:'surprised'});
          for(let i=0;i<30;i++) {
            await new Promise(requestAnimationFrame);
            const g = svg.querySelector('[data-glasses-frames]'), e = svg.querySelector('[data-character-eyes]');
            const gt=g.getAttribute('transform').match(/-?[\d.]+/g).map(Number), et=e.getAttribute('transform').match(/-?[\d.]+/g).map(Number);
            const cy=[...svg.querySelectorAll('[data-character-eye]')].reduce((sum,r)=>sum+Number(r.getAttribute('y'))+Number(r.getAttribute('height'))/2,0)/2;
            frames.push({glasses:g.getAttribute('transform'),eyes:e.getAttribute('transform'),same:Math.abs(gt[0]-et[0])<.001&&Math.abs(264+gt[1]-cy-et[1])<.001});
            sizes.add([...g.querySelectorAll('rect')].map(r=>r.getAttribute('width')+':'+r.getAttribute('height')).join('|'));
            crops.add(svg.getAttribute('viewBox'));
          }
          window.oaidFidelityPlayers=players;
          return {synchronized:frames.every(f=>f.same),uniqueFrames:new Set(frames.map(f=>f.eyes)).size,frameSizes:sizes.size,crops:crops.size};
        });
        assert(result.synchronized); assert(result.uniqueFrames>3); assert.equal(result.frameSizes,1); assert.equal(result.crops,1);
        await page.locator('#fidelity-study').screenshot({path:join(out,'fidelity-study.png')});
        await page.evaluate(()=>{window.oaidFidelityPlayers.forEach(p=>p.dispose());document.querySelector('#fidelity-study').remove()});
      });

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
