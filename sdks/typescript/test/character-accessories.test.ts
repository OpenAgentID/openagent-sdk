import { describe, expect, it } from 'vitest';
import { characterAccessories, characterGlassesPose, getCharacterAccessories, parseCharacterAccessories,
  type CharacterAccessory } from '../src/character-accessories.js';
import type { CharacterArtNode } from '../src/character-art-types.js';
import { characterFraming, serializeCharacterBody } from '../src/character-body.js';
import { generateCharacter, getCharacterSkins, parseCharacterAppearance, type CharacterOptions } from '../src/characters.js';
import { agentAvatar, oasGlyph } from '../src/glyph.js';

const did = 'did:oas:openagent:agent:character-vector';
const both: readonly CharacterAccessory[] = ['glasses', 'headphones'];
const combinations: readonly (readonly CharacterAccessory[])[] = [[], ['glasses'], ['headphones'], both];
const invalid: readonly unknown[] = [null, false, 0, '', 'glasses', {}, { 0: 'glasses', length: 1 },
  [''], ['Glasses'], [' glasses'], ['glasses '], ['hat'], ['glasses', 'glasses'],
  ['headphones', 'headphones'], ['glasses', 'headphones', 'glasses'], [undefined], [null], [1],
  [true], [['glasses']], new Array(1)];

function descendants(node: CharacterArtNode): CharacterArtNode[] {
  return [node, ...(node.children?.flatMap(descendants) ?? [])];
}

interface Point { x: number; y: number; stroke: number }
/** Sample the actual package path commands; no inferred bounds from changing pixels. */
function pathPoints(d: string, stroke: number): Point[] {
  const tokens = d.match(/[MQH]|-?\d+(?:\.\d+)?/g)!;
  const result: Point[] = [];
  let index = 0, x = 0, y = 0;
  while (index < tokens.length) {
    const command = tokens[index++]!;
    const number = () => Number(tokens[index++]);
    if (command === 'M') { x = number(); y = number(); result.push({ x, y, stroke }); }
    else if (command === 'H') { x = number(); result.push({ x, y, stroke }); }
    else if (command === 'Q') {
      const cx = number(), cy = number(), endX = number(), endY = number();
      for (let step = 0; step <= 64; step++) {
        const t = step / 64;
        result.push({ x: (1 - t) ** 2 * x + 2 * (1 - t) * t * cx + t ** 2 * endX,
          y: (1 - t) ** 2 * y + 2 * (1 - t) * t * cy + t ** 2 * endY, stroke });
      }
      x = endX; y = endY;
    } else throw new Error('Unexpected accessory path command');
  }
  return result;
}

function artPoints(root: CharacterArtNode): Point[] {
  return descendants(root).flatMap(node => {
    const a = node.attributes, stroke = Number(a['stroke-width'] ?? 0) / 2;
    if (node.tag === 'path') return pathPoints(a.d!, stroke);
    if (node.tag !== 'rect') return [];
    const x = Number(a.x), y = Number(a.y), width = Number(a.width), height = Number(a.height);
    // Rectangle corners overestimate rounded corners, so this is conservative.
    return [x, x + width].flatMap(px => [y, y + height].map(py => ({ x: px, y: py, stroke })));
  });
}


describe('independent character accessories', () => {
  it('exposes a deeply immutable descriptive catalog without a synthetic none entry', () => {
    const catalog = getCharacterAccessories();
    expect(catalog.map(entry => entry.id)).toEqual(both);
    expect(Object.isFrozen(catalog)).toBe(true);
    for (const entry of catalog) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it('defaults to none and canonically orders a frozen copy', () => {
    expect(parseCharacterAccessories(undefined)).toEqual([]);
    expect(Object.isFrozen(parseCharacterAccessories([]))).toBe(true);
    const input: CharacterAccessory[] = ['headphones', 'glasses'];
    const parsed = parseCharacterAccessories(input);
    input.pop();
    expect(parsed).toEqual(both);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(parseCharacterAccessories(Object.freeze(['headphones']))).toEqual(['headphones']);
  });

  it.each(invalid.map(value => ({ value })))('refuses malformed or duplicate selection $value', ({ value }) => {
    expect(() => parseCharacterAccessories(value)).toThrow(TypeError);
    expect(() => characterAccessories(value as readonly CharacterAccessory[])).toThrow(TypeError);
    expect(() => parseCharacterAppearance({ skin: 'autos', accessories: value })).toThrow(TypeError);
    expect(() => generateCharacter(did, { accessories: value } as CharacterOptions)).toThrow(TypeError);
  });

  it.each(combinations.map(value => ({ value })))('produces closed immutable art for $value', ({ value }) => {
    const art = characterAccessories(value);
    expect(art.attributes['data-character-accessories']).toBe('true');
    expect(art.children?.map(child => child.attributes['data-character-accessory'])).toEqual(value);
    const allowed = ['data-character-accessories', 'data-character-accessory', 'aria-hidden',
      'transform', 'data-glasses-frames', 'data-glasses-temples', 'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'x', 'y', 'width', 'height', 'rx'];
    for (const node of descendants(art)) {
      expect(['g', 'rect', 'path']).toContain(node.tag);
      expect(Object.isFrozen(node)).toBe(true);
      expect(Object.isFrozen(node.attributes)).toBe(true);
      if (node.children) expect(Object.isFrozen(node.children)).toBe(true);
      expect(Object.keys(node.attributes).every(key => allowed.includes(key))).toBe(true);
      expect(node.attributes.fill ?? '').not.toMatch(/^#(?:fff|ffffff)$/i);
    }
    const svg = serializeCharacterBody(art);
    expect(svg).not.toMatch(/<(?:script|foreignObject|image|text|animate)\b|\b(?:on\w+|href|style|id)=|url\(/i);
    expect(svg).not.toContain('data-character-eye=');
    expect(svg).toBe(serializeCharacterBody(characterAccessories([...value].reverse())));
  });

  it('keeps lenses fully transparent without adding facial features', () => {
    const glasses = characterAccessories(['glasses']).children![0]!;
    const frames = descendants(glasses).filter(node => node.tag === 'rect');
    expect(frames).toHaveLength(4); // Two hollow lenses, each with a contrasting keyline.
    expect(frames.every(node => node.attributes.fill === 'none')).toBe(true);
    expect(new Set(frames.map(node => node.attributes.stroke))).toEqual(new Set(['#BAC5CF', '#273647']));
    expect(descendants(glasses).every(node => node.attributes.fill === undefined || node.attributes.fill === 'none')).toBe(true);
  });

  it('fits external headgear inside every circular crop with stable framing across gaze and expression', () => {
    // One heads keep wearables in their descriptor but do not draw them (see character-one.test.ts).
    for (const family of getCharacterSkins().filter(entry => entry.id !== 'one')) for (const shape of family.shapes) for (const eyePlacement of ['face', 'raised'] as const) {
      const framing = characterFraming(family.id, shape, 'avatar', { accessories: both, eyePlacement });
      const [cropX, cropY, size] = framing.viewBox.split(' ').map(Number) as [number, number, number];
      const [faceX, faceY, scale] = framing.faceTransform.match(/-?\d+(?:\.\d+)?/g)!.map(Number) as [number, number, number, ...number[]];
      const points = artPoints(characterAccessories(both, framing.head, { x: 0, y: 0 }, framing.eyeOffset));
      for (const point of points) {
        const x = faceX + (point.x - 256) * scale, y = faceY + (point.y - 264) * scale;
        expect(Math.hypot(x - (cropX + size / 2), y - (cropY + size / 2)) + point.stroke * scale,
          family.id + '/' + shape + '/' + eyePlacement).toBeLessThan(size / 2);
      }
      const cups = descendants(characterAccessories(['headphones'], framing.head)).filter(node => node.tag === 'rect' && node.attributes.width === '27');
      expect(Number(cups[0]!.attributes.x) + 27).toBeLessThan(framing.head.left);
      expect(Number(cups[1]!.attributes.x)).toBeGreaterThan(framing.head.right);
      const options = { skin: family.id, shape, eyePlacement, accessories: both, animated: false };
      const rest = generateCharacter(did, options);
      const moved = generateCharacter(did, { ...options, state: { gaze: { x: 1, y: -1 }, expression: 'scared' } });
      expect(rest.svg.match(/viewBox="([^"]+)"/)![1]).toBe(moved.svg.match(/viewBox="([^"]+)"/)![1]);
    }
  });

  it('moves only frames with gaze while temple endpoints remain on the head', () => {
    const head = { left: 130, right: 382, top: 120, sideY: 270 };
    const rest = characterGlassesPose(head, { x: 0, y: 0 });
    const moved = characterGlassesPose(head, { x: 1, y: -1 });
    expect(rest.transform).toBe('translate(0 0)');
    expect(moved.transform).toBe('translate(20 -14)');
    expect(moved.temples).toContain('M130 270');
    expect(moved.temples).toContain('M382 270');
    const frames = (gaze: { x: number; y: number }) => descendants(characterAccessories(['glasses'], head, gaze)).filter(node => node.tag === 'rect').map(node => node.attributes);
    expect(frames({ x: 1, y: -1 })).toEqual(frames({ x: 0, y: 0 }));
  });

  it.each(getCharacterSkins().filter(entry => entry.id !== 'one').map(family => ({ family })))('adds wearables to $family.id without changing seed, body or live eyes', ({ family }) => {
    const options: CharacterOptions = { skin: family.id, animated: true, state: { expression: 'scared', gaze: { x: -1, y: 1 } } };
    const bare = generateCharacter(did, options);
    const adorned = generateCharacter(did, { ...options, accessories: both });
    expect(generateCharacter(did, { ...options, accessories: [] }).svg).toBe(bare.svg);
    expect(bare.svg).not.toContain('data-character-accessories');
    expect(adorned.accessories).toEqual(both);
    expect(Object.isFrozen(adorned.accessories)).toBe(true);
    expect(adorned.color).toBe(bare.color);
    expect(adorned.shape).toBe(bare.shape);
    expect(adorned.svg.slice(adorned.svg.indexOf('<g data-character-eyes'))).toBe(bare.svg.slice(bare.svg.indexOf('<g data-character-eyes')));
    expect(adorned.svg.indexOf('data-character-accessories')).toBeLessThan(adorned.svg.indexOf('data-character-eyes'));
    expect(generateCharacter(did, { ...options, accessories: ['headphones', 'glasses'] }).svg).toBe(adorned.svg);
    const appearance = parseCharacterAppearance({ skin: family.id, accessories: ['headphones', 'glasses'] });
    expect(appearance.accessories).toEqual(both);
    expect(Object.isFrozen(appearance.accessories)).toBe(true);
    expect(decodeURIComponent(agentAvatar(did, { avatarSkin: appearance }, { animated: true, state: options.state }).split(',')[1]!)).toBe(adorned.svg);
  });

  it('preserves absent stored appearance and independent explicit Glyph or image overrides', () => {
    expect(parseCharacterAppearance({ skin: 'autos' })).toEqual({ skin: 'autos' });
    expect(parseCharacterAppearance({ skin: 'autos', accessories: [] })).toEqual({ skin: 'autos', accessories: [] });
    expect(decodeURIComponent(agentAvatar(did, { avatarSkin: null }).split(',')[1]!)).toBe(oasGlyph(did));
    const profile = { avatarSkin: { skin: 'autos' as const, accessories: both }, avatarOverride: 'https://example.org/avatar.png' };
    expect(agentAvatar(did, profile)).toBe(profile.avatarOverride);
  });
});
