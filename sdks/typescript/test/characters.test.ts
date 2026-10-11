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
const colors = ['#757575', '#1687ff', '#ff6a00', '#161616', '#00c875', '#96663c', '#7656d6', '#e84770'];
const expressions = ['neutral', 'attentive', 'surprised', 'excited', 'happy', 'laughing', 'angry', 'sad',
  'scared', 'suspicious', 'confused', 'curious', 'proud', 'shy', 'unimpressed', 'sleepy'] as const;

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

describe('OpenAgent character profile v1', () => {
  // Independently generated with hash-pinned Python blake3 1.0.11 on Depot:
  // golden-seeds/golden02, build z3hnww3bvq. No renderer or noble dependency.
  it.each([
    { skin: 'autos' as const, digest: 'df1f10e82423a8b87280b0593d66115a0243ca2ff1d6636b28c5de53cd72fbb1',
      shape: 'slender', color: '#e84770', geometry: 'x="168" y="48" width="176" height="416" rx="88"' },
    { skin: 'spacex' as const, digest: 'b2bc833af9bb8e8b8bbbe012072217cb3c682b77f4f57a1de106ace283b03e48',
      shape: 'squircle', color: '#00c875', geometry: 'x="104" y="104" width="304" height="304" rx="88"' },
  ])('matches the independent full-DID $skin profile vector', ({ skin, digest, shape, color, geometry }) => {
    const character = generateCharacter(did, { skin, animated: false });
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
    expect(catalog).toEqual([
      { id: 'autos', label: 'Autos', version: 1, eyeStyles: ['live-v1'], shapes: ['standard', 'slender', 'wide'], expressions },
      { id: 'spacex', label: 'SpaceX', version: 1, eyeStyles: ['live-v1'],
        shapes: ['circle', 'pebble', 'squircle', 'capsule', 'triangle', 'hexagon', 'cloud', 'droplet'], expressions },
    ]);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(getCharacterExpressions()).toEqual(expressions);
    expect(Object.isFrozen(getCharacterExpressions())).toBe(true);
    for (const skin of catalog) {
      expect(Object.isFrozen(skin)).toBe(true);
      expect(Object.isFrozen(skin.eyeStyles)).toBe(true);
      expect(Object.isFrozen(skin.shapes)).toBe(true);
      expect(Object.isFrozen(skin.expressions)).toBe(true);
    }
  });

  it('renders deterministic defaults and a size-only call without changing identity-derived geometry', () => {
    const value = generateCharacter(did);
    expect(value).toMatchObject({ did, skin: 'autos', skinVersion: 1, eyeStyle: 'live-v1', expression: 'neutral',
      size: 512, animated: true, state: { blink: 0, gaze: { x: 0, y: 0 } } });
    expect(generateCharacter(did)).toEqual(value);
    expect(renderCharacterSvg(did)).toBe(value.svg);
    const resized = generateCharacter(did, { size: 128 });
    expect(resized.shape).toBe(value.shape);
    expect(resized.color).toBe(value.color);
    expect(resized.svg.replace('width="128" height="128"', 'width="512" height="512"')).toBe(value.svg);
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
      const character = generateCharacter(`did:oas:openagent:agent:geometry-${index}`, { skin, animated: false });
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
      keyTimes: '0;0.78;0.8;0.82;1', begin: '0s', repeatCount: 'indefinite' });
    expect(yAnimations[0]).toMatchObject({ values: '228;228;263;228;228' });
    expect(heightAnimations[0]!.dur).toBe(yAnimations[0]!.dur);
    const heights = heightAnimations[0]!.values!.split(';').map(Number);
    const ys = yAnimations[0]!.values!.split(';').map(Number);
    expect(heights.map((height, index) => height / 2 + ys[index]!)).toEqual([264, 264, 264, 264, 264]);
    expect(animation(character.svg, 'width')).toHaveLength(0);
    expect(character.svg).not.toContain('scale(');
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

  it.each(['autos', 'spacex'] as const)('shares all 16 expressions across %s without changing body, color or shape', (skin) => {
    const base = generateCharacter(did, { skin, animated: false });
    const body = base.svg.match(/<(?:rect|path|circle|ellipse)\b[^>]*data-character-body="true"[^>]*\/>/)![0];
    const signatures = new Set<string>();
    for (const expression of expressions) {
      const character = generateCharacter(did, { skin, expression, animated: false });
      expect(character.expression).toBe(expression);
      expect(character.shape).toBe(base.shape);
      expect(character.color).toBe(base.color);
      expect(character.svg).toContain(body);
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
    expect(signatures.size).toBe(16);
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
        expect(heights[0]).toMatchObject({ keyTimes: '0;0.78;0.8;0.82;1', begin: '0s', repeatCount: 'indefinite' });
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

  it('accepts every explicit per-skin shape while preserving the DID-derived color', () => {
    for (const skin of getCharacterSkins()) {
      const base = generateCharacter(did, { skin: skin.id });
      const silhouettes = new Set<string>();
      for (const shape of skin.shapes) {
        const character = generateCharacter(did, { skin: skin.id, shape });
        expect(character.shape).toBe(shape);
        expect(character.color).toBe(base.color);
        silhouettes.add(character.svg.match(/<(?:rect|path|circle|ellipse)\b[^>]*data-character-body="true"[^>]*\/>/)![0]);
      }
      expect(silhouettes.size).toBe(skin.shapes.length);
    }
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
    const character = generateCharacter(did, { size });
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
