import { blake3 } from '@noble/hashes/blake3';
import { describe, expect, it } from 'vitest';
import {
  generateCharacter,
  getCharacterSkins,
  getCharacterExpressions,
  parseCharacterAppearance,
  renderCharacterSvg,
  type CharacterOptions,
  type CharacterSkin,
} from '../src/characters.js';

const did = 'did:oas:openagent:agent:character-vector';
const colors = ['#3478ed', '#169acb', '#f07825', '#ea493f', '#18a260', '#c58d12', '#8157dc', '#e44887'];
const expressions = ['neutral', 'attentive', 'surprised', 'excited', 'happy', 'laughing', 'angry', 'sad',
  'scared', 'suspicious', 'confused', 'curious', 'proud', 'shy', 'unimpressed', 'sleepy', 'thoughtful', 'concerned'] as const;
const familyKinds = {
  autos: ['standard', 'slender', 'wide'],
  spacex: ['circle', 'pebble', 'squircle', 'capsule', 'triangle', 'hexagon', 'cloud', 'droplet'],
  fold: ['standard', 'kite', 'fan'], sprig: ['standard', 'bud', 'leaf'],
  ripple: ['standard', 'drop', 'wave'], halo: ['standard', 'comet', 'satellite'],
  purl: ['standard', 'mitt', 'hood'], prism: ['standard', 'crystal', 'obelisk'],
  coil: ['standard', 'spring', 'bellows'], kiln: ['standard', 'vase', 'teapot'],
  wisp: ['standard', 'flame', 'curl'], relay: ['standard', 'radio', 'beacon'],
  cairn: ['standard', 'tower', 'arch'], tuft: ['standard', 'pom', 'bear'],
  halloween: ['pumpkin', 'ghost', 'bat', 'witch-hat', 'candy-corn'],
  thanksgiving: ['turkey', 'acorn', 'squash', 'pie', 'corn'],
  christmas: ['light', 'tree', 'snowman', 'ornament', 'gift'],
} as const;

function attributes(element: string): Record<string, string> {
  return Object.fromEntries([...element.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1]!, match[2]!]));
}

function bars(svg: string) {
  return [...svg.matchAll(/<rect\b[^>]*data-character-eye="(?:left|right)"[^>]*>/g)]
    .map((match) => attributes(match[0]));
}

function animation(svg: string, name: string) {
  return [...svg.matchAll(/<animate\b[^>]*>/g)].map((match) => attributes(match[0]))
    .filter((item) => item.attributeName === name);
}

function bodyMarkup(svg: string): string {
  const start = svg.search(/<(?:g|rect|path|circle|ellipse)\b[^>]*data-character-body="true"/);
  const end = svg.indexOf('<g data-character-face="true"');
  if (start < 0 || end <= start) throw new Error('Expected a body followed by the shared face wrapper');
  return svg.slice(start, end);
}

/** Ignore paint/instance IDs: changing only color cannot satisfy distinct geometry. */
function bodyGeometry(svg: string): string {
  const geometry = ['d', 'x', 'y', 'width', 'height', 'rx', 'ry', 'r', 'cx', 'cy', 'points', 'transform'];
  return JSON.stringify([...bodyMarkup(svg).matchAll(/<(rect|path|circle|ellipse|polygon)\b[^>]*>/g)]
    .map(match => ({ tag: match[1], attributes: Object.fromEntries(Object.entries(attributes(match[0]))
      .filter(([name]) => geometry.includes(name))) })));
}

function assertLocalGradients(svg: string): void {
  const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]!);
  expect(new Set(ids).size).toBe(ids.length);
  for (const match of svg.matchAll(/url\(#([^)]*)\)/g)) expect(ids).toContain(match[1]);
  expect(svg).not.toContain('__INSTANCE__');
  expect(svg).not.toMatch(/<(?:script|foreignObject|image|text)\b|\b(?:on\w+|href|xlink:href|style)=/i);
}

describe('OpenAgent character profile v1', () => {
  // Independently generated with hash-pinned Python blake3 1.0.11 on Depot:
  // golden-seeds/golden02, build z3hnww3bvq. No renderer or noble dependency.
  // Seed and shape vectors are unchanged; RGB values use the 0.7.2 collection palette.
  it.each([
    { skin: 'autos' as const, digest: 'df1f10e82423a8b87280b0593d66115a0243ca2ff1d6636b28c5de53cd72fbb1',
      shape: 'slender', color: '#e44887', geometry: 'x="168" y="48" width="176" height="416" rx="88"' },
    { skin: 'spacex' as const, digest: 'b2bc833af9bb8e8b8bbbe012072217cb3c682b77f4f57a1de106ace283b03e48',
      shape: 'squircle', color: '#18a260', geometry: 'x="104" y="104" width="304" height="304" rx="88"' },
  ])('matches the independent full-DID $skin profile vector', ({ skin, digest, shape, color, geometry }) => {
    const character = generateCharacter(did, { skin, animated: false, view: 'full' });
    expect(character).toMatchObject({ did, skin, skinVersion: 1, eyeStyle: 'live-v1', shape, expression: 'neutral',
      color, size: 512, animated: false, state: { blink: 0, gaze: { x: 0, y: 0 } } });
    expect(character.svg).toContain(`data-character-seed="${digest}"`);
    expect(character.svg).toContain(`<rect data-character-body="true" fill="${color}" ${geometry}/>`);
    expect(bars(character.svg)).toEqual([
      { 'data-character-eye': 'left', x: '208', y: '228', width: '28', height: '72', rx: '14' },
      { 'data-character-eye': 'right', x: '276', y: '228', width: '28', height: '72', rx: '14' },
    ]);
  });

  it('provides a deeply immutable catalog with independently versioned eye styles', () => {
    const catalog = getCharacterSkins();
    expect(catalog.slice(0, 2)).toEqual([
      { id: 'autos', label: 'Autos', version: 1, eyeStyles: ['live-v1'], shapes: ['standard', 'slender', 'wide'], expressions },
      { id: 'spacex', label: 'SpaceX', version: 1, eyeStyles: ['live-v1'],
        shapes: ['circle', 'pebble', 'squircle', 'capsule', 'triangle', 'hexagon', 'cloud', 'droplet'], expressions },
    ]);
    expect(catalog.map(({ id, shapes }) => ({ id, shapes }))).toEqual(
      Object.entries(familyKinds).map(([id, shapes]) => ({ id, shapes })),
    );
    expect(catalog).toHaveLength(17);
    expect(catalog.reduce((total, skin) => total + skin.shapes.length, 0)).toBe(62);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(getCharacterExpressions()).toEqual(expressions);
    expect(Object.isFrozen(getCharacterExpressions())).toBe(true);
    for (const skin of catalog) {
      expect(skin.shapes.length).toBeGreaterThan(1);
      expect(skin).toMatchObject({ version: 1, eyeStyles: ['live-v1'], expressions });
      expect(Object.isFrozen(skin)).toBe(true);
      expect(Object.isFrozen(skin.eyeStyles)).toBe(true);
      expect(Object.isFrozen(skin.shapes)).toBe(true);
      expect(Object.isFrozen(skin.expressions)).toBe(true);
    }
  });

  it('renders deterministic defaults and a size-only call without changing identity-derived geometry', () => {
    const value = generateCharacter(did);
    expect(value).toMatchObject({ did, skin: 'autos', skinVersion: 1, eyeStyle: 'live-v1', expression: 'neutral',
      view: 'avatar', size: 512, animated: true, state: { blink: 0, gaze: { x: 0, y: 0 } } });
    expect(generateCharacter(did)).toEqual(value);
    expect(renderCharacterSvg(did)).toBe(value.svg);
    const resized = generateCharacter(did, { size: 128 });
    expect(resized.shape).toBe(value.shape);
    expect(resized.color).toBe(value.color);
    expect(resized.svg.replace('width="128" height="128"', 'width="512" height="512"')).toBe(value.svg);
  });

  it.each([
    { skin: 'autos', shape: 'standard', crop: '136 48 240 240', face: 'translate(256 168) scale(0.85) translate(-256 -264)' },
    { skin: 'autos', shape: 'slender', crop: '148 44 216 216', face: 'translate(256 152) scale(0.75) translate(-256 -264)' },
    { skin: 'autos', shape: 'wide', crop: '124 58 264 264', face: 'translate(256 190) scale(0.95) translate(-256 -264)' },
    { skin: 'spacex', shape: 'circle', crop: '96 104 320 320', face: 'translate(256 264) scale(1) translate(-256 -264)' },
    { skin: 'fold', shape: 'standard', crop: '130 40 252 252', face: 'translate(256 166) scale(1.2) translate(-256 -264)' },
    { skin: 'fold', shape: 'kite', crop: '124 34 264 264', face: 'translate(256 166) scale(1.2) translate(-256 -264)' },
  ] as const)('frames the $skin/$shape avatar around the upper face', ({ skin, shape, crop, face }) => {
    const avatar = generateCharacter(did, { skin, shape, animated: false });
    expect(avatar.view).toBe('avatar');
    expect(avatar.svg).toContain(`viewBox="${crop}"`);
    expect(avatar.svg).toContain(`<g data-character-face="true" transform="${face}">`);
    const full = generateCharacter(did, { skin, shape, view: 'full', animated: false });
    expect(full.view).toBe('full');
    expect(full.svg).toContain('viewBox="0 0 512 512"');
    expect(full.svg).toContain(`<g data-character-face="true" transform="${face}">`);
    expect(bodyMarkup(full.svg)).toBe(bodyMarkup(avatar.svg));
    expect(bars(full.svg)).toEqual(bars(avatar.svg));
  });

  it('switches all 62 kinds between avatar and full without reseeding or changing body/eyes', () => {
    for (const skin of getCharacterSkins()) for (const shape of skin.shapes) {
      const avatar = generateCharacter(did, { skin: skin.id, shape, size: 32, animated: false });
      const full = generateCharacter(did, { skin: skin.id, shape, size: 32, view: 'full', animated: false });
      expect(avatar).toMatchObject({ did, skin: skin.id, shape, view: 'avatar', size: 32 });
      expect(full).toMatchObject({ did, skin: skin.id, shape, view: 'full', color: avatar.color, state: avatar.state });
      expect(bodyMarkup(full.svg)).toBe(bodyMarkup(avatar.svg));
      expect(bars(full.svg)).toEqual(bars(avatar.svg));
      const crop = attributes(avatar.svg.match(/^<svg\b[^>]*>/)![0]).viewBox!.split(' ').map(Number);
      expect(crop).toHaveLength(4);
      expect(crop.every(Number.isFinite)).toBe(true);
      expect(crop[0]).toBeGreaterThanOrEqual(0);
      expect(crop[1]).toBeGreaterThanOrEqual(0);
      expect(crop[2]).toBeGreaterThan(0);
      expect(crop[2]).toBeLessThan(512);
      expect(crop[3]).toBe(crop[2]);
      expect(full.svg).toContain('viewBox="0 0 512 512"');
      const seed = (svg: string) => attributes(svg.match(/^<svg\b[^>]*>/)![0])['data-character-seed'];
      expect(seed(avatar.svg)).toBe(seed(full.svg));
    }
  });

  it('domain-separates skin and hashes the entire literal DID, preserving legacy identity strings', () => {
    const legacy = 'did:l1fe:agent:character-vector';
    for (const [identifier, skin] of [[did, 'autos'], [did, 'spacex'], [legacy, 'autos']] as const) {
      const value = generateCharacter(identifier, { skin });
      const digest = blake3(new TextEncoder().encode(`oaid-character-v1\u0000${skin}\u0000${identifier}`));
      const hex = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      expect(value.svg).toContain(`data-character-seed="${hex}"`);
      expect(value.did).toBe(identifier);
    }
    expect(generateCharacter(did).svg).not.toBe(generateCharacter(legacy).svg);
    expect(generateCharacter(did).svg).not.toBe(generateCharacter(did, { skin: 'spacex' }).svg);
    expect(generateCharacter(did).svg).not.toBe(generateCharacter('did:oas:another:agent:character-vector').svg);
    expect(generateCharacter(did).svg).not.toBe(generateCharacter('did:oas:openagent:agent:another-vector').svg);
    expect(generateCharacter('did:oas:openagent:agent:instance:character-vector').did)
      .toBe('did:oas:openagent:agent:instance:character-vector');
  });

  it.each(['autos', 'spacex'] as const)('renders every %s body using only local shape geometry and two white vertical eyes', (skin) => {
    const expected = getCharacterSkins().find((entry) => entry.id === skin)!.shapes;
    const observed = new Set<string>();
    for (let index = 0; index < 256; index++) {
      const character = generateCharacter(`did:oas:openagent:agent:geometry-${index}`, { skin, animated: false, view: 'full' });
      observed.add(character.shape);
      expect(colors).toContain(character.color);
      expect(character.svg.match(/data-character-body="true"/g)).toHaveLength(1);
      expect(character.svg).toContain('viewBox="0 0 512 512"');
      expect(character.svg).toContain('<g data-character-eyes="live-v1" transform="translate(0 0)" fill="#ffffff">');
      const eyes = bars(character.svg);
      expect(eyes).toHaveLength(2);
      expect(eyes.map((eye) => eye['data-character-eye'])).toEqual(['left', 'right']);
      for (const eye of eyes) expect(eye).toMatchObject({ width: '28', height: '72', rx: '14', y: '228' });
      expect(character.svg).not.toMatch(/<(?:script|foreignObject|image|text|animate|animateTransform)\b|\bon\w+=|\bhref=/i);
      expect(character.svg).not.toContain(character.did);
      if (skin === 'autos') {
        const body = attributes(character.svg.match(/<rect\b[^>]*data-character-body="true"[^>]*>/)![0]);
        expect(Number(body.height)).toBeGreaterThan(Number(body.width));
        expect(Number(body.rx)).toBe(Number(body.width) / 2);
      }
    }
    expect([...observed].sort()).toEqual([...expected].sort());
  });

  it('blinks both bars by changing height and y around a shared center without changing width', () => {
    const character = generateCharacter(did);
    const heightAnimations = animation(character.svg, 'height');
    const yAnimations = animation(character.svg, 'y');
    expect(heightAnimations).toHaveLength(2);
    expect(yAnimations).toHaveLength(2);
    expect(heightAnimations[0]).toEqual(heightAnimations[1]);
    expect(yAnimations[0]).toEqual(yAnimations[1]);
    expect(heightAnimations[0]).toMatchObject({ values: '72;72;2;72;72',
      keyTimes: '0;0.78;0.8;0.84;1', begin: '0s', repeatCount: 'indefinite' });
    expect(yAnimations[0]).toMatchObject({ values: '228;228;263;228;228' });
    expect(heightAnimations[0]!.dur).toBe(yAnimations[0]!.dur);
    const heights = heightAnimations[0]!.values!.split(';').map(Number);
    const ys = yAnimations[0]!.values!.split(';').map(Number);
    expect(heights.map((height, index) => height / 2 + ys[index]!)).toEqual([264, 264, 264, 264, 264]);
    expect(animation(character.svg, 'width')).toHaveLength(0);
    expect(character.svg).not.toMatch(/<animateTransform\b[^>]*type="scale"/);
  });

  it('moves both eyes through one bounded translation animation', () => {
    const svg = generateCharacter(did).svg;
    const transforms = [...svg.matchAll(/<animateTransform\b[^>]*>/g)].map((match) => attributes(match[0]));
    expect(transforms).toHaveLength(1);
    expect(transforms[0]).toMatchObject({ attributeName: 'transform', type: 'translate',
      values: '0 0;8 -5;-8 5;0 0', keyTimes: '0;0.35;0.7;1', begin: '0s', repeatCount: 'indefinite' });
    expect(svg.indexOf('<animateTransform')).toBeGreaterThan(svg.indexOf('data-character-eyes="live-v1"'));
    expect(svg.indexOf('<animateTransform')).toBeLessThan(svg.indexOf('data-character-eye="left"'));
  });

  it.each([0, 0.5, 1])('renders the explicit static blink %s without animations or moving the eye center', (blink) => {
    const character = generateCharacter(did, { animated: false, state: { blink, gaze: { x: 1, y: -1 } } });
    expect(character.state).toEqual({ blink, gaze: { x: 1, y: -1 } });
    expect(character.svg).toContain('transform="translate(20 -14)"');
    expect(character.svg).not.toMatch(/<animate(?:Transform)?\b/);
    for (const eye of bars(character.svg)) {
      expect(Number(eye.width)).toBe(28);
      expect(Number(eye.height)).toBe(72 - 70 * blink);
      expect(Number(eye.y) + Number(eye.height) / 2).toBe(264);
    }
  });

  it.each(['autos', 'spacex'] as const)('keeps extreme %s gaze and blink poses within the shared safe face bounds', (skin) => {
    for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const blink of [0, 1]) {
      const character = generateCharacter(did, { skin, state: { blink, gaze: { x, y } } });
      const gaze = attributes(character.svg.match(/<animateTransform\b[^>]*>/)![0]);
      const poses = gaze.values!.split(';').map((pose) => pose.split(' ').map(Number));
      for (const [dx, dy] of poses) {
        expect(Math.abs(dx!)).toBeLessThanOrEqual(20);
        expect(Math.abs(dy!)).toBeLessThanOrEqual(14);
        for (const eye of bars(character.svg)) {
          const left = Number(eye.x) + dx!;
          const top = Number(eye.y) + dy!;
          expect(left).toBeGreaterThanOrEqual(188);
          expect(left + Number(eye.width)).toBeLessThanOrEqual(324);
          expect(top).toBeGreaterThanOrEqual(214);
          expect(top + Number(eye.height)).toBeLessThanOrEqual(314);
        }
      }
    }
  });

  it.each(Object.keys(familyKinds) as CharacterSkin[])('shares all 18 expressions across %s without changing body, color or shape', (skin) => {
    const base = generateCharacter(did, { skin, animated: false });
    const body = bodyMarkup(base.svg);
    const signatures = new Set<string>();
    for (const expression of expressions) {
      const character = generateCharacter(did, { skin, expression, animated: false });
      expect(character.expression).toBe(expression);
      expect(character.shape).toBe(base.shape);
      expect(character.color).toBe(base.color);
      expect(character.svg).toContain(body);
      expect(bars(character.svg)).toEqual(bars(generateCharacter(did, { skin: 'autos', expression, animated: false }).svg));
      assertLocalGradients(character.svg);
      expect(character.svg).toContain('fill="#ffffff"');
      const eyes = bars(character.svg);
      expect(eyes).toHaveLength(2);
      for (const eye of eyes) {
        expect(Number(eye.width)).toBeGreaterThan(0);
        expect(Number(eye.height)).toBeGreaterThanOrEqual(2);
        expect(Number(eye.rx)).toBe(Number(eye.width) / 2);
      }
      signatures.add(JSON.stringify(eyes));
    }
    expect(signatures.size).toBe(18);
  });

  it('animates asymmetric expressions with synchronized blink timing and fixed bar centers', () => {
    for (const expression of expressions) {
      const character = generateCharacter(did, { expression });
      const blocks = [...character.svg.matchAll(/(<rect\b[^>]*data-character-eye="(?:left|right)"[^>]*>)(.*?)<\/rect>/g)];
      expect(blocks).toHaveLength(2);
      for (const block of blocks) {
        const eye = attributes(block[1]!);
        const heights = animation(block[2]!, 'height');
        const ys = animation(block[2]!, 'y');
        expect(heights).toHaveLength(1);
        expect(ys).toHaveLength(1);
        expect(heights[0]).toMatchObject({ keyTimes: '0;0.78;0.8;0.84;1', begin: '0s', repeatCount: 'indefinite' });
        const center = Number(eye.y) + Number(eye.height) / 2;
        const values = heights[0]!.values!.split(';').map(Number);
        const positions = ys[0]!.values!.split(';').map(Number);
        for (let index = 0; index < values.length; index++) expect(values[index]! / 2 + positions[index]!).toBeCloseTo(center, 3);
        expect(values[2]).toBe(2);
      }
      const heights = animation(character.svg, 'height');
      expect(heights[0]!.dur).toBe(heights[1]!.dur);
      expect(animation(character.svg, 'width')).toHaveLength(0);
    }
  });

  it('applies static blink to expression height while preserving its width and center', () => {
    const character = generateCharacter(did, { expression: 'surprised', animated: false, state: { blink: 0.5 } });
    expect(character.expression).toBe('surprised');
    expect(character.svg).not.toContain('<animate');
    for (const eye of bars(character.svg)) expect(eye).toMatchObject({ width: '40', height: '29', y: '249.5', rx: '20' });
  });

  it.each(['autos', 'spacex'] as const)('keeps every rotated %s expression inside the safe face at extreme gaze', (skin) => {
    for (const shape of getCharacterSkins().find((item) => item.id === skin)!.shapes) {
      for (const expression of expressions) for (const blink of [0, 1]) {
        const character = generateCharacter(did, { skin, shape, expression, animated: false, state: { blink } });
        for (const eye of bars(character.svg)) {
          const angle = Number(eye.transform?.match(/^rotate\((-?[\d.]+)/)?.[1] ?? 0) * Math.PI / 180;
          const cx = Number(eye.x) + Number(eye.width) / 2;
          const cy = Number(eye.y) + Number(eye.height) / 2;
          for (const dx of [-Number(eye.width) / 2, Number(eye.width) / 2]) {
            for (const dy of [-Number(eye.height) / 2, Number(eye.height) / 2]) {
              const x = cx + dx * Math.cos(angle) - dy * Math.sin(angle);
              const y = cy + dx * Math.sin(angle) + dy * Math.cos(angle);
              expect(x - 20).toBeGreaterThanOrEqual(176);
              expect(x + 20).toBeLessThanOrEqual(336);
              expect(y - 14).toBeGreaterThanOrEqual(198);
              expect(y + 14).toBeLessThanOrEqual(340);
            }
          }
        }
      }
    }
  });

  it('renders all 62 kinds with distinct geometry and preserves identity-derived legacy colors', () => {
    const allGeometry = new Set<string>();
    for (const skin of getCharacterSkins()) {
      const base = generateCharacter(did, { skin: skin.id });
      const silhouettes = new Set<string>();
      for (const shape of skin.shapes) {
        const character = generateCharacter(did, { skin: skin.id, shape, animated: false });
        expect(character.shape).toBe(shape);
        expect(character.svg.match(/data-character-body="true"/g)).toHaveLength(1);
        expect(bars(character.svg)).toHaveLength(2);
        assertLocalGradients(character.svg);
        if (skin.id === 'autos' || skin.id === 'spacex') expect(character.color).toBe(base.color);
        else {
          const other = generateCharacter('did:oas:openagent:agent:another-character', { skin: skin.id, shape, animated: false });
          expect(character.color).toBe(other.color);
          expect(bodyGeometry(character.svg)).toBe(bodyGeometry(other.svg));
          expect(character.svg).toContain('<linearGradient');
        }
        const geometry = bodyGeometry(character.svg);
        silhouettes.add(geometry);
        allGeometry.add(geometry);
      }
      expect(silhouettes.size).toBe(skin.shapes.length);
    }
    expect(allGeometry.size).toBe(62);
  });

  it('copies and freezes caller eye state instead of retaining mutable runtime input', () => {
    const state = { blink: 0.25, gaze: { x: 0.5, y: -0.5 } };
    const character = generateCharacter(did, { state });
    state.blink = 1;
    state.gaze.x = -1;
    expect(character.state).toEqual({ blink: 0.25, gaze: { x: 0.5, y: -0.5 } });
    expect(Object.isFrozen(character)).toBe(true);
    expect(Object.isFrozen(character.state)).toBe(true);
    expect(Object.isFrozen(character.state.gaze)).toBe(true);
  });

  it('strictly parses and copies stored skin selection independently of expression/state', () => {
    expect(parseCharacterAppearance({ skin: 'autos' })).toEqual({ skin: 'autos' });
    const input = { skin: 'spacex', skinVersion: 1, eyeStyle: 'live-v1', shape: 'cloud' };
    const appearance = parseCharacterAppearance(input);
    expect(appearance).toEqual(input);
    expect(Object.isFrozen(appearance)).toBe(true);
    input.shape = 'circle';
    input.skin = 'autos';
    expect(appearance).toMatchObject({ skin: 'spacex', shape: 'cloud' });
    for (const skin of getCharacterSkins()) for (const shape of skin.shapes) {
      expect(parseCharacterAppearance({ skin: skin.id, shape })).toEqual({ skin: skin.id, shape });
    }
  });

  it.each(Object.keys(familyKinds) as CharacterSkin[])('refuses a kind from another family for %s', (skin) => {
    const allowed = getCharacterSkins().find(family => family.id === skin)!.shapes;
    const other = getCharacterSkins().flatMap(family => family.shapes).find(shape => !allowed.includes(shape))!;
    expect(() => generateCharacter(did, { skin, shape: other })).toThrow();
    expect(() => parseCharacterAppearance({ skin, shape: other })).toThrow();
    expect(() => parseCharacterAppearance({ skin, view: 'avatar' })).toThrow();
    expect(() => parseCharacterAppearance({ skin, view: 'full' })).toThrow();
  });

  it.each([
    null, [], {}, { skin: undefined }, { skin: null }, { skin: 'pill' }, { skin: 'unknown' },
    { shape: 'standard' }, { skin: 'autos', shape: 'circle' }, { skin: 'spacex', shape: 'wide' },
    { skin: 'autos', shape: null }, { skin: 'autos', skinVersion: 2 }, { skin: 'autos', skinVersion: null },
    { skin: 'autos', skinVersion: '1' }, { skin: 'autos', eyeStyle: 'live-v2' },
    { skin: 'autos', eyeStyle: null }, { skin: 'autos', expression: 'happy' },
    { skin: 'autos', state: {} }, { skin: 'autos', size: 64 }, { skin: 'autos', animated: false },
    { skin: 'autos', did }, { style: 'autos' },
  ])('rejects malformed stored appearance %j instead of treating it as render options', (value) => {
    expect(() => parseCharacterAppearance(value)).toThrow();
  });

  it.each([32, 512, 2048])('preserves fixed geometry at supported pixel size %s', (size) => {
    const character = generateCharacter(did, { size, view: 'full' });
    expect(character.svg).toContain(`width="${size}" height="${size}"`);
    expect(character.svg).toContain('viewBox="0 0 512 512"');
    expect(bars(character.svg).map((eye) => eye.width)).toEqual(['28', '28']);
  });

  it.each([
    'did:oas:openagent:hmr:person', 'did:oas:openagent:tool:hammer', 'did:l1fe:service:old',
    'did:oas:openagent:agent:<script>', 'did:oas:openagent:agent:', 'did:oas:OPEN:agent:worker',
    'did:l1fe:openagent:agent:worker', `did:oas:openagent:agent:${'a'.repeat(513)}`, '',
  ])('rejects invalid/non-agent DID %s before rendering', (identifier) => {
    expect(() => generateCharacter(identifier)).toThrow();
  });

  it.each([
    null, [], { skin: null }, { skin: 'unknown' }, { skin: 'pill' }, { skinVersion: 0 }, { skinVersion: 2 },
    { skinVersion: '1' }, { eyeStyle: 'live-v2' }, { eyeStyle: null }, { animated: 'true' },
    { shape: 'circle' }, { skin: 'spacex', shape: 'standard' }, { shape: 'unknown' }, { shape: null },
    { expression: null }, { expression: 'unknown' }, { style: 'autos' }, { styleVersion: 1 },
    { view: null }, { view: '' }, { view: 'portrait' }, { view: 'full\n' }, { view: 1 }, { view: true }, { view: {} },
    { size: 31 }, { size: 2049 }, { size: 128.5 }, { size: NaN }, { size: Infinity }, { size: null },
    { state: null }, { state: [] }, { state: { blink: -0.01 } }, { state: { blink: 1.01 } },
    { state: { blink: Infinity } }, { state: { blink: NaN } }, { state: { blink: '0' } },
    { state: { gaze: null } }, { state: { gaze: {} } }, { state: { gaze: { x: 0 } } },
    { state: { gaze: { x: 1.01, y: 0 } } }, { state: { gaze: { x: 0, y: -1.01 } } },
    { state: { gaze: { x: NaN, y: 0 } } }, { state: { gaze: { x: 0, y: Infinity } } },
    { state: { gaze: { x: 0, y: 0, z: 1 } } }, { state: { wink: 1 } }, { mouth: 'smile' },
  ])('refuses malformed or unsupported options %j without dropping/clamping fields', (options) => {
    expect(() => generateCharacter(did, options as unknown as CharacterOptions)).toThrow();
  });

  it.each(['autos', 'spacex'] as const)('keeps explicit appearance version/eye defaults stable for %s', (skin: CharacterSkin) => {
    expect(generateCharacter(did, { skin })).toEqual(generateCharacter(did,
      { skin, skinVersion: 1, eyeStyle: 'live-v1', expression: 'neutral', size: 512, animated: true, state: { blink: 0, gaze: { x: 0, y: 0 } } }));
  });
});
