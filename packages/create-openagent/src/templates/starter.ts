import type { TemplateFile } from '../scaffold.js';
import { validateProjectName } from '../prompts.js';

/** All starter assets are embedded in the published CLI; no template download. */
export function generateStarterTemplate(projectName: string): TemplateFile[] {
  const name = validateProjectName(projectName);
  return [
    { path: 'package.json', content: JSON.stringify({ name, version: '0.1.0', private: true,
      type: 'module', engines: { node: '>=20.19.0' }, scripts: {
        dev: 'node src/server.mjs', agent: 'node src/agent.mjs', identity: 'node src/identity.mjs',
        test: 'node --test test/*.test.mjs',
      }, dependencies: { '@openagentid/sdk': '0.8.0' } }, null, 2) + '\n' },
    { path: '.gitignore', content: 'node_modules/\n.openagent/\ncoverage/\n.env\n' },
    { path: 'src/workspaces.mjs', content: workspaces },
    { path: 'src/server.mjs', content: server },
    { path: 'src/agent.mjs', content: agent },
    { path: 'src/identity.mjs', content: identity },
    { path: 'public/index.html', content: html },
    { path: 'public/viewer.js', content: viewer },
    { path: 'public/style.css', content: css },
    { path: 'test/starter.test.mjs', content: tests },
    { path: 'README.md', content: readme },
  ];
}

const workspaces = String.raw`import { OpenAgentWorkspace } from '@openagentid/sdk/local';
import { mkdir, lstat, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function stat(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

/** First setup deliberately imports the public identity into a separate receiver.
 * Subsequent opens never recreate keys or trust, including after revocation. */
export async function openStarter(root = projectRoot) {
  const directory = join(resolve(root), '.openagent');
  const existing = await stat(directory);
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('Invalid starter state directory.');
  if (existing && process.platform !== 'win32' && ((existing.mode & 0o777) !== 0o700 || existing.uid !== process.getuid())) throw new Error('Starter state directory must be owned by this user with mode 0700.');
  if (!existing) await mkdir(directory, { mode: 0o700 });
  const signerPath = join(directory, 'signer');
  const receiverPath = join(directory, 'receiver');
  const markerPath = join(directory, 'starter.json');
  const marker = await stat(markerPath);
  let signer, receiver, did, audience;
  if (!marker) {
    if (await stat(signerPath) || await stat(receiverPath)) {
      throw new Error('Incomplete starter setup. Existing state was preserved; inspect it before explicitly choosing a new workspace.');
    }
    audience = 'urn:openagent:starter:' + randomUUID();
    signer = await OpenAgentWorkspace.initialize(signerPath, { audience });
    const created = await signer.createAgent('starter');
    receiver = await OpenAgentWorkspace.initialize(receiverPath, { audience });
    const document = await signer.exportIdentity(created.did);
    await receiver.trustIdentity(document);
    did = created.did;
    await writeFile(join(directory, 'identity.json'), JSON.stringify(document, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await writeFile(markerPath, JSON.stringify({ schemaVersion: 1, did, audience }) + '\n', { flag: 'wx', mode: 0o600 });
  } else {
    if (!marker.isFile() || marker.isSymbolicLink() || marker.size > 2048) throw new Error('Invalid starter metadata.');
    if (process.platform !== 'win32' && ((marker.mode & 0o777) !== 0o600 || marker.uid !== process.getuid())) throw new Error('Starter metadata must be owned by this user with mode 0600.');
    const saved = JSON.parse(await readFile(markerPath, 'utf8'));
    if (!saved || Array.isArray(saved) || Object.keys(saved).sort().join(',') !== 'audience,did,schemaVersion' ||
        saved.schemaVersion !== 1 || typeof saved.did !== 'string' || typeof saved.audience !== 'string' ||
        !/^urn:openagent:starter:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(saved.audience)) throw new Error('Invalid starter metadata.');
    signer = await OpenAgentWorkspace.open(signerPath);
    receiver = await OpenAgentWorkspace.open(receiverPath);
    did = saved.did;
    audience = saved.audience;
  }
  const signers = await signer.listAgents();
  const peers = await receiver.listAgents();
  const selected = signers.find(value => value.did === did && value.hasPrivateKey);
  if (!selected || !peers.some(value => value.did === did)) throw new Error('Starter identity or receiver trust is missing. State was preserved.');
  if ((await signer.inspect()).audience !== audience || (await receiver.inspect()).audience !== audience) {
    throw new Error('Unexpected starter audience.');
  }
  return Object.freeze({ signer, receiver, did, audience, directory });
}
`;

const server = String.raw`import { createServer } from 'node:http';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStarter, projectRoot } from './workspaces.mjs';

const require = createRequire(import.meta.url);
const contentTypes = { '/': 'text/html; charset=utf-8', '/viewer.js': 'text/javascript; charset=utf-8',
  '/style.css': 'text/css; charset=utf-8', '/character-player.js': 'text/javascript; charset=utf-8' };
class Refusal extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
function closed(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new Refusal(400, 'invalid_request');
  return value;
}
async function jsonBody(request) {
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')) throw new Refusal(415, 'json_required');
  const length = request.headers['content-length'];
  if (length !== undefined && (!/^[0-9]+$/.test(length) || Number(length) > 24576)) throw new Refusal(413, 'body_too_large');
  let timer;
  const body = new Promise((accept, reject) => {
    let size = 0;
    const chunks = [];
    const cleanup = () => { clearTimeout(timer); request.off('data', data); request.off('end', end); request.off('error', fail); request.off('aborted', aborted); };
    const fail = error => { cleanup(); reject(error); };
    const aborted = () => fail(new Refusal(400, 'invalid_request'));
    const data = chunk => {
      size += chunk.length;
      if (size > 24576) { fail(new Refusal(413, 'body_too_large')); request.pause(); }
      else chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      try { accept(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Refusal(400, 'invalid_request')); }
    };
    request.on('data', data); request.once('end', end); request.once('error', fail); request.once('aborted', aborted);
    timer = setTimeout(() => { fail(new Refusal(408, 'body_timeout')); request.pause(); }, 2000);
  });
  return body;
}
function headers(response) {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
}
function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}
export async function startServer({ root = projectRoot, port = 3210 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid loopback port.');
  const workspaces = await openStarter(root);
  const assets = new Map();
  for (const [route, name] of [['/', 'index.html'], ['/viewer.js', 'viewer.js'], ['/style.css', 'style.css']]) {
    assets.set(route, await readFile(new URL('../public/' + name, import.meta.url)));
  }
  // Resolve the public SDK package, then serve only its self-contained browser entry.
  const sdkDirectory = dirname(require.resolve('@openagentid/sdk/characters'));
  assets.set('/character-player.js', await readFile(join(sdkDirectory, 'browser', 'character-player.js')));
  let revision = 0, completedRequests = 0, inFlight = 0, lastCompletedAtMs = null;
  const snapshot = () => ({ schemaVersion: 1, did: workspaces.did, revision,
    status: inFlight > 0 ? 'working' : completedRequests > 0 ? 'success' : 'idle',
    completedRequests, lastCompletedAtMs });
  let address;
  const server = createServer({ maxHeaderSize: 8192 }, async (request, response) => {
    headers(response);
    try {
      // An exact numeric host prevents DNS rebinding. Cross-origin browser writes
      // are refused; the read-only viewer sends no control requests.
      if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress) || request.headers.host !== address) throw new Refusal(403, 'loopback_only');
      if (request.headers.origin !== undefined && request.headers.origin !== 'http://' + address) throw new Refusal(403, 'origin_refused');
      if (request.headers['sec-fetch-site'] === 'cross-site') throw new Refusal(403, 'origin_refused');
      const route = request.url;
      if (request.method === 'GET' && assets.has(route)) {
        if (request.headers['content-length'] !== undefined || request.headers['transfer-encoding'] !== undefined) throw new Refusal(400, 'invalid_request');
        response.writeHead(200, { 'content-type': contentTypes[route] }); response.end(assets.get(route)); return;
      }
      if (request.method === 'GET' && route === '/state') {
        if (request.headers['content-length'] !== undefined || request.headers['transfer-encoding'] !== undefined) throw new Refusal(400, 'invalid_request');
        json(response, 200, snapshot()); return;
      }
      if (request.method !== 'POST' || !['/challenge', '/request'].includes(route)) throw new Refusal(404, 'not_found');
      if (request.headers.origin !== undefined || request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'none') throw new Refusal(403, 'operator_command_required');
      const body = await jsonBody(request);
      if (route === '/challenge') {
        closed(body, ['did']);
        if (body.did !== workspaces.did) throw new Refusal(403, 'identity_refused');
        let challenge;
        try { challenge = await workspaces.receiver.issueChallenge(body.did); }
        catch { throw new Refusal(403, 'identity_refused'); }
        json(response, 200, challenge); return;
      }
      closed(body, ['nonce', 'proof', 'message']);
      if (typeof body.nonce !== 'string' || body.nonce.length === 0 || body.nonce.length > 256 ||
          typeof body.message !== 'string' || Buffer.byteLength(body.message, 'utf8') === 0 || Buffer.byteLength(body.message, 'utf8') > 4096) throw new Refusal(400, 'invalid_request');
      closed(body.proof, ['token', 'delegations']);
      if (typeof body.proof.token !== 'string' || body.proof.token.length > 16384 ||
          !Array.isArray(body.proof.delegations) || body.proof.delegations.length !== 0) throw new Refusal(400, 'invalid_request');
      let verified;
      try { verified = await workspaces.receiver.verify(body.proof, { nonce: body.nonce }); }
      catch { throw new Refusal(403, 'identity_refused'); }
      if (verified.did !== workspaces.did) throw new Refusal(403, 'identity_refused');
      if (revision >= Number.MAX_SAFE_INTEGER - 2 || completedRequests >= Number.MAX_SAFE_INTEGER - 1) throw new Refusal(503, 'request_unavailable');
      inFlight++; revision++;
      try {
        const digest = Buffer.from(await webcrypto.subtle.digest('SHA-256', Buffer.from(body.message, 'utf8'))).toString('hex');
        completedRequests++; lastCompletedAtMs = Date.now();
        json(response, 200, { schemaVersion: 1, did: verified.did, message: body.message, digest });
      } finally { inFlight--; revision++; }
    } catch (error) {
      const status = error instanceof Refusal ? error.status : 503;
      const code = error instanceof Refusal ? error.code : 'request_unavailable';
      if (status === 408 || status === 413) response.once('finish', () => request.destroy());
      if (!response.headersSent && !response.destroyed) json(response, status, { error: code });
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); accept(); });
  });
  address = '127.0.0.1:' + server.address().port;
  return Object.freeze({ server, url: 'http://' + address, did: workspaces.did, workspaces,
    close: () => new Promise((accept, reject) => { server.close(error => error ? reject(error) : accept()); server.closeAllConnections(); }),
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const raw = process.env.PORT || '3210';
    if (!/^[0-9]+$/.test(raw) || Number(raw) < 1024 || Number(raw) > 65535) throw new Error('PORT must be an integer from 1024 to 65535.');
    const app = await startServer({ port: Number(raw) });
    console.log('OpenAgent viewer: ' + app.url);
    console.log('Agent DID: ' + app.did);
    console.log('Run in another terminal: npm run agent -- "Hello from my agent"');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.close().then(() => process.exit(0), () => process.exit(1)); });
  } catch (error) { console.error('Starter could not open: ' + error.message); process.exitCode = 1; }
}
`;

const agent = String.raw`import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStarter, projectRoot } from './workspaces.mjs';

async function exchange(url, body) {
  const response = await fetch(url, { method: 'POST', redirect: 'error',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  if (!response.ok || response.headers.get('cache-control') !== 'no-store') throw new Error('Receiver refused the request (' + response.status + ').');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 16384) throw new Error('Receiver response exceeded its limit.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function sendAgentRequest({ root = projectRoot, url = 'http://127.0.0.1:3210', message = 'Hello from my agent' } = {}) {
  const target = new URL(url);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || !target.port || target.username ||
      target.password || target.pathname !== '/' || target.search || target.hash) throw new Error('Use the numeric loopback receiver origin shown by npm run dev.');
  if (typeof message !== 'string' || Buffer.byteLength(message, 'utf8') === 0 || Buffer.byteLength(message, 'utf8') > 4096) throw new Error('Message must contain 1–4096 UTF-8 bytes.');
  const { signer, did, audience } = await openStarter(root);
  const challenge = await exchange(target.origin + '/challenge', { did });
  if (!challenge || Array.isArray(challenge) || Object.keys(challenge).sort().join(',') !== 'audience,expiresAt,nonce' ||
      challenge.audience !== audience || typeof challenge.nonce !== 'string' || challenge.nonce.length === 0 ||
      challenge.nonce.length > 256 || !Number.isSafeInteger(challenge.expiresAt) || challenge.expiresAt <= Date.now() / 1000) throw new Error('Invalid receiver challenge.');
  const proof = await signer.prove(did, { nonce: challenge.nonce, audience: challenge.audience });
  return exchange(target.origin + '/request', { nonce: challenge.nonce, proof, message });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3) throw new Error('Pass one quoted message: npm run agent -- "Hello from my agent"');
    const result = await sendAgentRequest({ url: process.env.OPENAGENT_RECEIVER_URL || 'http://127.0.0.1:' + (process.env.PORT || '3210'), message: process.argv[2] || 'Hello from my agent' });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
`;

const identity = String.raw`import { openStarter } from './workspaces.mjs';

try {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['export', 'revoke'].includes(args[0])) throw new Error('Use npm run identity -- export or npm run identity -- revoke.');
  const { signer, receiver, did } = await openStarter();
  if (args[0] === 'export') console.log(JSON.stringify(await signer.exportIdentity(did), null, 2));
  else {
    await receiver.revoke(did);
    console.log('Revoked receiver trust for ' + did + '. Restart does not undo this decision.');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
`;

const html = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>My OpenAgent</title><link rel="stylesheet" href="/style.css"><script type="module" src="/viewer.js"></script></head>
<body><main><p class="eyebrow">OpenAgent · local starter</p><h1>Your agent, alive.</h1>
<div id="avatar" aria-label="Agent avatar"></div><p id="status" role="status">Connecting to the local receiver…</p>
<p id="identity"></p><div class="controls"><label>Family <select id="skin"></select></label>
<label>Kind <select id="shape"></select></label>
<label>Expression <select id="expression"><option value="">Follow actual status</option></select></label></div>
<div class="controls"><label>Finish <select id="finish"><option value="plush">Soft plush</option><option value="flat">Flat vector</option></select></label>
<label>Eyes <select id="eye-placement"><option value="face">On face</option><option value="raised">Raised</option></select></label></div>
<fieldset><legend>Accessories</legend><div id="accessories" class="controls"></div></fieldset>
<p>In another terminal, run:</p><pre>npm run agent -- "Hello from my agent"</pre>
<p>This viewer is read-only. A completed request appears after the receiver verifies a fresh signed proof.</p>
<p>Keys stay on this computer. No account or identity service is required.</p></main></body></html>
`;
const css = String.raw`:root{font-family:system-ui,sans-serif;color:#ecf0f5;background:#10151c;color-scheme:dark}body{margin:0}main{max-width:760px;margin:0 auto;padding:48px 24px}h1{font-size:clamp(2rem,6vw,3.8rem);letter-spacing:-.05em;margin:12px 0}p{line-height:1.6;color:#bdc8d6}.eyebrow{font-size:.85rem;letter-spacing:.1em;text-transform:uppercase}#avatar{height:300px;display:flex;align-items:center;justify-content:center;margin:12px 0}#avatar svg{max-width:100%;height:280px;border-radius:50%;overflow:hidden}#identity{font-family:monospace;font-size:.85rem;overflow-wrap:anywhere}.controls{display:flex;gap:24px;flex-wrap:wrap}label{display:flex;gap:10px;align-items:center}fieldset{border:0;margin:24px 0;padding:0;min-width:0}legend{padding:0;margin-bottom:12px}input[type=checkbox]{width:18px;height:18px;accent-color:#1687ff}select{appearance:none;padding:8px 38px 8px 12px;border-radius:8px;background-color:#222d3b;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:right 17px center,right 12px center;background-size:5px 5px;background-repeat:no-repeat;color:inherit;border:1px solid #516176}@media(forced-colors:active){select{appearance:auto;background-image:none}}pre{padding:18px;white-space:pre-wrap;background:#1b2532;border-radius:12px;border:1px solid #344458}#status{font-weight:600;color:#fff}
`;
const viewer = String.raw`import { mountCharacter, getCharacterExpressions, getCharacterSkins, getCharacterAccessories } from '/character-player.js';

const skin = document.querySelector('#skin');
const shape = document.querySelector('#shape');
const finish = document.querySelector('#finish');
const eyePlacement = document.querySelector('#eye-placement');
const catalog = getCharacterSkins();
const accessories = document.querySelector('#accessories');
const selectedAccessories = () => Array.from(accessories.querySelectorAll('input:checked'), input => input.value);
for (const accessory of getCharacterAccessories()) {
  const label = document.createElement('label');
  const input = document.createElement('input'); input.type = 'checkbox'; input.value = accessory.id;
  label.append(input, document.createTextNode(accessory.label)); accessories.append(label);
}
const display = value => value.replaceAll('-', ' ').replace(/^./, letter => letter.toUpperCase());
skin.replaceChildren(...catalog.map(entry => new Option(entry.label, entry.id)));
skin.value = 'autos';
function kinds() {
  shape.replaceChildren(new Option('From identity', ''), ...catalog.find(entry => entry.id === skin.value).shapes.map(value => new Option(display(value), value)));
}
kinds();
const expression = document.querySelector('#expression');
const label = document.querySelector('#status');
const identity = document.querySelector('#identity');
for (const value of getCharacterExpressions()) {
  const option = document.createElement('option'); option.value = value; option.textContent = value;
  expression.append(option);
}
let player, did, revision = -1, latestStatus = 'idle', stopped = false, timer;
skin.addEventListener('change', () => { kinds(); player?.setAppearance({ skin: skin.value }); });
shape.addEventListener('change', () => player?.setAppearance({ shape: shape.value || null }));
finish.addEventListener('change', () => player?.setAppearance({ finish: finish.value }));
eyePlacement.addEventListener('change', () => player?.setAppearance({ eyePlacement: eyePlacement.value }));
accessories.addEventListener('change', () => player?.setAppearance({ accessories: selectedAccessories() }));
expression.addEventListener('change', () => player?.update({ status: latestStatus, expression: expression.value || null }));
async function refresh() {
  try {
    const response = await fetch('/state', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('Receiver unavailable.');
    const state = await response.json();
    if (stopped) return;
    if (state.schemaVersion !== 1 || typeof state.did !== 'string' || !Number.isSafeInteger(state.revision) || state.revision < 0 ||
        !['idle', 'working', 'success'].includes(state.status) || !Number.isSafeInteger(state.completedRequests) || state.completedRequests < 0) throw new Error('Invalid receiver state.');
    if (!player || state.did !== did) {
      player?.dispose(); document.querySelector('#avatar').replaceChildren();
      did = state.did; player = mountCharacter(document.querySelector('#avatar'), did, { skin: skin.value, finish: finish.value, eyePlacement: eyePlacement.value, accessories: selectedAccessories(), ...(shape.value ? { shape: shape.value } : {}), size: 280, reducedMotion: 'system' });
      identity.textContent = did; revision = -1;
    }
    if (state.revision !== revision) {
      latestStatus = state.status; player.update({ status: latestStatus, expression: expression.value || null }); revision = state.revision;
    }
    label.textContent = state.status + ' · ' + state.completedRequests + ' verified request' + (state.completedRequests === 1 ? '' : 's');
  } catch {
    if (!stopped) label.textContent = 'Receiver unavailable · showing the last verified request state';
  } finally { if (!stopped) timer = setTimeout(refresh, 750); }
}
window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); player?.dispose(); player = undefined; });
window.addEventListener('pageshow', event => { if (event.persisted) { stopped = false; refresh(); } });
refresh();
`;

const readme = String.raw`# Your OpenAgent starter

Requires Node 20.19+. Run npm install, then npm run dev. Open the numeric loopback URL printed by the server. In another terminal run:

    npm run agent -- "Hello from my agent"

The command obtains a receiver-issued challenge, signs it with a persisted Ed25519 key, and sends a proof. After verification, the receiver hashes and echoes the message. The browser shows the real completed-request count, animated Autos by default, 17 optional families (including SpaceX, seasonal characters and the One family of coloured heads), distinct kinds, face framing, combinable glasses/headphones, soft plush by default with a flat-vector option, on-face or raised eyes and selectable expressions. It does not simulate work or broadcast runtime state elsewhere. Reduced motion follows your browser preference.

On first setup, src/workspaces.mjs creates two separate local authorities, persists a unique receiver audience and explicitly imports the signer's public DID/key document into the receiver with trustIdentity. The receiver has no signing key for that agent. The public export is .openagent/identity.json. Private keys, challenge and replay state remain under .openagent/ and are excluded from git. Inspect public identity with npm run identity -- export. Never publish .openagent/ or serve it as static assets.

Run npm test for real generated-key HTTP verification, restart/replay/revocation and transport refusals. No account, hosted identity service, private package or network identity lookup is involved. Installing the public SDK is the only dependency setup.

    npm run identity -- revoke

Revocation is the receiver's durable local trust decision. Restarting does not restore trust. A revoked starter will refuse further agent requests. Existing or incomplete state is preserved and never silently reset; deliberately choose a separate workspace if you want a new identity/receiver. This example does not claim global revocation, human ownership, application roles or a distributed database.

The HTTP service listens only on 127.0.0.1:3210. Set PORT consistently for the server and agent command to choose another port, or set OPENAGENT_RECEIVER_URL on the command to the exact printed numeric origin. Host checks prevent DNS rebinding, cross-origin browser controls are refused, and only fixed public assets are served. Trust/revoke are local operator actions, never HTTP controls. GET /state contains only public DID and transient request presentation metadata; it contains no message, output, token or key.

This starter deliberately has no cloud-deployment, MCP, enterprise bridge or optional identity-stack dependency. Historical 0.1 templates need migration and are not generated by create-openagent 0.3.
`;

const tests = String.raw`import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { OpenAgentWorkspace } from '@openagentid/sdk/local';
import { openStarter } from '../src/workspaces.mjs';
import { startServer } from '../src/server.mjs';
import { sendAgentRequest } from '../src/agent.mjs';

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'openagent-starter-test-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  let app = await startServer({ root, port: 0 });
  t.after(async () => { if (app) await app.close(); });
  return { root, get app() { return app; }, async restart() { await app.close(); app = await startServer({ root, port: 0 }); } };
}
async function post(app, route, body, extra = {}) {
  return fetch(app.url + route, { method: 'POST', headers: { 'content-type': 'application/json', ...extra },
    body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
}
async function signed(app, message = 'Real signed request') {
  const response = await post(app, '/challenge', { did: app.did });
  assert.equal(response.status, 200);
  const challenge = await response.json();
  const proof = await app.workspaces.signer.prove(app.did, { nonce: challenge.nonce, audience: challenge.audience });
  return { nonce: challenge.nonce, proof, message };
}
test('separate persisted signer and explicit public receiver trust complete actual HTTP work', async t => {
  const f = await fixture(t);
  const agents = await f.app.workspaces.receiver.listAgents();
  assert.equal(agents.find(value => value.did === f.app.did).hasPrivateKey, false);
  const exported = JSON.parse(await readFile(join(f.root, '.openagent', 'identity.json'), 'utf8'));
  assert.equal(exported.did, f.app.did); assert.equal('d' in exported.publicKeyJwk, false);
  const message = 'Hello, actual receiver';
  const output = await sendAgentRequest({ root: f.root, url: f.app.url, message });
  assert.deepEqual(output, { schemaVersion: 1, did: f.app.did, message, digest: createHash('sha256').update(message).digest('hex') });
  const state = await (await fetch(f.app.url + '/state')).json();
  assert.equal(state.status, 'success'); assert.equal(state.completedRequests, 1);
  assert.equal(state.revision, 2); assert.equal(typeof state.lastCompletedAtMs, 'number');
  assert.equal('message' in state, false); assert.equal('proof' in state, false);
});
test('issued challenge, public key and replay consumption survive actual reopen', async t => {
  const f = await fixture(t);
  const did = f.app.did;
  const audience = f.app.workspaces.audience;
  const body = await signed(f.app);
  await f.restart(); assert.equal(f.app.did, did); assert.equal(f.app.workspaces.audience, audience);
  assert.equal((await post(f.app, '/request', body)).status, 200);
  await f.restart(); assert.equal(f.app.did, did);
  const replay = await post(f.app, '/request', body);
  assert.equal(replay.status, 403); assert.deepEqual(await replay.json(), { error: 'identity_refused' });
  assert.equal((await (await fetch(f.app.url + '/state')).json()).completedRequests, 0);
});
test('one issued proof has exactly one winner under concurrent real HTTP verification', async t => {
  const f = await fixture(t);
  const body = await signed(f.app);
  const responses = await Promise.all([post(f.app, '/request', body), post(f.app, '/request', body)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 403]);
  assert.equal((await (await fetch(f.app.url + '/state')).json()).completedRequests, 1);
});
test('each installation pins a different durable intended audience and refuses valid signatures for another receiver', async t => {
  const f = await fixture(t);
  const other = await fixture(t);
  assert.notEqual(f.app.workspaces.audience, other.app.workspaces.audience);
  const body = await signed(f.app);
  const wrongRecipient = await f.app.workspaces.signer.prove(f.app.did, { nonce: body.nonce, audience: other.app.workspaces.audience });
  assert.equal((await post(f.app, '/request', { ...body, proof: wrongRecipient })).status, 403);
  assert.equal((await post(f.app, '/request', body)).status, 200);
});
test('receiver revocation denies already issued proof and is never undone by restart', async t => {
  const f = await fixture(t);
  const body = await signed(f.app);
  await f.app.workspaces.receiver.revoke(f.app.did);
  await f.restart();
  assert.equal((await post(f.app, '/request', body)).status, 403);
  assert.equal((await post(f.app, '/challenge', { did: f.app.did })).status, 403);
  assert.equal((await f.app.workspaces.receiver.listAgents()).find(agent => agent.did === f.app.did).revoked, true);
});
test('altered signature, never-issued nonce and unknown generated key fail without changing viewer state', async t => {
  const f = await fixture(t);
  const body = await signed(f.app);
  const token = body.proof.token.split('.');
  token[2] = (token[2][0] === 'A' ? 'B' : 'A') + token[2].slice(1);
  assert.equal((await post(f.app, '/request', { ...body, proof: { ...body.proof, token: token.join('.') } })).status, 403);
  assert.equal((await post(f.app, '/request', { ...body, nonce: 'never-issued' })).status, 403);
  const audience = f.app.workspaces.audience;
  const stranger = await OpenAgentWorkspace.initialize(join(f.root, 'stranger'), { audience });
  const foreign = await stranger.createAgent('stranger');
  const proof = await stranger.prove(foreign.did, { nonce: body.nonce, audience });
  assert.equal((await post(f.app, '/request', { ...body, proof })).status, 403);
  assert.equal((await (await fetch(f.app.url + '/state')).json()).completedRequests, 0);
  assert.equal((await post(f.app, '/request', body)).status, 200);
});
test('host, browser-origin, closed-schema and private/static paths are refused', async t => {
  const f = await fixture(t);
  // fetch may replace Host with its URL's authority. Native HTTP sends the
  // adversarial wire header while retaining the real loopback destination.
  const rogueHost = await new Promise((accept, reject) => {
    const body = JSON.stringify({ did: f.app.did });
    const req = httpRequest(f.app.url + '/challenge', { method: 'POST', headers: {
      host: 'attacker.example', 'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
    } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.once('error', reject);
      response.once('end', () => accept({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    assert.equal(req.getHeader('host'), 'attacker.example');
    req.once('error', reject); req.setTimeout(4500, () => req.destroy(new Error('Host refusal timed out.')));
    req.end(body);
  });
  assert.equal(rogueHost.status, 403);
  assert.deepEqual(JSON.parse(rogueHost.body), { error: 'loopback_only' });
  assert.equal((await post(f.app, '/challenge', { did: f.app.did }, { origin: 'https://attacker.example' })).status, 403);
  assert.equal((await post(f.app, '/challenge', { did: f.app.did }, { origin: f.app.url })).status, 403);
  assert.equal((await post(f.app, '/challenge', { did: f.app.did, owner: 'invented' })).status, 400);
  assert.equal((await post(f.app, '/challenge?did=x', { did: f.app.did })).status, 404);
  assert.equal((await post(f.app, '/revoke', { did: f.app.did })).status, 404);
  for (const path of ['/.openagent/identity.json', '/.openagent/signer/state.json', '/%2e%2e/src/workspaces.mjs']) {
    assert.equal((await fetch(f.app.url + path)).status, 404);
  }
  const viewer = await fetch(f.app.url + '/');
  assert.equal(viewer.status, 200); assert.equal(viewer.headers.get('cache-control'), 'no-store');
  assert.match(viewer.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const markup = await viewer.text();
  assert.match(markup, /<select id="skin"><\/select>/);
  assert.match(markup, /<select id="shape"><\/select>/);
  assert.match(markup, /<select id="finish"><option value="plush">Soft plush<\/option><option value="flat">Flat vector<\/option>/);
  assert.match(markup, /<select id="eye-placement"><option value="face">On face<\/option><option value="raised">Raised<\/option>/);
  const viewerScript = await (await fetch(f.app.url + '/viewer.js')).text();
  assert.match(viewerScript, /setAppearance\(\{ finish: finish.value \}\)/);
  assert.match(viewerScript, /setAppearance\(\{ eyePlacement: eyePlacement.value \}\)/);
  assert.match(viewerScript, /skin: skin.value, finish: finish.value, eyePlacement: eyePlacement.value, accessories: selectedAccessories\(\)/);
  const script = await fetch(f.app.url + '/character-player.js');
  assert.equal(script.status, 200); assert.match(await script.text(), /mountCharacter/);
  const huge = await post(f.app, '/request', { value: 'x'.repeat(25000) }); assert.equal(huge.status, 413);
});
test('chunked oversized and unfinished request bodies are bounded by the real HTTP server', async t => {
  const f = await fixture(t);
  async function raw(body, incomplete) {
    return new Promise((accept, reject) => {
      const req = httpRequest(f.app.url + '/challenge', { method: 'POST', headers: { 'content-type': 'application/json',
        ...(incomplete ? { 'content-length': '20' } : {}) } }, response => {
        response.resume(); response.once('end', () => accept(response.statusCode));
      });
      req.once('error', reject); req.setTimeout(4500, () => req.destroy(new Error('Body refusal timed out.')));
      req.write(body); if (!incomplete) req.end();
    });
  }
  assert.equal(await raw('x'.repeat(25000), false), 413);
  assert.equal(await raw('{', true), 408);
});
test('incomplete setup is retained rather than creating a replacement identity', async t => {
  const f = await fixture(t);
  const before = await f.app.workspaces.signer.exportIdentity(f.app.did);
  await rm(join(f.root, '.openagent', 'starter.json'));
  await assert.rejects(openStarter(f.root), /Incomplete starter setup/);
  assert.deepEqual(await f.app.workspaces.signer.exportIdentity(f.app.did), before);
});
`;
