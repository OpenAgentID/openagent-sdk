const element = id => document.getElementById(id);
const controls = element('controls');
const skin = element('skin');
const shape = element('shape');
const expression = element('expression');
const animated = element('animated');
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
const label = value => value.replaceAll('-', ' ').replace(/^./, character => character.toUpperCase());
let catalog = [];
let pending;
let timer;
let animationChosen = false;

function motionPreference() {
  if (!animationChosen) animated.checked = !motion.matches;
  element('motion-note').textContent = motion.matches
    ? 'Reduced motion is enabled. Animation starts off; you can turn it on.'
    : 'Turn animation off to hold a pose.';
}

function shapesForSkin() {
  const previous = shape.value;
  const selected = catalog.find(entry => entry.id === skin.value);
  shape.replaceChildren(new Option('From identity', ''));
  for (const id of selected?.shapes ?? []) shape.add(new Option(label(id), id));
  if (selected?.shapes.includes(previous)) shape.value = previous;
  // Expression belongs to the avatar, so changing its skin preserves the selection.
}

function parameters() {
  const query = new URLSearchParams({ skin: skin.value, skinVersion: '1', eyeStyle: 'live-v1',
    expression: expression.value, size: element('size').value, animated: String(animated.checked),
    blink: element('blink').value, gazeX: element('gaze-x').value, gazeY: element('gaze-y').value });
  if (shape.value) query.set('shape', shape.value);
  return query.toString();
}

function outputs() {
  for (const [input, output] of [['blink', 'blink-value'], ['gaze-x', 'gaze-x-value'], ['gaze-y', 'gaze-y-value']]) {
    element(output).value = element(input).value;
  }
}

async function preview() {
  if (!catalog.length) return;
  pending?.abort();
  const controller = new AbortController();
  pending = controller;
  const identity = encodeURIComponent(element('did').value.trim());
  const query = parameters();
  const descriptorUrl = `/v1/characters/${identity}?${query}`;
  const svgUrl = `/v1/characters/svg/${identity}?${query}`;
  element('status').classList.remove('error');
  element('status').textContent = 'Generating character…';
  try {
    const response = await fetch(descriptorUrl, { credentials: 'omit', signal: controller.signal });
    if (!response.ok) throw new Error('Enter a valid agent DID and choose a supported pose.');
    const descriptor = await response.json();
    if (controller.signal.aborted) return;
    element('preview').src = svgUrl;
    element('preview').alt = `${label(descriptor.expression)} ${label(descriptor.skin)} agent character`;
    element('svg-link').href = svgUrl;
    element('json-link').href = descriptorUrl;
    const { svg, ...details } = descriptor;
    element('descriptor').textContent = JSON.stringify(details, null, 2);
    element('status').textContent = `${label(descriptor.skin)} · ${label(descriptor.shape)} · ${label(descriptor.expression)}`;
  } catch (error) {
    if (controller.signal.aborted) return;
    element('status').classList.add('error');
    element('status').textContent = error.message || 'Could not generate the character. Try again.';
  }
}

function schedule() {
  outputs();
  clearTimeout(timer);
  pending?.abort();
  timer = setTimeout(preview, 120);
}

controls.addEventListener('submit', event => { event.preventDefault(); schedule(); });
controls.addEventListener('input', schedule);
skin.addEventListener('change', () => { shapesForSkin(); schedule(); });
animated.addEventListener('change', () => { animationChosen = true; schedule(); });
element('reset').addEventListener('click', () => {
  expression.value = 'neutral';
  element('blink').value = '0';
  element('gaze-x').value = '0';
  element('gaze-y').value = '0';
  schedule();
});
motion.addEventListener('change', () => { motionPreference(); schedule(); });
motionPreference();

async function initialize() {
  try {
    const response = await fetch('/v1/characters/skins', { credentials: 'omit' });
    if (!response.ok) throw new Error('Could not load character skins. Reload to try again.');
    catalog = await response.json();
    skin.replaceChildren(...catalog.map(entry => new Option(entry.label, entry.id)));
    skin.value = 'autos';
    const expressions = catalog.find(entry => entry.id === 'autos').expressions;
    expression.replaceChildren(...expressions.map(id => new Option(label(id), id)));
    expression.value = 'neutral';
    shapesForSkin();
    outputs();
    await preview();
  } catch (error) {
    element('status').classList.add('error');
    element('status').textContent = error.message || 'Could not load characters. Reload to try again.';
  }
}

initialize();
