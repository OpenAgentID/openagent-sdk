import { describe, expect, it } from 'vitest';
import { characterAccessories, getCharacterAccessories, parseCharacterAccessories,
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

function withoutAccessories(svg: string): string {
  return svg.replace(serializeCharacterBody(characterAccessories(both)), '');
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
      'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'x', 'y', 'width', 'height', 'rx'];
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
    expect(new Set(frames.map(node => node.attributes.stroke))).toEqual(new Set(['#BBC4D1', '#243247']));
    expect(descendants(glasses).every(node => node.attributes.fill === undefined || node.attributes.fill === 'none')).toBe(true);
  });

  it('keeps accessory outlines and half-strokes inside every current circular face crop', () => {
    const points = artPoints(characterAccessories(both));
    expect(points.length).toBeGreaterThan(100);
    for (const point of points) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
      expect(Math.hypot(point.x - 256, point.y - 264) + point.stroke).toBeLessThanOrEqual(100);
    }
    for (const family of getCharacterSkins()) for (const shape of family.shapes) {
      const framing = characterFraming(family.id, shape, 'avatar');
      const [cropX, cropY, size] = framing.viewBox.split(' ').map(Number) as [number, number, number];
      const [faceX, faceY, scale] = framing.faceTransform.match(/-?\d+(?:\.\d+)?/g)!.map(Number) as [number, number, number, ...number[]];
      for (const point of points) {
        const x = faceX + (point.x - 256) * scale;
        const y = faceY + (point.y - 264) * scale;
        expect(Math.hypot(x - (cropX + size / 2), y - (cropY + size / 2)) + point.stroke * scale,
          family.id + '/' + shape).toBeLessThan(size / 2);
      }
    }
  });

  it.each(getCharacterSkins().map(family => ({ family })))('adds wearables to $family.id without changing seed, body, framing or live eyes', ({ family }) => {
    const options: CharacterOptions = { skin: family.id, animated: true, state: { expression: 'scared', gaze: { x: -1, y: 1 } } };
    const bare = generateCharacter(did, options);
    const adorned = generateCharacter(did, { ...options, accessories: both });
    expect(generateCharacter(did, { ...options, accessories: [] }).svg).toBe(bare.svg);
    expect(bare.svg).not.toContain('data-character-accessories');
    expect(adorned.accessories).toEqual(both);
    expect(Object.isFrozen(adorned.accessories)).toBe(true);
    expect(withoutAccessories(adorned.svg)).toBe(bare.svg);
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
