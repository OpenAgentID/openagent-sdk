/**
 * Packed-package browser verification for the Continue as Agent button.
 *
 * Installs the exact @openagentid/sdk and @openagentid/oidc archives into a
 * disposable consumer, serves the bundled review page over loopback HTTP and
 * drives real Chromium. Evidence goes to OAID_BUTTON_ARTIFACT_DIR:
 * receipt.json (passed, source), PNG screenshots, the served HTML/CSS/JS under
 * preview/ and the same bytes in preview-files.json. Exit status is non-zero on failure.
 *
 * Environment: OAID_SDK_TARBALL / OAID_OIDC_TARBALL (defaults: pack from the
 * built source packages), OAID_SOURCE_SHA (defaults: git HEAD),
 * OAID_BUTTON_ARTIFACT_DIR (default: .public-tooling-artifacts/button), and
 * OAID_EXPECTED_SDK_VERSION, the @openagentid/sdk version the consumer must
 * resolve (default: the source sdks/typescript version). A registry-consumer
 * run sets it to the supported minimum public SDK, for example 0.7.2, while
 * installing that published archive; it is a verifier assertion only and never
 * changes the package's runtime or its peer range.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const artifacts = resolve(process.env.OAID_BUTTON_ARTIFACT_DIR ?? join(root, '.public-tooling-artifacts/button'));
await mkdir(artifacts, { recursive: true });
const fixture = await mkdtemp(join(root, '.public-button-'));
const checks = [];
const logs = [];
const screenshots = [];
const LABEL = 'Continue as Agent';
let server, browser, failure, source = null;

function run(name, command, cwd, timeout = 240_000) {
  const result = spawnSync(command[0], command.slice(1), {
    cwd, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, CI: 'true', npm_config_audit: 'false', npm_config_fund: 'false' },
  });
  logs.push(writeFile(join(artifacts, name + '.log'), (result.stdout ?? '') + (result.stderr ?? '')));
  assert.equal(result.status, 0, `${name} failed; inspect ${name}.log`);
  checks.push({ name, passed: true });
  return result.stdout;
}
async function check(name, operation) {
  await operation();
  checks.push({ name, passed: true });
}
async function tarball(envName, directory, expectedName) {
  const configured = process.env[envName];
  if (configured) {
    await stat(configured);
    return resolve(configured);
  }
  const destination = join(fixture, 'packages');
  await mkdir(destination, { recursive: true });
  const result = JSON.parse(run('pack-' + basename(expectedName), ['npm', 'pack', '--json', '--ignore-scripts', '--pack-destination', destination], directory))[0];
  assert.equal(result.name, expectedName);
  return join(destination, result.filename);
}
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml' };
function serve(directory) {
  return createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const target = normalize(join(directory, path === '/' ? '/index.html' : path));
    if (!target.startsWith(directory + '/') || path.includes('..')) { res.statusCode = 403; res.end(); return; }
    stat(target).then(info => {
      if (!info.isFile()) throw new Error('not a file');
      res.setHeader('content-type', mime[extname(target)] ?? 'application/octet-stream');
      createReadStream(target).pipe(res);
    }).catch(() => { res.statusCode = 404; res.end('not found'); });
  });
}
async function listen(httpServer) {
  httpServer.listen(0, '127.0.0.1');
  await new Promise(done => httpServer.once('listening', done));
  return `http://127.0.0.1:${httpServer.address().port}`;
}
/** Distinct eye geometries painted by the SDK player over `durationMs` of animation frames. */
async function eyeFrames(page, selector, durationMs) {
  return page.evaluate(async ({ selector, durationMs }) => {
    const svg = document.querySelector(selector);
    const frames = new Set();
    const start = performance.now();
    do {
      await new Promise(requestAnimationFrame);
      frames.add(svg.querySelector('[data-character-eyes]').getAttribute('transform') + '|' +
        [...svg.querySelectorAll('[data-character-eye]')].map(eye => eye.getAttribute('height') + ':' + eye.getAttribute('width')).join(','));
    } while (performance.now() - start < durationMs);
    return frames.size;
  }, { selector, durationMs });
}
async function openPage(context, url, errors, external) {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== new URL(url).origin) { external.push(route.request().url()); await route.abort(); }
    else await route.continue();
  });
  await page.goto(url + '/index.html');
  await page.waitForSelector('[data-variant="selected"] .oaid-continue__button');
  return page;
}
async function shot(page, selector, name) {
  const path = join(artifacts, name);
  if (selector) await page.locator(selector).screenshot({ path });
  else await page.screenshot({ path, fullPage: true });
  screenshots.push(name);
}

try {
  source = process.env.OAID_SOURCE_SHA ?? spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  assert.match(source, /^[0-9a-f]{40}$/);
  const oidcManifest = JSON.parse(await readFile(join(root, 'bridges/oidc/typescript/package.json'), 'utf8'));
  const sdkManifest = JSON.parse(await readFile(join(root, 'sdks/typescript/package.json'), 'utf8'));
  const expectedSdkVersion = process.env.OAID_EXPECTED_SDK_VERSION ?? sdkManifest.version;
  assert.match(expectedSdkVersion, /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/, 'OAID_EXPECTED_SDK_VERSION must be a semver version');
  const sdkArchive = await tarball('OAID_SDK_TARBALL', join(root, 'sdks/typescript'), '@openagentid/sdk');
  const oidcArchive = await tarball('OAID_OIDC_TARBALL', join(root, 'bridges/oidc/typescript'), '@openagentid/oidc');

  // A plain consumer: both exact archives, every other dependency from the public registry.
  const consumer = join(fixture, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'continue-as-agent-consumer', private: true, type: 'module' }));
  run('install-packed-sdk-and-oidc', ['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', sdkArchive, oidcArchive], consumer);
  const lock = JSON.parse(await readFile(join(consumer, 'package-lock.json'), 'utf8'));
  await check('consumer-resolves-only-public-registry-or-exact-archives', async () => {
    for (const [name, entry] of Object.entries(lock.packages)) {
      if (!entry.resolved) continue;
      assert(entry.resolved.startsWith('https://registry.npmjs.org/') || entry.resolved.endsWith(basename(sdkArchive)) ||
        entry.resolved.endsWith(basename(oidcArchive)), 'Non-public resolution for ' + name);
    }
    assert.equal(lock.packages['node_modules/@openagentid/sdk'].version, expectedSdkVersion);
    const installedSdk = JSON.parse(await readFile(join(consumer, 'node_modules/@openagentid/sdk/package.json'), 'utf8'));
    assert.equal(installedSdk.version, expectedSdkVersion);
    assert.equal(lock.packages['node_modules/@openagentid/oidc'].version, oidcManifest.version);
  });

  const installedOidc = join(consumer, 'node_modules/@openagentid/oidc');
  const buttonBundle = await readFile(join(installedOidc, 'dist/button.js'), 'utf8');
  const buttonCss = await readFile(join(installedOidc, 'styles/button.css'), 'utf8');
  await check('packed-browser-entry-separate-from-node-provider-graph', async () => {
    const installed = JSON.parse(await readFile(join(installedOidc, 'package.json'), 'utf8'));
    assert.deepEqual(installed.exports['./button'], { types: './dist/button.d.ts', import: './dist/button.js' });
    assert.equal(installed.exports['./button.css'], './styles/button.css');
    assert.deepEqual(installed.peerDependenciesMeta['@openagentid/sdk'], { optional: true });
    await stat(join(installedOidc, 'dist/button.d.ts'));
    const specifiers = [...buttonBundle.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map(match => match[1]);
    assert(specifiers.length > 0, 'Button bundle has no imports');
    for (const specifier of specifiers) assert.match(specifier, /^@openagentid\/sdk\/(?:character-player|characters)$/);
    assert.match(buttonCss, /\.oaid-continue__eyes \[data-character-body\] \{\s*display: none;/);
    assert.doesNotMatch(buttonBundle, /oidc-provider|["']node:|["']jose["']|["']zod["']|XMLHttpRequest|fetch\(/);
    const provider = await readFile(join(installedOidc, 'dist/index.js'), 'utf8');
    assert.match(provider, /oidc-provider/);
    assert.doesNotMatch(provider, /mountContinueAsAgent/);
    await stat(join(consumer, 'node_modules/@openagentid/sdk/dist/browser/character-player.js'));
  });

  // The committed review page, served exactly as a developer would run it.
  const example = join(root, 'bridges/oidc/typescript/examples/continue-as-agent');
  for (const file of ['index.html', 'demo.js']) await cp(join(example, file), join(consumer, file));
  server = serve(consumer);
  const url = await listen(server);
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const errors = [], external = [];

  // Light, animated context: brand consistency, interaction and lifecycle.
  const light = await browser.newContext({ viewport: { width: 1120, height: 960 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'no-preference' });
  const page = await openPage(light, url, errors, external);
  const buttons = page.getByRole('button', { name: LABEL, exact: true });
  await check('twelve-buttons-with-exact-accessible-name-and-label', async () => {
    assert.equal(await buttons.count(), 12);
    assert.equal(await page.locator('.oaid-continue__button').count(), 12);
    for (const text of await page.locator('.oaid-continue__label').allTextContents()) assert.equal(text, LABEL);
    assert.equal(await page.locator('.oaid-continue__avatar[aria-hidden="true"]').count(), 12);
    assert.equal(await page.locator('.oaid-continue__mark[aria-hidden="true"]').count(), 12);
  });
  const appearances = await page.evaluate(() => Object.fromEntries(Object.entries(window.oaidContinueDemo.handles)
    .map(([variant, handle]) => [variant, { ...handle.appearance }])));
  await check('eyes-only-window-with-unique-decorative-seeds-and-no-visible-body', async () => {
    const decorative = Object.entries(appearances).filter(([variant]) => variant !== 'selected');
    assert.equal(decorative.length, 11);
    for (const [, appearance] of decorative) {
      assert.equal(appearance.decorative, true);
      assert.match(appearance.did, /^did:oas:openagent:agent:decorative-[0-9a-f]{16}$/);
      assert.deepEqual(Object.keys(appearance).sort(), ['decorative', 'did']);
    }
    assert.equal(new Set(Object.values(appearances).map(appearance => appearance.did)).size, 12);
    assert.deepEqual(appearances.selected, { did: 'did:oas:openagent:agent:review-selected-agent', decorative: false });
    assert.equal(await page.locator('.oaid-continue__avatar > .oaid-continue__eyes > svg[data-character-player="live-v1"]').count(), 12);
    assert.equal(await page.locator('.oaid-continue__eyes svg[data-character-skin="autos"][data-character-shape="standard"][data-character-finish="flat"][data-character-eye-placement="face"]').count(), 12);
    assert.equal(await page.locator('.oaid-continue__eyes [data-character-accessory]').count(), 0);
    assert.equal(await page.locator('.oaid-continue__eyes [data-character-eye-mount]').count(), 0);
    assert.equal(await page.locator('.oaid-continue__eyes [data-character-eye]').count(), 24);
    const painted = await page.evaluate(() => [...document.querySelectorAll('.oaid-continue__eyes svg')].map(svg => {
      const body = svg.querySelector('[data-character-body]');
      const eyes = [...svg.querySelectorAll('[data-character-eye]')].map(eye => eye.getBoundingClientRect());
      const window = svg.closest('.oaid-continue__avatar').getBoundingClientRect();
      return { body: body ? getComputedStyle(body).display : 'missing', bodyBox: body ? body.getBoundingClientRect().width : -1,
        eyeFill: getComputedStyle(svg.querySelector('[data-character-eyes]')).fill,
        eyesVisible: eyes.every(box => box.width > 1 && box.height > 1 && box.left >= window.left - 1 && box.right <= window.right + 1 && box.top >= window.top - 1 && box.bottom <= window.bottom + 1),
        windowBackground: getComputedStyle(svg.closest('.oaid-continue__avatar')).backgroundColor };
    }));
    assert.equal(painted.length, 12);
    for (const item of painted) {
      assert.equal(item.body, 'none'); assert.equal(item.bodyBox, 0);
      assert.equal(item.eyeFill, 'rgb(255, 255, 255)'); assert.equal(item.eyesVisible, true);
      assert.equal(item.windowBackground, 'rgb(13, 13, 20)');
    }
  });
  await check('one-canonical-silhouette-across-variants', async () => {
    const metrics = await page.evaluate(() => Object.fromEntries(Object.entries(window.oaidContinueDemo.handles).map(([variant, handle]) => {
      const box = handle.button.getBoundingClientRect(), style = getComputedStyle(handle.button);
      const avatar = handle.button.querySelector('.oaid-continue__avatar').getBoundingClientRect();
      const eyes = handle.button.querySelector('.oaid-continue__eyes').getBoundingClientRect();
      const mark = handle.button.querySelector('.oaid-continue__mark').getBoundingClientRect();
      return [variant, { width: Math.round(box.width), height: Math.round(box.height), radius: style.borderTopLeftRadius, font: style.fontSize + '/' + style.fontWeight,
        avatar: Math.round(avatar.width) + 'x' + Math.round(avatar.height), eyesWindow: Math.round(eyes.width), mark: Math.round(mark.height), background: style.backgroundColor, color: style.color }];
    })));
    const medium = ['light-1', 'light-2', 'light-3', 'dark-1', 'dark-2', 'dark-3', 'disabled', 'loading', 'error', 'selected'];
    for (const variant of medium) {
      assert.equal(metrics[variant].height, 44, variant); assert.equal(metrics[variant].width, metrics['light-1'].width, variant);
      assert.equal(metrics[variant].font, metrics['light-1'].font); assert.equal(metrics[variant].avatar, '32x32'); assert.equal(metrics[variant].mark, 18);
      assert.equal(metrics[variant].eyesWindow, 43);
    }
    assert.equal(metrics.large.height, 52); assert.equal(metrics.large.avatar, '32x32');
    assert(metrics['full-width'].width > metrics['light-1'].width * 2);
    assert.equal(metrics['light-1'].background, 'rgb(11, 11, 15)'); assert.equal(metrics['light-1'].color, 'rgb(255, 255, 255)');
    assert.equal(metrics['dark-1'].background, 'rgb(255, 255, 255)'); assert.equal(metrics['dark-1'].color, 'rgb(11, 11, 15)');
    assert.equal(metrics['light-1'].radius, '999px');
  });
  await check('avatar-slot-plays-live-sdk-animation', async () => {
    // Deterministic: a real status change drives the SDK expression spring, sampled through its transition.
    const transition = await page.evaluate(async () => {
      const host = document.createElement('div'); host.id = 'animation-probe'; document.body.append(host);
      const handle = window.oaidContinueDemo.mountContinueAsAgent(host, { onContinue: () => new Promise(() => {}) });
      const svg = host.querySelector('svg[data-character-player]');
      // The SDK player reports the default expression as its status until a host supplies one.
      const idle = [svg.getAttribute('data-character-status'), svg.getAttribute('data-character-expression')];
      handle.button.click();
      const frames = new Set();
      const start = performance.now();
      do {
        await new Promise(requestAnimationFrame);
        frames.add(svg.querySelector('[data-character-eyes]').getAttribute('transform') + '|' +
          [...svg.querySelectorAll('[data-character-eye]')].map(eye => eye.getAttribute('height') + ':' + eye.getAttribute('width')).join(','));
      } while (performance.now() - start < 900);
      const status = [svg.getAttribute('data-character-status'), svg.getAttribute('data-character-expression')];
      // Settled thoughtful pose: both eyes tilted, the right eye narrowed well below the neutral 72-unit height.
      await new Promise(resolve => setTimeout(resolve, 1200));
      const settled = [...svg.querySelectorAll('[data-character-eye]')].map(eye => ({ height: Number(eye.getAttribute('height')),
        rotation: Number((eye.getAttribute('transform') || '').match(/rotate\(\s*(-?[\d.]+)/)?.[1] ?? 0) }));
      handle.dispose(); host.remove();
      return { idle, status, frames: frames.size, settled, removed: document.querySelector('#animation-probe') === null };
    });
    assert(transition.settled.every(eye => Math.abs(eye.rotation + 9) < 1.5), 'Expected tilted eyes, saw ' + JSON.stringify(transition.settled));
    assert(transition.settled.some(eye => eye.height < 50) && transition.settled.every(eye => eye.height < 66), 'Expected a squint, saw ' + JSON.stringify(transition.settled));
    // Public SDK mapping: reasoning -> thoughtful, success -> happy, error -> concerned.
    assert.deepEqual(transition.idle, ['neutral', 'neutral']); assert.deepEqual(transition.status, ['reasoning', 'thoughtful']);
    assert.equal(transition.removed, true);
    assert(transition.frames > 3, 'Expected the SDK expression transition to paint distinct frames, saw ' + transition.frames);
    // Ambient idle motion, sampled across the SDK's full bounded gaze cycle (at most ~3.1 s).
    assert(await eyeFrames(page, '[data-variant="light-1"] svg[data-character-player]', 3600) > 3, 'Expected ambient live eyes over a full cycle');
  });
  await check('idle-eyes-glance-tilt-squint-and-pause-within-the-window', async () => {
    // Idle choreography fires every 1.8-4.2 s; an 18 s window sees at least four glances with pauses between them.
    const idle = await page.evaluate(async () => {
      const handle = window.oaidContinueDemo.handles['light-2'];
      const wrapper = handle.root.querySelector('.oaid-continue__eyes'), svg = wrapper.querySelector('svg');
      const window_ = handle.root.querySelector('.oaid-continue__avatar').getBoundingClientRect();
      const expressions = new Set(), looks = new Set(), tilts = new Set();
      let maxOverflow = 0, holds = 0, previous = null;
      const start = performance.now();
      while (performance.now() - start < 18_000) {
        await new Promise(resolve => setTimeout(resolve, 120));
        expressions.add(svg.getAttribute('data-character-expression'));
        const look = [wrapper.style.getPropertyValue('--oaid-eyes-x'), wrapper.style.getPropertyValue('--oaid-eyes-y')].join(',');
        const tilt = wrapper.style.getPropertyValue('--oaid-eyes-tilt');
        looks.add(look); tilts.add(tilt);
        if (previous === look + tilt) holds += 1; previous = look + tilt;
        for (const eye of svg.querySelectorAll('[data-character-eye]')) {
          const box = eye.getBoundingClientRect();
          maxOverflow = Math.max(maxOverflow, window_.left - box.left, box.right - window_.right, window_.top - box.top, box.bottom - window_.bottom);
        }
      }
      const sdkEyes = svg.querySelector('[data-character-eyes]');
      return { expressions: [...expressions], looks: looks.size, tilts: tilts.size, holds, maxOverflow,
        sdkTransformIntact: /^translate\(/.test(sdkEyes.getAttribute('transform')) && getComputedStyle(sdkEyes).rotate === 'none' && sdkEyes.style.transform === '',
        wrapperTransform: getComputedStyle(wrapper).transform, transition: getComputedStyle(wrapper).transitionDuration };
    });
    assert(idle.expressions.length >= 2, 'Expected changing idle expressions, saw ' + idle.expressions.join(','));
    assert(idle.looks >= 2, 'Expected the eyes to move to another spot in the window'); assert(idle.tilts >= 2, 'Expected the eyes to tilt');
    assert(idle.holds > 60, 'Expected natural pauses between glances, saw ' + idle.holds);
    assert(idle.maxOverflow <= 1, 'Eyes left the window by ' + idle.maxOverflow + 'px');
    assert.equal(idle.sdkTransformIntact, true); assert.notEqual(idle.wrapperTransform, 'none'); assert.equal(idle.transition, '0.72s');
  });
  await check('hover-and-focus-draw-the-eyes-to-the-viewer-and-are-tracked-separately', async () => {
    const svg = page.locator('[data-variant="light-3"] svg[data-character-player]');
    const wrapper = page.locator('[data-variant="light-3"] .oaid-continue__eyes');
    await page.locator('[data-variant="light-3"] .oaid-continue__button').hover();
    assert.equal(await svg.getAttribute('data-character-status'), 'listening');
    assert.equal(await svg.getAttribute('data-character-expression'), 'attentive');
    assert.equal(await wrapper.evaluate(node => [node.style.getPropertyValue('--oaid-eyes-x'), node.style.getPropertyValue('--oaid-eyes-y'), node.style.getPropertyValue('--oaid-eyes-tilt')].join(' ')), '0px 0px 0deg');
    await page.evaluate(() => window.oaidContinueDemo.handles['light-3'].button.focus());
    await page.mouse.move(4, 4);
    await page.waitForTimeout(5000);
    // Still focused: idle glances must not resume just because the pointer left.
    assert.equal(await svg.getAttribute('data-character-status'), 'listening');
    await page.evaluate(() => window.oaidContinueDemo.handles['light-3'].button.blur());
    assert.equal(await svg.getAttribute('data-character-status'), 'idle');
  });
  const before = await page.evaluate(() => { const svg = document.querySelector('[data-variant="light-1"] svg[data-character-player]');
    window.oaidOriginalSvg = svg; return [svg.getAttribute('data-character-skin'), svg.getAttribute('data-character-shape')]; });
  await check('keyboard-focus-ring-and-enter-space-activation', async () => {
    await page.locator('body').click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => document.activeElement === window.oaidContinueDemo.handles['light-1'].button));
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow), 'none');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    const lines = await page.evaluate(() => window.oaidContinueDemo.lines.filter(line => line.includes('light-1: onContinue called')));
    assert.equal(lines.length, 2);
    assert.equal(await page.locator('[data-variant="light-1"] .oaid-continue__button').getAttribute('data-state'), 'idle');
  });
  await check('seed-and-avatar-node-stable-across-interactions', async () => {
    await page.locator('[data-variant="light-1"] .oaid-continue__button').click();
    const after = await page.evaluate(() => { const svg = document.querySelector('[data-variant="light-1"] svg[data-character-player]');
      return [svg.getAttribute('data-character-skin'), svg.getAttribute('data-character-shape'), svg === window.oaidOriginalSvg]; });
    assert.deepEqual(after, [...before, true]);
    assert.deepEqual(await page.evaluate(() => ({ ...window.oaidContinueDemo.handles['light-1'].appearance })), appearances['light-1']);
  });
  await check('status-live-region-mounted-empty-before-any-failure', async () => {
    const region = await page.evaluate(() => {
      const status = document.querySelector('[data-variant="error"] .oaid-continue__status');
      const style = getComputedStyle(status);
      return { role: status.getAttribute('role'), live: status.getAttribute('aria-live'), text: status.textContent, hidden: status.hidden,
        display: style.display, visibility: style.visibility, height: status.getBoundingClientRect().height, id: status.id.length > 0 };
    });
    assert.deepEqual(region, { role: 'status', live: 'polite', text: '', hidden: false, display: 'block', visibility: 'visible', height: 0, id: true });
  });
  await check('async-pending-ignores-duplicate-clicks-keeps-label-and-size', async () => {
    const widthBefore = await page.locator('[data-variant="loading"] .oaid-continue__button').evaluate(node => node.getBoundingClientRect().width);
    await page.evaluate(() => { const { button } = window.oaidContinueDemo.handles.loading; button.click(); button.click(); button.click(); });
    const button = page.locator('[data-variant="loading"] .oaid-continue__button');
    assert.equal(await button.getAttribute('aria-busy'), 'true');
    assert.equal(await button.getAttribute('data-state'), 'loading');
    assert.equal(await button.getAttribute('disabled'), null);
    assert.equal(await page.locator('[data-variant="loading"] .oaid-continue__label').textContent(), LABEL);
    assert.equal(await buttons.count(), 12);
    assert.equal(await button.evaluate(node => node.getBoundingClientRect().width), widthBefore);
    assert.equal(await page.locator('[data-variant="loading"] svg[data-character-player]').getAttribute('data-character-status'), 'reasoning');
    assert.equal(await page.locator('[data-variant="loading"] svg[data-character-player]').getAttribute('data-character-expression'), 'thoughtful');
    assert.equal(await page.evaluate(() => window.oaidContinueDemo.lines.filter(line => line.includes('loading: pending')).length), 1);
    await page.locator('[data-variant="error"] .oaid-continue__button').click();
    await page.waitForSelector('[data-variant="error"] .oaid-continue__button[data-state="error"]');
    await shot(page, '#states', 'states-loading-and-error.png');
    await page.evaluate(() => window.oaidContinueDemo.deferred.loading());
    await page.waitForSelector('[data-variant="loading"] .oaid-continue__button[data-state="idle"]');
    assert.equal(await button.getAttribute('aria-busy'), 'false');
    assert.equal(await page.locator('[data-variant="loading"] svg[data-character-player]').getAttribute('data-character-status'), 'success');
    assert.equal(await page.locator('[data-variant="loading"] svg[data-character-player]').getAttribute('data-character-expression'), 'happy');
  });
  await check('async-rejection-recovers-with-accessible-status-and-onError', async () => {
    const button = page.locator('[data-variant="error"] .oaid-continue__button');
    const status = page.locator('[data-variant="error"] .oaid-continue__status');
    assert.equal(await status.getAttribute('role'), 'status');
    assert.equal((await status.textContent()).trim(), 'Could not continue as agent. Try again.');
    assert.equal(await status.evaluate(node => !node.hidden && getComputedStyle(node).display === 'block' && node.getBoundingClientRect().height > 0), true);
    assert.equal(await button.getAttribute('aria-describedby'), await status.getAttribute('id'));
    assert.equal(await button.getAttribute('aria-busy'), 'false');
    assert.equal(await page.locator('[data-variant="error"] svg[data-character-player]').getAttribute('data-character-status'), 'error');
    assert.equal(await page.locator('[data-variant="error"] svg[data-character-player]').getAttribute('data-character-expression'), 'concerned');
    assert.equal(await page.evaluate(() => window.oaidContinueDemo.lines.filter(line => line.includes('onError received')).length), 1);
    // Retrying clears the message while pending, then announces the new failure.
    const cleared = await page.evaluate(() => {
      const handle = window.oaidContinueDemo.handles.error;
      handle.button.click();
      const status = handle.root.querySelector('.oaid-continue__status');
      return { text: status.textContent, state: handle.getState(), described: handle.button.getAttribute('aria-describedby') };
    });
    assert.deepEqual(cleared, { text: '', state: 'loading', described: null });
    await page.waitForFunction(() => window.oaidContinueDemo.lines.filter(line => line.includes('onError received')).length === 2);
    assert.equal(await button.getAttribute('data-state'), 'error');
    assert.equal((await status.textContent()).trim(), 'Could not continue as agent. Try again.');
    assert.equal(await button.getAttribute('aria-describedby'), await status.getAttribute('id'));
  });
  await check('disabled-button-ignores-activation-until-enabled', async () => {
    const button = page.locator('[data-variant="disabled"] .oaid-continue__button');
    assert.equal(await button.isDisabled(), true);
    await page.evaluate(() => window.oaidContinueDemo.handles.disabled.button.click());
    assert.equal(await page.evaluate(() => window.oaidContinueDemo.lines.some(line => line.includes('disabled: onContinue'))), false);
    await page.evaluate(() => window.oaidContinueDemo.handles.disabled.setDisabled(false));
    await button.click();
    assert.equal(await page.evaluate(() => window.oaidContinueDemo.lines.some(line => line.includes('disabled: onContinue'))), true);
    await page.evaluate(() => window.oaidContinueDemo.handles.disabled.setDisabled(true));
  });
  await check('dispose-while-pending-and-after-rejection-is-safe', async () => {
    const result = await page.evaluate(async () => {
      const { mountContinueAsAgent } = window.oaidContinueDemo;
      const host = document.createElement('div'); document.body.append(host);
      let resolveLater, rejectLater, calls = 0, errors = 0;
      const first = mountContinueAsAgent(host, { onContinue: () => { calls++; return new Promise(resolve => { resolveLater = resolve; }); } });
      const second = mountContinueAsAgent(host, { onContinue: () => { calls++; return new Promise((_, reject) => { rejectLater = reject; }); }, onError: () => { errors++; } });
      const children = host.children.length;
      first.button.click(); second.button.click();
      first.dispose(); second.dispose(); first.dispose();
      const removed = host.children.length;
      resolveLater(); rejectLater(new Error('late'));
      await new Promise(resolve => setTimeout(resolve, 20));
      let setAfterDispose = null;
      try { first.setDisabled(true); } catch (error) { setAfterDispose = error.message; }
      host.remove();
      return { children, removed, calls, errors, setAfterDispose, states: [first.getState(), second.getState()] };
    });
    assert.deepEqual(result, { children: 2, removed: 0, calls: 2, errors: 0, setAfterDispose: 'Continue as Agent button is disposed', states: ['loading', 'loading'] });
  });
  await check('auto-theme-follows-light-color-scheme', async () => {
    const background = await page.evaluate(() => {
      const host = document.createElement('div'); document.body.append(host);
      const handle = window.oaidContinueDemo.mountContinueAsAgent(host, { onContinue: () => {} });
      const value = getComputedStyle(handle.button).backgroundColor; handle.dispose(); host.remove(); return value;
    });
    assert.equal(background, 'rgb(11, 11, 15)');
  });
  await check('invalid-options-rejected-before-mounting', async () => {
    const messages = await page.evaluate(() => {
      const { mountContinueAsAgent } = window.oaidContinueDemo;
      const host = document.createElement('div'); document.body.append(host);
      const attempts = [() => mountContinueAsAgent(host, {}), () => mountContinueAsAgent(host, { onContinue() {}, theme: 'neon' }),
        () => mountContinueAsAgent(host, { onContinue() {}, appearance: { did: 'not-a-did' } }), () => mountContinueAsAgent(host, { onContinue() {}, issuer: 'https://x' })];
      const result = attempts.map(attempt => { try { attempt(); return 'mounted'; } catch (error) { return error.constructor.name; } });
      result.push(host.children.length); host.remove(); return result;
    });
    assert.deepEqual(messages, ['TypeError', 'TypeError', 'TypeError', 'TypeError', 0]);
  });
  await shot(page, '#light', 'light-eyes.png');
  await shot(page, '#dark', 'dark-eyes.png');
  await shot(page, '#sizes', 'sizes.png');
  await shot(page, null, 'review-page.png');
  await light.close();

  // Dark system color scheme: theme auto flips to the white button.
  const dark = await browser.newContext({ viewport: { width: 1120, height: 960 }, deviceScaleFactor: 2, colorScheme: 'dark', reducedMotion: 'no-preference' });
  const darkPage = await openPage(dark, url, errors, external);
  await check('auto-theme-follows-dark-color-scheme', async () => {
    const background = await darkPage.evaluate(() => {
      const host = document.createElement('div'); document.body.append(host);
      const handle = window.oaidContinueDemo.mountContinueAsAgent(host, { onContinue: () => {} });
      const value = getComputedStyle(handle.button).backgroundColor; handle.dispose(); host.remove(); return value;
    });
    assert.equal(background, 'rgb(255, 255, 255)');
  });
  await dark.close();

  // Reduced motion: the real player renders a still character and never animates.
  const reduced = await browser.newContext({ viewport: { width: 1120, height: 960 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'reduce' });
  const reducedPage = await openPage(reduced, url, errors, external);
  await check('reduced-motion-renders-still-eyes', async () => {
    assert.equal(await reducedPage.locator('.oaid-continue__eyes > svg[data-character-player]').count(), 12);
    assert.equal(await eyeFrames(reducedPage, '[data-variant="light-1"] svg[data-character-player]', 3600), 1);
    await reducedPage.waitForTimeout(5000);
    const still = await reducedPage.evaluate(() => [...document.querySelectorAll('.oaid-continue__eyes')].map(wrapper => [
      wrapper.querySelector('svg').getAttribute('data-character-expression'), wrapper.style.getPropertyValue('--oaid-eyes-x'),
      wrapper.style.getPropertyValue('--oaid-eyes-tilt'), getComputedStyle(wrapper).transitionDuration].join(' ')));
    for (const entry of still) assert.equal(entry, 'neutral 0px 0deg 0s');
    await reducedPage.evaluate(() => window.oaidContinueDemo.handles.loading.button.click());
    assert.equal(await reducedPage.evaluate(() => getComputedStyle(document.querySelector('[data-variant="loading"] .oaid-continue__mark')).animationName), 'none');
  });
  await shot(reducedPage, '#light', 'reduced-motion-light.png');
  await reduced.close();

  // Forced colors: a real outline replaces the box-shadow focus ring.
  const forced = await browser.newContext({ viewport: { width: 1120, height: 960 }, deviceScaleFactor: 2, forcedColors: 'active', colorScheme: 'dark' });
  const forcedPage = await openPage(forced, url, errors, external);
  await check('forced-colors-keeps-visible-focus-outline', async () => {
    await forcedPage.locator('body').click({ position: { x: 4, y: 4 } });
    await forcedPage.keyboard.press('Tab');
    const focus = await forcedPage.evaluate(() => { const style = getComputedStyle(document.activeElement);
      return { button: document.activeElement.classList.contains('oaid-continue__button'), style: style.outlineStyle, width: style.outlineWidth }; });
    assert.deepEqual(focus, { button: true, style: 'solid', width: '3px' });
  });
  await shot(forcedPage, '#light', 'forced-colors-focus.png');
  await forced.close();

  await check('no-browser-errors-or-external-network', async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
  });

  // Served preview sources for direct review: loose files plus one JSON bundle of the same bytes.
  const preview = {
    'index.html': await readFile(join(consumer, 'index.html'), 'utf8'),
    'demo.js': await readFile(join(consumer, 'demo.js'), 'utf8'),
    'node_modules/@openagentid/oidc/styles/button.css': buttonCss,
    'node_modules/@openagentid/oidc/dist/button.js': buttonBundle,
    'node_modules/@openagentid/sdk/dist/browser/character-player.js': await readFile(join(consumer, 'node_modules/@openagentid/sdk/dist/browser/character-player.js'), 'utf8'),
  };
  for (const [relative, content] of Object.entries(preview)) {
    const target = join(artifacts, 'preview', relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  await writeFile(join(artifacts, 'preview-files.json'), JSON.stringify({
    note: 'Exact files served to Chromium from the packed consumer; the same files are under preview/. Open preview/index.html over HTTP to review.',
    files: preview,
  }, null, 2) + '\n');
} catch (error) {
  failure = error instanceof Error ? error.message : 'Button qualification failed';
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(done => server ? server.close(done) : done());
  await Promise.all(logs);
  await writeFile(join(artifacts, 'receipt.json'), JSON.stringify({ passed: !failure, source, node: process.version,
    expectedSdkVersion: process.env.OAID_EXPECTED_SDK_VERSION ?? null, checks, screenshots, failure: failure ?? null, demoCallbacksOnly: true, externalNetworkUsed: false,
    authorizationFlowStarted: false }, null, 2) + '\n');
  await rm(fixture, { recursive: true, force: true });
}
