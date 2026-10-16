/**
 * Real-browser verification for live One heads (the `one` character family).
 *
 * Serves the built SDK browser bundles (sdks/typescript/dist/browser: every
 * family, and the light One runtime) with fixture pages over loopback HTTP and
 * drives Chromium. It checks the calm rules the unit tests cannot: one shared
 * animation-frame ticker that sleeps at rest, at most one moving head per list
 * and three per window, brief cadence, no motion out of view or under reduced
 * motion, accessible naming, live family switching and clean disposal; and on
 * the light runtime: taking over a server-rendered still, a blank head's First
 * blink, eye-only pointer follow, repaints at a moment's end that never strand a
 * moving head, and Digital One stills that match the live head pixel for pixel.
 * Evidence goes to OAID_ONE_ARTIFACT_DIR (default .public-tooling-artifacts/one):
 * receipt.json and PNG screenshots.
 *
 * Run `npm run build` in sdks/typescript first. OAID_CHROMIUM_EXECUTABLE may
 * point at an installed Chromium-based browser; otherwise Playwright's own
 * Chromium is used. Exit status is non-zero on failure.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const artifacts = resolve(process.env.OAID_ONE_ARTIFACT_DIR ?? join(root, '.public-tooling-artifacts/one'));
await mkdir(artifacts, { recursive: true });
const checks = [];
const screenshots = [];
let server, browser, failure, source = null, parityResult = null;

async function check(name, operation) {
  await operation();
  checks.push({ name, passed: true });
  console.log(`passed ${name}`);
}

const colors = ['blue', 'red', 'sky', 'green', 'yellow', 'pink', 'plum', 'teal', 'lime', 'mint', 'lilac', 'coral'];
const list = (id, count, offset = 0) => `<ul id="${id}" class="team">${Array.from({ length: count }, (_, i) =>
  `<li><span class="head" id="${id}-${i}" data-color="${colors[(i + offset) % colors.length]}"></span><span>Agent ${i + 1}</span></li>`).join('')}</ul>`;
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>One heads</title>
<style>
  body { margin: 0; padding: 16px; font: 14px system-ui; background: #f4f2ec; color: #141b16; }
  .team { list-style: none; margin: 0 0 16px; padding: 0; display: grid; grid-template-columns: repeat(6, 150px); gap: 8px; }
  .team li { display: flex; gap: 8px; align-items: center; }
  .head { display: block; width: 44px; height: 44px; }
  #hero { width: 96px; height: 96px; }
  #spacer { height: 2400px; }
</style>
<script>
  // Every animation-frame callback is tagged with its frame time: callbacks that share a time ran in one frame.
  window.oaidFrames = new Map();
  const native = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => native(time => {
    window.oaidFrames.set(time, (window.oaidFrames.get(time) ?? 0) + 1);
    callback(time);
  });
</script></head><body>
<div id="hero"></div>
${list('team-a', 12)}${list('team-b', 4, 3)}${list('team-c', 4, 6)}${list('team-d', 4, 9)}
<div id="spacer"></div>
${list('below', 3)}
<script type="module">
  import { mountCharacter } from '/character-player.js';
  const row = { x: 0.4, y: 0.1 };
  window.oaidPlayers = new Map();
  for (const element of document.querySelectorAll('.head')) {
    window.oaidPlayers.set(element.id, mountCharacter(element, 'did:oas:openagent:agent:' + element.id, {
      skin: 'one', shape: element.dataset.color, size: 44, label: element.nextElementSibling.textContent + ', agent',
      state: { gaze: row }, reducedMotion: 'system' }));
  }
  window.oaidPlayers.set('hero', mountCharacter(document.getElementById('hero'), 'did:oas:openagent:agent:one', {
    skin: 'one', shape: 'charcoal', size: 96, cadence: 'repeat', reducedMotion: 'system' }));
  window.oaidReady = true;
</script></body></html>`;

// The light One runtime. Stills are rendered on the "server" (this process) with the bundler entry, as a host would.
const { renderOne } = await import(pathToFileURL(join(root, 'sdks/typescript/dist/one.js')).href);
const parity = [
  { status: 'idle', gaze: { x: 0.4, y: 0.1 } }, { status: 'working', gaze: { x: 0.4, y: 0.1 } },
  { status: 'attention' }, { status: 'paused', gaze: { x: -0.4, y: 0.1 } }, { status: 'reasoning', gaze: { x: 0, y: 0.3 } },
];
const stills = parity.map(state => renderOne({ color: 'charcoal', size: 192, state }));
const lean = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>One light runtime</title>
<style>
  body { margin: 0; padding: 16px; font: 14px system-ui; background: #f4f2ec; color: #141b16; }
  .head { display: block; width: 44px; height: 44px; }
  #header { width: 64px; height: 64px; margin: 120px 0 0 300px; }
  #parity { position: absolute; left: -2000px; top: 0; }
  #parity div { width: 192px; height: 192px; }
  .team { list-style: none; margin: 16px 0; padding: 0; display: flex; gap: 12px; }
</style>
<script>
  window.oaidFrames = new Map();
  const native = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => native(time => {
    window.oaidFrames.set(time, (window.oaidFrames.get(time) ?? 0) + 1);
    callback(time);
  });
</script></head><body>
<div id="ssr" class="head">${renderOne({ did: 'did:oas:openagent:agent:ssr', size: 44, label: 'Scout, agent', state: { gaze: { x: 0.4, y: 0.1 } } })}</div>
<ul class="team"><li><span class="head" id="ready"></span>Planner</li><li><span class="head" id="ghost"></span>Quill</li><li><span class="head" id="peer"></span>Ledger</li></ul>
<div id="header"></div>
<div id="parity">${parity.map((_, i) => `<div id="live-${i}"></div>`).join('')}</div>
<script type="module">
  import { mountOne, getOneColors } from '/one.js';
  const row = { x: 0.4, y: 0.1 };
  window.oaidStills = ${JSON.stringify(stills)};
  window.oaidParity = ${JSON.stringify(parity)};
  window.oaidHeads = new Map();
  window.oaidHeads.set('ssr', mountOne(document.getElementById('ssr'), { color: 'blue', size: 44, label: 'Scout, agent', state: { gaze: row } }));
  window.oaidHeads.set('ready', mountOne(document.getElementById('ready'), { color: 'blank', size: 44, label: 'Planner, ready-made agent', state: { gaze: row } }));
  window.oaidHeads.set('ghost', mountOne(document.getElementById('ghost'), { color: 'red', size: 44, label: 'Quill, agent', state: { gaze: row } }));
  window.oaidHeads.set('peer', mountOne(document.getElementById('peer'), { color: 'sky', size: 44, label: 'Ledger, agent', state: { gaze: row } }));
  window.oaidHeads.set('header', mountOne(document.getElementById('header'), { color: 'charcoal', size: 64, label: 'One', follow: true, state: { gaze: { x: 0, y: 0.3 } } }));
  window.oaidParity.forEach((state, i) => window.oaidHeads.set('live-' + i,
    mountOne(document.getElementById('live-' + i), { color: 'charcoal', size: 192, reducedMotion: true, state })));
  window.oaidColours = getOneColors().length;
  window.oaidReady = true;
</script></body></html>`;

function serveFixture(bundle, runtime) {
  return createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    if (request.method !== 'GET') { response.statusCode = 405; response.end(); return; }
    if (path === '/') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(page); return; }
    if (path === '/one') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(lean); return; }
    if (path === '/character-player.js') { response.setHeader('content-type', 'text/javascript; charset=utf-8'); response.end(bundle); return; }
    if (path === '/one.js') { response.setHeader('content-type', 'text/javascript; charset=utf-8'); response.end(runtime); return; }
    response.statusCode = 404;
    response.end('not found');
  });
}

try {
  source = process.env.OAID_SOURCE_SHA ?? spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  assert.match(source, /^[0-9a-f]{40}$/);
  const bundle = await readFile(join(root, 'sdks/typescript/dist/browser/character-player.js'), 'utf8');
  const runtime = await readFile(join(root, 'sdks/typescript/dist/browser/one.js'), 'utf8');
  server = serveFixture(bundle, runtime);
  server.listen(0, '127.0.0.1');
  await new Promise(done => server.once('listening', done));
  const url = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
    ...(process.env.OAID_CHROMIUM_EXECUTABLE ? { executablePath: process.env.OAID_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1000, height: 760 }, reducedMotion: 'no-preference' });
  const tab = await context.newPage();
  const errors = [], external = [];
  tab.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    if (!route.request().url().startsWith(url)) { external.push(route.request().url()); await route.abort(); }
    else await route.continue();
  });
  await tab.goto(url);
  await tab.waitForFunction(() => window.oaidReady === true);
  await tab.waitForTimeout(600);

  async function shot(name) {
    await tab.screenshot({ path: join(artifacts, name) });
    screenshots.push(name);
  }
  const moving = selector => tab.evaluate(selector => document.querySelectorAll(selector + ' svg[data-moving]').length, selector);
  const frames = () => tab.evaluate(() => { const values = [...window.oaidFrames.values()]; window.oaidFrames.clear(); return values; });
  const update = (ids, state) => tab.evaluate(({ ids, state }) => { for (const id of ids) window.oaidPlayers.get(id).update(state); }, { ids, state });
  async function sample(durationMs, selectors) {
    const counts = Object.fromEntries(selectors.map(selector => [selector, 0]));
    const start = Date.now();
    while (Date.now() - start < durationMs) {
      for (const selector of selectors) counts[selector] = Math.max(counts[selector], await moving(selector));
      await tab.waitForTimeout(40);
    }
    return counts;
  }

  await check('decorative-heads-are-named-only-from-the-supplied-label', async () => {
    assert.equal(await tab.locator('#team-a-0 svg').getAttribute('role'), 'img');
    assert.equal(await tab.locator('#team-a-0 svg').getAttribute('aria-label'), 'Agent 1, agent');
    assert.equal(await tab.locator('#hero svg').getAttribute('aria-hidden'), 'true');
    assert.equal(await tab.locator('#hero svg').getAttribute('role'), null);
    assert.equal(await tab.locator('svg[data-character-skin="one"]').count(), 28);
    for (const value of await tab.locator('.team svg').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))) {
      assert.doesNotMatch(value, /\b(?:blue|red|sky|green|yellow|pink|plum|teal|lime|mint|lilac|coral)\b/i);
    }
  });

  await check('nothing-ticks-at-rest', async () => {
    await frames();
    await tab.waitForTimeout(1500);
    assert.deepEqual(await frames(), []);
    assert.equal(await moving('body'), 0);
  });

  await check('one-mover-per-list-and-one-shared-ticker', async () => {
    await frames();
    await update(Array.from({ length: 12 }, (_, i) => 'team-a-' + i), { status: 'working' });
    const counts = await sample(1500, ['#team-a', 'body']);
    assert.equal(counts['#team-a'], 1);
    const perFrame = await frames();
    assert(perFrame.length > 10, 'Expected animation frames while a head moves');
    assert.equal(Math.max(...perFrame), 1, 'More than one animation-frame callback ran in a frame');
  });

  await check('brief-cadence-ends-and-the-ticker-sleeps', async () => {
    await tab.waitForFunction(() => !document.querySelector('svg[data-moving]'), null, { timeout: 12_000 });
    await frames();
    await tab.waitForTimeout(1000);
    assert.deepEqual(await frames(), []);
    for (let i = 0; i < 12; i++) assert.equal(await tab.locator(`#team-a-${i} svg`).getAttribute('data-one-face'), 'working');
  });

  await check('at-most-three-heads-move-in-the-window', async () => {
    await update(['team-a-1', 'team-b-0', 'team-b-1', 'team-c-0', 'team-d-0'], { status: 'attention' });
    const counts = await sample(1200, ['#team-a', '#team-b', '#team-c', '#team-d', 'body']);
    assert(counts.body <= 3, `${counts.body} heads moved at once`);
    assert(counts['#team-b'] <= 1);
    await tab.waitForFunction(() => !document.querySelector('svg[data-moving]'), null, { timeout: 12_000 });
    for (const id of ['team-a-1', 'team-b-0', 'team-b-1', 'team-c-0', 'team-d-0']) {
      assert.equal(await tab.locator(`#${id} svg`).getAttribute('data-one-face'), 'attention');
    }
  });

  await check('out-of-view-heads-wait-until-they-are-seen', async () => {
    await update(['below-0'], { status: 'error' });
    await tab.waitForTimeout(300);
    assert.equal(await moving('#below'), 0);
    await tab.locator('#below').scrollIntoViewIfNeeded();
    await tab.waitForFunction(() => document.querySelector('#below-0 svg[data-moving]') !== null, null, { timeout: 3000 });
    await tab.waitForFunction(() => !document.querySelector('svg[data-moving]'), null, { timeout: 8000 });
    assert.equal(await tab.locator('#below-0 svg').getAttribute('data-one-face'), 'error');
    await tab.evaluate(() => window.scrollTo(0, 0));
    await tab.waitForTimeout(300);
  });

  await shot('one-heads.png');

  await check('reduced-motion-holds-every-face-still', async () => {
    await tab.emulateMedia({ reducedMotion: 'reduce' });
    await tab.waitForTimeout(100);
    await frames();
    await update(['team-a-2', 'team-a-3', 'hero'], { status: 'success' });
    await tab.waitForTimeout(800);
    assert.deepEqual(await frames(), []);
    assert.equal(await moving('body'), 0);
    assert.equal(await tab.locator('#hero svg').getAttribute('data-one-face'), 'done');
    await tab.emulateMedia({ reducedMotion: 'no-preference' });
  });

  await check('colour-switch-and-family-switch-keep-state', async () => {
    await tab.evaluate(() => window.oaidPlayers.get('team-a-4').setAppearance({ shape: 'teal', theme: 'dark' }));
    assert.equal(await tab.locator('#team-a-4 svg').getAttribute('data-one-color'), 'teal');
    assert.equal(await tab.locator('#team-a-4 svg [data-one-disc]').getAttribute('fill'), '#0aaead');
    await tab.evaluate(() => window.oaidPlayers.get('team-a-5').setAppearance({ skin: 'autos' }));
    assert.equal(await tab.locator('#team-a-5 svg').count(), 1);
    assert.equal(await tab.locator('#team-a-5 [data-character-eye]').count(), 2);
    assert.equal(await tab.locator('#team-a-5 svg').getAttribute('data-character-status'), 'working');
    await tab.evaluate(() => window.oaidPlayers.get('team-a-5').setAppearance({ skin: 'one', shape: 'charcoal' }));
    assert.equal(await tab.locator('#team-a-5 svg').count(), 1);
    assert.equal(await tab.locator('#team-a-5 svg').getAttribute('data-one-face'), 'working');
    assert.equal(await tab.locator('#team-a-5 mask').count(), 1);
  });

  await check('dispose-removes-heads-and-stops-ticking', async () => {
    await tab.evaluate(() => { for (const player of window.oaidPlayers.values()) player.dispose(); });
    await frames();
    await tab.waitForTimeout(600);
    assert.equal(await tab.locator('svg').count(), 0);
    assert.deepEqual(await frames(), []);
  });

  // ── The light One runtime (@openagentid/sdk/browser/one) ──
  await tab.goto(url + 'one');
  await tab.waitForFunction(() => window.oaidReady === true);
  await tab.waitForTimeout(600);

  await check('light-runtime-takes-over-a-server-rendered-still', async () => {
    assert.equal(await tab.evaluate(() => window.oaidColours), 12);
    assert.equal(await tab.locator('#ssr svg').count(), 1);
    assert.equal(await tab.locator('#ssr svg').getAttribute('data-character-player'), 'agent-eye-v1');
    assert.equal(await tab.locator('#ssr svg').getAttribute('aria-label'), 'Scout, agent');
    assert.equal(await tab.locator('#ssr [data-one-disc]').getAttribute('fill'), '#3253e6');
  });

  await check('digital-one-stills-match-the-live-head-pixel-for-pixel', async () => {
    const result = await tab.evaluate(async () => {
      const raster = async svg => {
        const image = new Image();
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 192;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, 192, 192);
        return context.getImageData(0, 0, 192, 192).data;
      };
      const out = [];
      for (let i = 0; i < window.oaidStills.length; i++) {
        const still = await raster(window.oaidStills[i]);
        const live = await raster(document.querySelector('#live-' + i + ' svg').outerHTML);
        // Clear pixels well inside the disc are the eye; the paused lid is the smallest at about 180 of them.
        let differing = 0, hole = 0, liveHole = 0;
        for (let p = 3; p < still.length; p += 4) {
          if (Math.abs(still[p] - live[p]) > 128) differing++;
          const inside = Math.hypot((p >> 2) % 192 - 96, Math.floor((p >> 2) / 192) - 96) < 80;
          if (inside && still[p] < 16) hole++;
          if (inside && live[p] < 16) liveHole++;
        }
        out.push({ differing, hole, liveHole });
      }
      return out;
    });
    parityResult = result;
    for (const { differing, hole, liveHole } of result) {
      assert(hole > 100, `Digital One's still eye is not cut out (${hole} clear pixels)`);
      assert(Math.abs(hole - liveHole) <= 0.05 * liveHole + 20, `The still eye has ${hole} clear pixels, the live eye ${liveHole}`);
      assert(differing <= 60, `${differing} pixels differ between the still and the live Digital One`);
    }
  });

  await check('a-blank-head-gets-its-colour-with-first-blink', async () => {
    assert.equal(await tab.locator('#ready svg').getAttribute('data-one-color'), 'blank');
    assert.equal(await tab.locator('#ready [data-one-disc]').getAttribute('fill-opacity'), '0.1');
    await tab.evaluate(() => window.oaidHeads.get('ready').setAppearance({ color: 'teal' }));
    await tab.waitForFunction(() => document.querySelector('#ready svg[data-moving]') !== null, null, { timeout: 1000 });
    await tab.waitForFunction(() => !document.querySelector('#ready svg[data-moving]'), null, { timeout: 4000 });
    assert.equal(await tab.locator('#ready svg').getAttribute('data-one-color'), 'teal');
    assert.equal(await tab.locator('#ready [data-one-disc]').getAttribute('fill'), '#0aaead');
    assert.equal(await tab.locator('#ready [data-one-disc]').getAttribute('fill-opacity'), null);
  });

  await check('repaints-at-a-moment-end-never-strand-a-moving-head', async () => {
    await tab.waitForFunction(() => !document.querySelector('svg[data-moving]'), null, { timeout: 4000 });
    // A colour change waves (a counted moment); theme repaints land in the same task as its end, many times over.
    await tab.evaluate(() => {
      const head = window.oaidHeads.get('ghost');
      head.setAppearance({ color: 'plum' });
      const start = performance.now();
      let dark = false;
      while (performance.now() - start < 1200) { dark = !dark; head.setAppearance({ theme: dark ? 'dark' : 'light' }); }
      head.setAppearance({ theme: 'light' });
    });
    await tab.waitForFunction(() => !document.querySelector('#ghost svg[data-moving]'), null, { timeout: 3000 });
    // The list's slot was released: the next head in the same list moves at once.
    await tab.evaluate(() => window.oaidHeads.get('peer').update({ status: 'attention' }));
    await tab.waitForFunction(() => document.querySelector('#peer svg[data-moving]') !== null, null, { timeout: 500 });
    await tab.waitForFunction(() => !document.querySelector('svg[data-moving]'), null, { timeout: 4000 });
  });

  await check('pointer-follow-moves-the-eye-only-and-rests', async () => {
    const box = await tab.locator('#header svg').boundingBox();
    const eye = () => tab.locator('#header [data-character-eyes]').getAttribute('transform');
    const held = await eye();
    await frames();
    await tab.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 - 60, { steps: 8 });
    await tab.waitForTimeout(250);
    assert.notEqual(await eye(), held);
    assert.equal(await tab.locator('#header svg').getAttribute('data-moving'), '');
    assert.equal(await tab.locator('#header [data-character-body]').getAttribute('transform'), null);
    assert.equal(await moving('.team'), 0);
    await tab.waitForFunction(() => !document.querySelector('#header svg[data-moving]'), null, { timeout: 4000 });
    assert.equal(await eye(), held);
    await frames();
    await tab.waitForTimeout(600);
    assert.deepEqual(await frames(), []);
  });

  await shot('one-light-runtime.png');

  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  checks.push({ name: 'no-browser-errors-or-external-requests', passed: true });
  await context.close();
} catch (error) {
  failure = error instanceof Error ? error.message : 'One head verification failed';
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise(done => server ? server.close(done) : done());
  await writeFile(join(artifacts, 'receipt.json'), JSON.stringify({ passed: !failure, node: process.version, source,
    checks, screenshots, digitalOneParity: parityResult, failure }, null, 2) + '\n');
  console.log(failure ? `One head verification failed: ${failure}` : `One head verification passed: ${checks.length} checks`);
}
