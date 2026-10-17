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
 * moving head, a dropped moment that shows its face without moving, host gestures
 * (taps at once, arrivals once in view, never a gag on a head that needs you or
 * under reduced motion), viewer moments that never move two heads in one list, and
 * Digital One stills that match the live head pixel for pixel.
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
let server, browser, failure, source = null, parityResult = null, optimizerParity = null;

async function check(name, operation) {
  await operation();
  checks.push({ name, passed: true });
  console.log(`passed ${name}`);
}

// The site's cast: every shape in its own colour, in the team shape order (the plan of record, §5.3).
const looks = [['droplet', 'sky'], ['cloud', 'lavender'], ['heart', 'bubblegum'], ['diamond', 'aqua'], ['star', 'lemon'], ['bean', 'grape'], ['blob', 'mint'],
  ['peanut', 'watermelon'], ['egg', 'blush'], ['gumdrop', 'orchid'], ['clover', 'jade'], ['hexagon', 'apricot'], ['squircle', 'indigo'], ['flower', 'cherry']];
const list = (id, count, offset = 0) => `<ul id="${id}" class="team">${Array.from({ length: count }, (_, i) =>
  `<li><span class="head" id="${id}-${i}" data-shape="${looks[(i + offset) % looks.length][0]}" data-color="${looks[(i + offset) % looks.length][1]}"></span><span>Agent ${i + 1}</span></li>`).join('')}</ul>`;
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
      skin: 'one', shape: element.dataset.shape, color: element.dataset.color, size: 44, label: element.nextElementSibling.textContent + ', agent',
      state: { gaze: row }, reducedMotion: 'system' }));
  }
  window.oaidPlayers.set('hero', mountCharacter(document.getElementById('hero'), 'did:oas:openagent:agent:one', {
    skin: 'one', shape: 'charcoal', size: 96, cadence: 'repeat', reducedMotion: 'system' }));
  window.oaidReady = true;
</script></body></html>`;

// The light One runtime. Stills are rendered on the "server" (this process) with the bundler entry, as a host would,
// and the DID default look is computed there too: the browser runtime never hashes a DID.
const { renderOne, oneLookForDid } = await import(pathToFileURL(join(root, 'sdks/typescript/dist/one.js')).href);
const ssrLook = oneLookForDid('did:oas:openagent:agent:ssr');
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
  import { mountOne, getOneColors, getOneShapes } from '/one.js';
  const row = { x: 0.4, y: 0.1 };
  window.oaidStills = ${JSON.stringify(stills)};
  window.oaidParity = ${JSON.stringify(parity)};
  window.oaidHeads = new Map();
  window.oaidSsrLook = ${JSON.stringify(ssrLook)};
  window.oaidHeads.set('ssr', mountOne(document.getElementById('ssr'), { ...window.oaidSsrLook, size: 44, label: 'Scout, agent', state: { gaze: row } }));
  window.oaidHeads.set('ready', mountOne(document.getElementById('ready'), { shape: 'heart', color: 'blank', size: 44, label: 'Planner, ready-made agent', state: { gaze: row } }));
  window.oaidHeads.set('ghost', mountOne(document.getElementById('ghost'), { shape: 'cloud', color: 'lavender', size: 44, label: 'Quill, agent', state: { gaze: row } }));
  window.oaidHeads.set('peer', mountOne(document.getElementById('peer'), { shape: 'droplet', color: 'sky', size: 44, label: 'Ledger, agent', state: { gaze: row } }));
  window.oaidHeads.set('header', mountOne(document.getElementById('header'), { color: 'charcoal', size: 64, label: 'One', follow: true, state: { gaze: { x: 0, y: 0.3 } } }));
  window.oaidParity.forEach((state, i) => window.oaidHeads.set('live-' + i,
    mountOne(document.getElementById('live-' + i), { color: 'charcoal', size: 192, reducedMotion: true, state })));
  window.oaidColours = getOneColors().length;
  window.oaidShapes = getOneShapes().length;
  window.oaidSsrPath = getOneShapes().find(shape => shape.id === window.oaidSsrLook.shape).path;
  window.oaidMount = mountOne;
  window.oaidReady = true;
</script></body></html>`;

function serveFixture(bundle, runtime, reference) {
  return createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    if (request.method !== 'GET') { response.statusCode = 405; response.end(); return; }
    if (path === '/') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(page); return; }
    if (path === '/optimizer') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end('<!doctype html><body></body>'); return; }
    if (path === '/one-reference.js') { response.setHeader('content-type', 'text/javascript; charset=utf-8'); response.end(reference); return; }
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
  const reference = await readFile(join(root, 'sdks/typescript/node_modules/.cache/openagentid/one-reference.js'), 'utf8');
  server = serveFixture(bundle, runtime, reference);
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
  // Settled: no head has moved for a second. A group's next move starts a beat after the last one ends, so a moment
  // with nothing moving is not yet the end.
  async function settled(timeout) {
    const end = Date.now() + timeout;
    let quietSince = null;
    while (Date.now() < end) {
      if (await moving('body')) quietSince = null;
      else if (quietSince === null) quietSince = Date.now();
      else if (Date.now() - quietSince >= 1000) return;
      await tab.waitForTimeout(50);
    }
    throw new Error(`One heads were still moving after ${timeout} ms`);
  }
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
      // Shape and colour names appear only in pickers, never in an accessible name (R6).
      assert.doesNotMatch(value, /\b(?:star|heart|flower|cloud|drop|droplet|square|squircle|diamond|clover|gumdrop|hexagon|egg|blob|peanut|bean)\b/i);
      assert.doesNotMatch(value, /\b(?:berry|lime|blush|jade|periwinkle|cherry|indigo|mint|bubblegum|apricot|sky|lemon|grape|lavender|watermelon|lagoon|orchid|aqua)\b/i);
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
    await settled(12_000);
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
    await settled(12_000);
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
    await settled(8000);
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

  await check('look-switch-and-family-switch-keep-state', async () => {
    await tab.evaluate(() => window.oaidPlayers.get('team-a-4').setAppearance({ shape: 'squircle', color: 'indigo', theme: 'dark' }));
    assert.equal(await tab.locator('#team-a-4 svg').getAttribute('data-one-shape'), 'squircle');
    assert.equal(await tab.locator('#team-a-4 svg').getAttribute('data-one-color'), 'indigo');
    assert.equal(await tab.locator('#team-a-4 svg [data-one-disc]').getAttribute('fill'), '#5660f6');
    // The same disc on both surfaces; the keyline on light only; Digital One black on dark with its rim.
    assert.equal(await tab.locator('#team-a-4 svg [data-one-keyline]').count(), 0);
    await tab.evaluate(() => window.oaidPlayers.get('team-a-4').setAppearance({ shape: 'star', color: 'lemon', theme: 'light' }));
    assert.equal(await tab.locator('#team-a-4 svg [data-one-disc]').getAttribute('fill'), '#ffe93f');
    assert.equal(await tab.locator('#team-a-4 svg [data-one-keyline]').getAttribute('stroke'), '#918312');
    // A never pair is refused and the head keeps its look.
    assert.equal(await tab.evaluate(() => { try { window.oaidPlayers.get('team-a-4').setAppearance({ color: 'cherry' }); return 'changed'; } catch (error) { return error.name; } }), 'TypeError');
    assert.equal(await tab.locator('#team-a-4 svg').getAttribute('data-one-color'), 'lemon');
    await tab.evaluate(() => window.oaidPlayers.get('team-a-6').setAppearance({ shape: 'charcoal', theme: 'dark' }));
    assert.equal(await tab.locator('#team-a-6 svg [data-one-disc]').getAttribute('fill'), '#141b16');
    assert.equal(await tab.locator('#team-a-6 svg [data-one-rim]').getAttribute('stroke'), '#f2f1ea');
    assert.equal(await tab.locator('#team-a-6 svg [data-one-eye]').getAttribute('fill'), '#f2f1ea');
    assert.equal(await tab.locator('#team-a-6 mask').count(), 0);
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
    assert.equal(await tab.evaluate(() => window.oaidColours), 18);
    assert.equal(await tab.evaluate(() => window.oaidShapes), 14);
    assert.equal(await tab.locator('#ssr svg').count(), 1);
    assert.equal(await tab.locator('#ssr svg').getAttribute('data-character-player'), 'agent-eye-v1');
    assert.equal(await tab.locator('#ssr svg').getAttribute('aria-label'), 'Scout, agent');
    assert.equal(await tab.locator('#ssr svg').getAttribute('data-one-shape'), ssrLook.shape);
    assert.equal(await tab.locator('#ssr svg').getAttribute('data-one-color'), ssrLook.color);
    // The live head draws the shape the server-rendered still had: the library's own path.
    assert.equal(await tab.locator('#ssr [data-one-disc]').getAttribute('d'), await tab.evaluate(() => window.oaidSsrPath));
  });

  await check('light-runtime-preserves-every-shape-colour-and-public-status', async () => {
    const result = await tab.evaluate(async () => {
      const { mountCharacter, getCharacterStatuses } = await import('/character-player.js');
      const { getOneShapes, getOneColors, isOneColorAllowed } = await import('/one.js');
      let cases = 0;
      const inspect = host => ({
        shape: host.querySelector('svg').getAttribute('data-one-shape'),
        color: host.querySelector('svg').getAttribute('data-one-color'),
        face: host.querySelector('svg').getAttribute('data-one-face'),
        disc: host.querySelector('[data-one-disc]').getAttribute('d'),
        fill: host.querySelector('[data-one-disc]').getAttribute('fill'),
        eye: host.querySelector('[data-one-eye]').getAttribute('d'),
        transform: host.querySelector('[data-character-eyes]').getAttribute('transform'),
        body: host.querySelector('[data-character-body]').getAttribute('transform'),
      });
      for (const shape of getOneShapes()) {
        const looks = getOneColors().filter(color => isOneColorAllowed(shape.id, color.id));
        for (const color of looks) for (const status of (color.id === shape.color ? getCharacterStatuses().map(entry => entry.status) : ['idle'])) {
          const left = document.createElement('div'), right = document.createElement('div');
          document.body.append(left, right);
          const options = { shape: shape.id, color: color.id, size: 64, reducedMotion: true, state: { status } };
          const light = window.oaidMount(left, options);
          const full = mountCharacter(right, 'did:oas:openagent:agent:bundle-parity', { ...options, skin: 'one' });
          const equal = JSON.stringify(light.getState()) === JSON.stringify(full.getState()) && JSON.stringify(inspect(left)) === JSON.stringify(inspect(right));
          light.dispose(); full.dispose(); left.remove(); right.remove();
          if (!equal) throw new Error('Bundle parity: ' + shape.id + '/' + color.id + '/' + status);
          cases++;
        }
      }
      return cases;
    });
    assert.ok(result > 500);
  });

  await check('light-runtime-keeps-validation-types-with-documented-error-codes', async () => {
    const failures = await tab.evaluate(() => {
      const cases = [
        [{ shape: 'invalid' }, 'TypeError'],
        [{ shape: 'star', size: 0 }, 'RangeError'],
        [{ shape: 'star', color: 'cherry' }, 'TypeError'],
        [{ shape: 'star', state: { status: 'invalid' } }, 'TypeError'],
      ];
      return cases.map(([options, expected]) => {
        try { window.oaidMount(document.createElement('div'), options); return 'accepted'; }
        catch (error) { return error.name === expected && /^O[0-9]+$/.test(error.message) ? null : error.name + ':' + error.message; }
      }).filter(Boolean);
    });
    assert.deepEqual(failures, []);
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
    assert.equal(await tab.locator('#ready svg').getAttribute('data-one-shape'), 'heart');
    await tab.evaluate(() => window.oaidHeads.get('ready').setAppearance({ color: 'periwinkle' }));
    await tab.waitForFunction(() => document.querySelector('#ready svg[data-moving]') !== null, null, { timeout: 1000 });
    await tab.waitForFunction(() => !document.querySelector('#ready svg[data-moving]'), null, { timeout: 4000 });
    assert.equal(await tab.locator('#ready svg').getAttribute('data-one-shape'), 'heart');
    assert.equal(await tab.locator('#ready svg').getAttribute('data-one-color'), 'periwinkle');
    assert.equal(await tab.locator('#ready [data-one-disc]').getAttribute('fill'), '#9ba0ff');
    assert.equal(await tab.locator('#ready [data-one-disc]').getAttribute('fill-opacity'), null);
  });

  await check('repaints-at-a-moment-end-never-strand-a-moving-head', async () => {
    await settled(8000);
    // A colour change waves (a counted moment); theme repaints land in the same task as its end, many times over.
    await tab.evaluate(() => {
      const head = window.oaidHeads.get('ghost');
      head.setAppearance({ color: 'grape' });
      const start = performance.now();
      let dark = false;
      while (performance.now() - start < 1200) { dark = !dark; head.setAppearance({ theme: dark ? 'dark' : 'light' }); }
      head.setAppearance({ theme: 'light' });
    });
    await tab.waitForFunction(() => !document.querySelector('#ghost svg[data-moving]'), null, { timeout: 3000 });
    // The list's slot was released: the next head in the same list moves at once.
    await tab.evaluate(() => window.oaidHeads.get('peer').update({ status: 'attention' }));
    await tab.waitForFunction(() => document.querySelector('#peer svg[data-moving]') !== null, null, { timeout: 500 });
    await settled(8000);
  });

  await check('digital-one-and-agents-trade-places-through-set-appearance', async () => {
    // Digital One given a shape wears that shape's own colour; a coloured head given charcoal becomes Digital One.
    await tab.evaluate(() => window.oaidHeads.get('header').setAppearance({ shape: 'star' }));
    assert.equal(await tab.locator('#header svg').getAttribute('data-one-shape'), 'star');
    assert.equal(await tab.locator('#header svg').getAttribute('data-one-color'), 'lemon');
    assert.equal(await tab.locator('#header mask').count(), 0);
    await tab.evaluate(() => window.oaidHeads.get('header').setAppearance({ theme: 'dark' }));
    assert.equal(await tab.locator('#header [data-one-disc]').getAttribute('fill'), '#ffe93f');
    assert.equal(await tab.locator('#header [data-one-keyline]').count(), 0);
    await tab.evaluate(() => window.oaidHeads.get('header').setAppearance({ color: 'charcoal' }));
    assert.equal(await tab.locator('#header svg').getAttribute('data-one-shape'), 'circle');
    assert.equal(await tab.locator('#header svg').getAttribute('data-one-color'), 'charcoal');
    assert.equal(await tab.locator('#header [data-one-rim]').getAttribute('stroke'), '#f2f1ea');
    await tab.evaluate(() => window.oaidHeads.get('header').setAppearance({ theme: 'light' }));
    assert.equal(await tab.locator('#header mask').count(), 1);
    assert.equal(await tab.locator('#header [data-one-rim]').count(), 0);
    // A shape with charcoal, a never pair and an unknown colour are refused and the head keeps its look.
    for (const update of [{ shape: 'star', color: 'charcoal' }, { shape: 'droplet', color: 'berry' }, { color: 'teal' }, { shape: 'circle' }]) {
      assert.equal(await tab.evaluate(update => { try { window.oaidHeads.get('header').setAppearance(update); return 'changed'; } catch (error) { return error.name; } }, update), 'TypeError');
    }
    assert.equal(await tab.locator('#header svg').getAttribute('data-one-color'), 'charcoal');
    await settled(8000);
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

  await check('a-dropped-moment-shows-its-held-face-without-moving', async () => {
    await settled(8000);
    // Ghost smiles (over three seconds); Ledger's entrance waits for the list's slot, is dropped after 1.5 s and
    // switches straight to its face: it never moves beside the smiling head, not even to settle.
    await tab.evaluate(() => { window.oaidHeads.get('ghost').update({ status: 'success' }); window.oaidHeads.get('peer').update({ status: 'error' }); });
    let peak = 0, peerMoved = false;
    const start = Date.now();
    while (Date.now() - start < 2600) {
      peak = Math.max(peak, await moving('.team'));
      peerMoved ||= await tab.evaluate(() => document.querySelector('#peer svg[data-moving]') !== null);
      await tab.waitForTimeout(20);
    }
    assert.equal(peak, 1);
    assert.equal(peerMoved, false);
    assert.equal(await tab.locator('#peer svg').getAttribute('data-one-face'), 'error');
    await settled(8000);
  });

  await check('a-higher-priority-entrance-never-moves-beside-a-cut-cadence', async () => {
    await tab.evaluate(() => window.oaidHeads.get('ghost').update({ status: 'working' }));
    let peak = 0;
    const start = Date.now();
    while (Date.now() - start < 4200) {
      if (Date.now() - start > 2400) await tab.evaluate(() => { const peer = window.oaidHeads.get('peer'); if (peer.getState().status !== 'attention') peer.update({ status: 'attention' }); });
      peak = Math.max(peak, await moving('.team'));
      await tab.waitForTimeout(20);
    }
    assert.equal(peak, 1);
    await settled(9000);
    assert.equal(await tab.locator('#peer svg').getAttribute('data-one-face'), 'attention');
  });

  await check('host-gestures-play-taps-at-once-and-arrivals-once-in-view', async () => {
    const eye = () => tab.locator('#header [data-character-eyes]').getAttribute('transform');
    const held = await eye();
    // A tap on a hero starts at once and ends on the held face.
    assert.equal(await tab.evaluate(() => window.oaidHeads.get('header').play('shrug', { viewer: true })), true);
    assert.equal(await tab.locator('#header svg').getAttribute('data-moving'), '');
    await tab.waitForFunction(() => !document.querySelector('#header svg[data-moving]'), null, { timeout: 4000 });
    assert.equal(await eye(), held);
    // A head that needs you only looks at you or nods; unknown gestures and options are refused.
    assert.equal(await tab.evaluate(() => window.oaidHeads.get('peer').play('smile', { viewer: true })), false);
    assert.equal(await tab.evaluate(() => window.oaidHeads.get('peer').play('lookAtYou', { viewer: true })), true);
    await settled(8000);
    assert.equal(await tab.evaluate(() => { try { window.oaidHeads.get('peer').play('dance'); return 'played'; } catch (error) { return error.name; } }), 'TypeError');
    assert.equal(await tab.evaluate(() => { try { window.oaidHeads.get('peer').play('nod', { viewer: 'yes' }); return 'played'; } catch (error) { return error.name; } }), 'TypeError');
    // Nothing plays under reduced motion.
    await tab.emulateMedia({ reducedMotion: 'reduce' });
    await tab.waitForTimeout(100);
    await frames();
    assert.equal(await tab.evaluate(() => window.oaidHeads.get('header').play('popIn')), false);
    await tab.waitForTimeout(300);
    assert.deepEqual(await frames(), []);
    await tab.emulateMedia({ reducedMotion: 'no-preference' });
    await tab.waitForTimeout(100);
    // An arrival asked of a head as it mounts plays once it is in view, then the ticker sleeps.
    await tab.evaluate(() => {
      const element = document.createElement('div');
      element.id = 'arrival';
      element.style.cssText = 'width: 96px; height: 96px';
      document.body.prepend(element);
      const head = window.oaidMount(element, { color: 'charcoal', size: 96, cadence: 'repeat', state: { gaze: { x: 0, y: 0 } } });
      window.oaidHeads.set('arrival', head);
      window.oaidArrival = head.play('popIn');
    });
    assert.equal(await tab.evaluate(() => window.oaidArrival), true);
    await tab.waitForFunction(() => document.querySelector('#arrival svg[data-moving]') !== null, null, { timeout: 1500 });
    await settled(8000);
    await frames();
    await tab.waitForTimeout(600);
    assert.deepEqual(await frames(), []);
  });

  await check('viewer-moments-never-move-two-heads-in-one-list', async () => {
    // Two ready-made agents added together: each First blink is the viewer's own act, so it ignores the window's cap,
    // but the second waits for the first (or shows its colour at once if it misses its turn), never both at once.
    await tab.evaluate(() => {
      const list = document.createElement('ul');
      list.id = 'added';
      list.className = 'team';
      list.innerHTML = '<li><span class="head" id="added-0"></span>Tutor</li><li><span class="head" id="added-1"></span>Coach</li>';
      document.body.prepend(list);
      for (const id of ['added-0', 'added-1']) window.oaidHeads.set(id, window.oaidMount(document.getElementById(id), { shape: 'egg', color: 'blank', size: 44, state: { gaze: { x: 0.4, y: 0.1 } } }));
    });
    await tab.waitForTimeout(300);
    await tab.evaluate(() => { window.oaidHeads.get('added-0').setAppearance({ color: 'lime' }); window.oaidHeads.get('added-1').setAppearance({ color: 'mint' }); });
    let peak = 0;
    const start = Date.now();
    while (Date.now() - start < 3500) { peak = Math.max(peak, await moving('#added')); await tab.waitForTimeout(20); }
    assert.equal(peak, 1);
    await settled(8000);
    assert.equal(await tab.locator('#added-0 [data-one-disc]').getAttribute('fill'), '#b0dc3c');
    assert.equal(await tab.locator('#added-1 [data-one-disc]').getAttribute('fill'), '#5ee6a8');
  });

  await shot('one-light-runtime.png');

  await check('optimized-runtime-matches-unminified-motion-with-a-controlled-clock', async () => {
    const probe = await context.newPage();
    probe.on('pageerror', error => errors.push(error.message));
    await probe.goto(url + 'optimizer');
    optimizerParity = await probe.evaluate(async () => {
      let now = 0, sequence = 0, frames = 0;
      const pending = new Map(), timers = new Map();
      Object.defineProperty(performance, 'now', { value: () => now });
      Math.random = () => 0.5;
      window.IntersectionObserver = undefined;
      window.ResizeObserver = undefined;
      window.requestAnimationFrame = callback => { pending.set(++sequence, callback); return sequence; };
      window.cancelAnimationFrame = id => pending.delete(id);
      window.setTimeout = (callback, delay = 0) => { timers.set(++sequence, { callback, at: now + delay }); return sequence; };
      window.clearTimeout = id => timers.delete(id);
      const reference = await import('/one-reference.js');
      const optimized = await import('/one.js');
      const snapshot = host => JSON.stringify([host.querySelector('svg'), ...host.querySelectorAll('svg *')].map(node =>
        [node.tagName, [...node.attributes].map(attribute => [attribute.name,
          attribute.name === 'id' ? 'mask' : attribute.value.replace(/url\(#[^)]+\)/g, 'url(#mask)')]).sort()]));
      function advance(target) {
        for (let count = 0; count < 1000; count++) {
          const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
          if (!next) break;
          timers.delete(next[0]); now = next[1].at; next[1].callback();
          if (count === 999) throw new Error('Unbounded timer cycle');
        }
        now = target;
        const callbacks = [...pending.values()]; pending.clear();
        for (const callback of callbacks) callback(now);
      }
      const states = ['idle', 'listening', 'reasoning', 'working', 'speaking', 'success', 'blocked', 'error', 'typing', 'attention', 'paused', 'offline'];
      const gestures = ['lookAtYou', 'nod', 'smile', 'wave', 'shrug', 'popIn'];
      const kinds = [...reference.getOneShapes().map(shape => ({ shape: shape.id, color: shape.color })), { color: 'charcoal' }];
      for (const look of kinds) {
        const hosts = [document.createElement('div'), document.createElement('div')];
        for (const host of hosts) { host.style.cssText = 'width:64px;height:64px'; document.body.append(host); }
        const options = { ...look, size: 64, reducedMotion: false, voiceLevel: () => 0.4 };
        const players = [reference.mountOne(hosts[0], options), optimized.mountOne(hosts[1], options)];
        function compare(label) {
          frames++;
          if (snapshot(hosts[0]) !== snapshot(hosts[1]) || JSON.stringify(players[0].getState()) !== JSON.stringify(players[1].getState())) {
            throw new Error('Optimized motion differs: ' + JSON.stringify(look) + '/' + label + '/' + now);
          }
        }
        function sample(label) {
          const start = now;
          for (const offset of [0, 16, 80, 160, 300, 640, 1200, 2400, 5000, 6500]) { advance(start + offset); compare(label); }
        }
        for (const status of states) { for (const player of players) player.update({ status }); sample(status); }
        for (const gesture of gestures) {
          for (const player of players) player.update({ status: 'idle' });
          advance(now + 1000);
          const results = players.map(player => player.play(gesture, { viewer: true }));
          if (results[0] !== results[1]) throw new Error('Optimized gesture acceptance differs: ' + gesture);
          sample(gesture);
        }
        for (const player of players) player.dispose();
        for (const host of hosts) host.remove();
      }
      return { kinds: kinds.length, statuses: states.length, gestures: gestures.length, frames };
    });
    assert.equal(optimizerParity.frames, 2700);
    await probe.close();
  });

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
    checks, screenshots, digitalOneParity: parityResult, optimizerParity, failure }, null, 2) + '\n');
  console.log(failure ? `One head verification failed: ${failure}` : `One head verification passed: ${checks.length} checks`);
}
