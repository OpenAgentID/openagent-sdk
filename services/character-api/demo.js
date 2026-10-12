import { mountCharacter, getCharacterExpressions, getCharacterStatuses, getCharacterSkins, getCharacterAccessories } from '/character-player.js';

const element = id => document.getElementById(id);
const skin = element('skin');
const shape = element('shape');
const view = element('view');
const finish = element('finish');
const eyePlacement = element('eye-placement');
const activity = element('activity');
const expression = element('expression');
const animated = element('animated');
const preview = element('preview');
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
const label = value => value.replaceAll('-', ' ').replace(/^./, character => character.toUpperCase());
const activityStates = ['idle', 'listening', 'reasoning', 'working', 'speaking', 'success', 'blocked', 'error'];
const sequence = [
  ['listening', 1000], ['reasoning', 1600], ['working', 1600],
  ['speaking', 1100], ['success', 1000], ['idle', 0],
];
const catalog = getCharacterSkins();
const selectedAccessories = () => Array.from(element('accessories').querySelectorAll('input:checked'), input => input.value);
let player;
let mountedDid;
let mountTimer;
let replayTimer;
let replayGeneration = 0;
let replaying = false;

function pose() {
  return { blink: Number(element('blink').value),
    gaze: { x: Number(element('gaze-x').value), y: Number(element('gaze-y').value) } };
}

function motionPreference() {
  element('motion-note').textContent = motion.matches
    ? 'Your system requests reduced motion. Poses change immediately and live movement stays off.'
    : animated.checked ? 'Blink, gaze and expression transitions stay live.' : 'Live motion is off. Choose a state or hold a pose.';
}

function shapesForSkin() {
  const selected = catalog.find(entry => entry.id === skin.value);
  shape.replaceChildren(new Option('From identity', ''));
  for (const id of selected?.shapes ?? []) shape.add(new Option(label(id), id));
}

function outputs() {
  for (const [input, output] of [['blink', 'blink-value'], ['gaze-x', 'gaze-x-value'], ['gaze-y', 'gaze-y-value']]) {
    element(output).value = element(input).value;
  }
}

function timelineStep(status) {
  for (const step of element('timeline').children) {
    if (step.dataset.step === status) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  }
  for (const button of element('activity-buttons').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.status === status));
  }
}

function stopReplay(message = 'Replay the sequence or choose a single activity.') {
  replayGeneration += 1;
  clearTimeout(replayTimer);
  replaying = false;
  element('replay').textContent = 'Replay activity';
  element('replay-note').textContent = message;
}

function showError(error) {
  element('status').classList.add('error');
  element('status').textContent = error instanceof Error ? error.message : 'Could not update this character.';
}

function codeExample() {
  element('code-example').textContent = [
    "import { mountCharacter } from '/character-player.js';",
    '',
    'const avatar = document.createElement(\'div\');',
    'document.body.append(avatar);',
    `const player = mountCharacter(avatar, ${JSON.stringify(mountedDid ?? element('did').value)}, {`,
    `  skin: ${JSON.stringify(skin.value)}, view: ${JSON.stringify(view.value)},${shape.value ? ` shape: ${JSON.stringify(shape.value)},` : ''}`,
    `  finish: ${JSON.stringify(finish.value)}, eyePlacement: ${JSON.stringify(eyePlacement.value)},`,
    `  accessories: ${JSON.stringify(selectedAccessories())}, reducedMotion: 'system'`,
    '});',
    '',
    `player.update({ status: ${JSON.stringify(activity.value)} });`,
    "player.update({ status: 'speaking' });",
    "player.update({ expression: 'curious' }); // Explicit override",
    'player.update({ expression: null }); // Return to the current status',
    'player.dispose(); // Call when the avatar leaves your app',
  ].join('\n');
}

function refresh() {
  outputs();
  motionPreference();
  codeExample();
  if (!player) return;
  const state = player.getState();
  const query = new URLSearchParams({ skin: skin.value, view: view.value, finish: finish.value, eyePlacement: eyePlacement.value, skinVersion: '1', eyeStyle: 'live-v1',
    expression: state.expression, size: element('size').value,
    animated: String(animated.checked && !motion.matches),
    blink: String(state.blink), gazeX: String(state.gaze.x), gazeY: String(state.gaze.y) });
  if (shape.value) query.set('shape', shape.value);
  if (selectedAccessories().length) query.set('accessories', selectedAccessories().join(','));
  const identity = encodeURIComponent(mountedDid);
  element('svg-link').href = `/v1/characters/svg/${identity}?${query}`;
  element('json-link').href = `/v1/characters/${identity}?${query}`;
  element('descriptor').textContent = JSON.stringify({ did: mountedDid,
    appearance: { skin: skin.value, view: view.value, finish: finish.value, eyePlacement: eyePlacement.value, shape: shape.value || 'from identity', accessories: selectedAccessories(), size: Number(element('size').value) },
    state, reducedMotion: !animated.checked || motion.matches, activity: 'local demo fixture' }, null, 2);
  preview.setAttribute('aria-label', `${label(state.expression)} ${label(skin.value)} demonstration character fixture`);
  element('status').classList.remove('error');
  element('status').textContent = `${label(skin.value)} · ${label(state.status)} · ${label(state.expression)}`;
  timelineStep(state.status);
}

function updateState(update) {
  if (!player) return;
  try { player.update(update); refresh(); } catch (error) { showError(error); }
}

function chooseStatus(status) {
  activity.value = status;
  expression.value = '';
  updateState({ status }); // A status update clears the previous explicit override.
}

function remount() {
  clearTimeout(mountTimer);
  stopReplay();
  player?.dispose();
  player = undefined;
  mountedDid = undefined;
  preview.replaceChildren();
  element('replay').disabled = true;
  element('svg-link').removeAttribute('href');
  element('json-link').removeAttribute('href');
  element('descriptor').textContent = '';
  try {
    const did = element('did').value;
    player = mountCharacter(preview, did, { skin: skin.value, view: view.value, finish: finish.value, eyePlacement: eyePlacement.value, accessories: selectedAccessories(),
      ...(shape.value ? { shape: shape.value } : {}), size: Number(element('size').value),
      animated: true, state: pose(), reducedMotion: animated.checked ? 'system' : true, transitionMs: 420 });
    mountedDid = did;
    player.update({ status: activity.value, ...pose(), ...(expression.value ? { expression: expression.value } : {}) });
    element('replay').disabled = false;
    refresh();
  } catch (error) {
    player?.dispose();
    player = undefined;
    preview.replaceChildren();
    showError(error);
    codeExample();
  }
}

function replay() {
  if (replaying) { stopReplay('Replay stopped. The current pose stays live.'); return; }
  if (!player) return;
  stopReplay();
  replaying = true;
  element('replay').textContent = 'Stop replay';
  const generation = replayGeneration;
  const advance = index => {
    if (generation !== replayGeneration || !player) return;
    const [status, delay] = sequence[index];
    chooseStatus(status);
    element('replay-note').textContent = `Simulated activity ${index + 1}/${sequence.length}: ${label(status)}.`;
    if (index < sequence.length - 1) replayTimer = setTimeout(() => advance(index + 1), delay);
    else stopReplay('Sequence complete. Replay it or interrupt with another activity.');
  };
  advance(0);
}

// A form submission never remounts an unchanged DID: Enter on a state control
// leaves the same player and its current eye transition running.
element('controls').addEventListener('submit', event => {
  event.preventDefault();
  if (!player || element('did').value !== mountedDid) remount();
});
element('did').addEventListener('input', () => {
  stopReplay();
  clearTimeout(mountTimer);
  mountTimer = setTimeout(remount, 150);
});
skin.addEventListener('change', () => {
  shapesForSkin(); // Changing the skin resets only the shape, preserving expression and activity.
  if (!player) { remount(); return; }
  try { player.setAppearance({ skin: skin.value }); refresh(); } catch (error) { showError(error); }
});
view.addEventListener('change', () => {
  if (!player) return;
  try { player.setAppearance({ view: view.value }); refresh(); } catch (error) { showError(error); }
});
finish.addEventListener('change', () => {
  if (!player) return;
  try { player.setAppearance({ finish: finish.value }); refresh(); } catch (error) { showError(error); }
});
eyePlacement.addEventListener('change', () => {
  if (!player) return;
  try { player.setAppearance({ eyePlacement: eyePlacement.value }); refresh(); } catch (error) { showError(error); }
});
element('accessories').addEventListener('change', () => {
  if (!player) return;
  try { player.setAppearance({ accessories: selectedAccessories() }); refresh(); } catch (error) { showError(error); }
});
shape.addEventListener('change', () => {
  if (!player) return;
  try { player.setAppearance({ shape: shape.value || null }); refresh(); } catch (error) { showError(error); }
});
element('size').addEventListener('change', () => {
  if (!player) return;
  try { player.setAppearance({ size: Number(element('size').value) }); refresh(); } catch (error) { showError(error); }
});
activity.addEventListener('change', () => { stopReplay(); chooseStatus(activity.value); });
expression.addEventListener('change', () => { stopReplay(); updateState({ expression: expression.value || null }); });
for (const id of ['blink', 'gaze-x', 'gaze-y']) {
  element(id).addEventListener('input', () => { stopReplay(); updateState(pose()); });
}
animated.addEventListener('change', () => {
  player?.setReducedMotion(animated.checked ? 'system' : true);
  refresh();
});
element('activity-buttons').addEventListener('click', event => {
  const button = event.target.closest('button[data-status]');
  if (!button) return;
  stopReplay();
  chooseStatus(button.dataset.status);
});
element('reset').addEventListener('click', () => {
  stopReplay();
  activity.value = 'idle'; expression.value = '';
  element('blink').value = '0'; element('gaze-x').value = '0'; element('gaze-y').value = '0';
  updateState({ status: 'idle', ...pose() });
});
element('replay').addEventListener('click', replay);
motion.addEventListener('change', refresh);
window.addEventListener('pagehide', () => { clearTimeout(mountTimer); stopReplay(); player?.dispose(); player = undefined; });
window.addEventListener('pageshow', event => { if (event.persisted) remount(); });

skin.replaceChildren(...catalog.map(entry => new Option(entry.label, entry.id)));
skin.value = 'autos';
for (const accessory of getCharacterAccessories()) {
  const label = document.createElement('label'); label.className = 'toggle';
  const input = document.createElement('input'); input.type = 'checkbox'; input.value = accessory.id;
  label.append(input, document.createTextNode(accessory.label));
  element('accessories').append(label);
}
expression.replaceChildren(new Option('From activity state', ''),
  ...getCharacterExpressions().map(id => new Option(label(id), id)));
const activities = document.createElement('optgroup'); activities.label = 'Activity';
const expressions = document.createElement('optgroup'); expressions.label = 'Expression states';
for (const { status: id } of getCharacterStatuses()) (activityStates.includes(id) ? activities : expressions).append(new Option(label(id), id));
activity.replaceChildren(activities, expressions); activity.value = 'idle';
shapesForSkin();
remount();
