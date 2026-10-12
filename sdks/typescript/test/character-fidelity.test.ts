import { describe, expect, it } from 'vitest';
import { generateCharacter, getCharacterSkins, parseCharacterAppearance, type CharacterOptions } from '../src/characters.js';
import { characterFraming } from '../src/character-body.js';
import { characterHead } from '../src/character-head.js';

const did = 'did:oas:openagent:agent:fidelity';
describe('shared plush finish and raised live eyes', () => {
  it('defaults to plush without changing stored legacy appearance', () => {
    expect(generateCharacter(did)).toMatchObject({ finish: 'plush', eyePlacement: 'face', skin: 'autos' });
    expect(parseCharacterAppearance({ skin: 'autos' })).toEqual({ skin: 'autos' });
    expect(parseCharacterAppearance({ skin: 'autos', finish: 'flat', eyePlacement: 'raised' }))
      .toEqual({ skin: 'autos', finish: 'flat', eyePlacement: 'raised' });
  });

  it('uses exactly equal SMIL gaze clocks and keyframes for eyes, frames and raised pods', () => {
    const { svg } = generateCharacter(did, { eyePlacement: 'raised', accessories: ['glasses'], state: { gaze: { x: .3, y: -.2 } } });
    const transforms = [...svg.matchAll(/<animateTransform\b([^>]*)\/>/g)].map(match =>
      Object.fromEntries([...match[1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]])));
    expect(transforms).toHaveLength(3);
    expect(transforms[0]).toEqual(transforms[1]);
    expect(transforms[1]).toEqual(transforms[2]);
    const paths = [...svg.matchAll(/<animate\b[^>]*attributeName="d"([^>]*)\/>/g)];
    expect(paths).toHaveLength(3);
    for (const path of paths) for (const key of ['dur', 'begin', 'repeatCount', 'keyTimes', 'keySplines', 'calcMode']) {
      expect(path[0]).toContain(`${key}="${transforms[0]![key]}"`);
    }
  });

  it('centers rigid frames on the expression without making blink change them', () => {
    const selection = { accessories: ['glasses'] as const, animated: false, expression: 'scared' as const };
    const open = generateCharacter(did, selection), closed = generateCharacter(did, { ...selection, state: { blink: 1 } });
    const frame = (svg: string) => svg.match(/data-glasses-frames="true" transform="([^"]+)"/)![1];
    expect(frame(open.svg)).toBe('translate(0 16)');
    expect(frame(closed.svg)).toBe(frame(open.svg));
  });

  it.each([null, '', 'Plush', 'fur', 1, {}, [], '<script>'])('refuses malformed finish or placement %j', value => {
    expect(() => generateCharacter(did, { finish: value } as CharacterOptions)).toThrow();
    expect(() => generateCharacter(did, { eyePlacement: value } as CharacterOptions)).toThrow();
    expect(() => parseCharacterAppearance({ skin: 'autos', finish: value })).toThrow();
    expect(() => parseCharacterAppearance({ skin: 'autos', eyePlacement: value })).toThrow();
  });

  it('keeps deterministic local material definitions separate from the two animated bars', () => {
    for (const family of getCharacterSkins()) for (const shape of family.shapes) {
      const plush = generateCharacter(did, { skin: family.id, shape, eyePlacement: 'raised' });
      const flat = generateCharacter(did, { skin: family.id, shape, eyePlacement: 'raised', finish: 'flat' });
      expect(plush.svg).toBe(generateCharacter(did, { skin: family.id, shape, eyePlacement: 'raised' }).svg);
      expect(plush.color).toBe(flat.color);
      expect(plush.svg).toContain('<feTurbulence');
      expect(flat.svg).not.toContain('<filter');
      expect(plush.svg.match(/data-character-eye="(?:left|right)"/g)).toHaveLength(2);
      expect(plush.svg).not.toMatch(/<(?:script|image|foreignObject)\b|\b(?:href|on\w+)=/i);
      const ids = [...plush.svg.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
      expect(new Set(ids).size).toBe(ids.length);
      for (const reference of plush.svg.matchAll(/url\(#([^)]*)\)/g)) expect(ids).toContain(reference[1]);
      const eyes = plush.svg.slice(plush.svg.indexOf('<g data-character-eyes'));
      expect(eyes).not.toContain('filter=');
      const framing = characterFraming(family.id, shape, 'full', { eyePlacement: 'raised' });
      const [x, y, scale] = framing.faceTransform.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      expect(y).toBeLessThan(characterHead(family.id, shape).top);
      const [left, top, size] = framing.viewBox.split(' ').map(Number);
      // Worst-case pod extents at the extremes of gaze; full view must reserve them too.
      expect(x! + (147 - 256) * scale!).toBeGreaterThan(left!);
      expect(y! + (186 - 264) * scale!).toBeGreaterThan(top!);
      expect(x! + (365 - 256) * scale!).toBeLessThan(left! + size!);
      expect(y! + (342 - 264) * scale!).toBeLessThan(top! + size!);
    }
  });
});
