import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getOneColors, getOneShapes, isOneColorAllowed, oneLookForDid, oneOutlineSegments } from '../src/character-one.js';
import { getCharacterStatuses } from '../src/character-state.js';
import { renderOne, type OneOptions } from '../src/one.js';
import {
  ONE_APP_AVATAR_SIZES, ONE_AVATAR_SHAPE_ORDER, ONE_COLOR_FLOOR, ONE_DISTINCT_FLOOR_16PX, ONE_EYE_POSES, ONE_FIGURE_MOTION, ONE_FIGURE_MOTIONS,
  ONE_HEADWEAR, ONE_HEADWEAR_NEVER, getOneAvatarColors, getOneAvatarShapes, isOneAvatarColorAllowed, isOneHeadwearAllowed, mountOneAvatar,
  nextOneAvatar, oneAvatarSilhouette, oneAvatarSilhouetteOf, oneColorDistance, oneFigureCss, oneFigureMotionFor, oneFlattenPath,
  parseOneAvatarLook, renderOneAvatar, renderOneAvatarSizes,
  type OneAvatarLook, type OneAvatarShape, type OneHeadwear,
} from '../src/one-figure.js';
import { coverage, difference } from './helpers/one-silhouette.js';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/**
 * Every existing head vector: each of the fourteen shapes in each allowed colour and blank, and Digital One, at every
 * app avatar size plus 128 and 512, on both themes; then every status at four sizes; then a DID default. The hash is
 * renderOne's output on main before the figure family (0.8.1), pinned here so the head runtime can never drift.
 */
function baseVectors(): OneOptions[] {
  const sizes = [...ONE_APP_AVATAR_SIZES, 128, 512];
  const vectors: OneOptions[] = [];
  for (const theme of ['light', 'dark'] as const) for (const size of sizes) {
    for (const shape of getOneShapes()) {
      for (const color of getOneColors()) if (isOneColorAllowed(shape.id, color.id)) vectors.push({ shape: shape.id, color: color.id, size, theme });
      vectors.push({ shape: shape.id, color: 'blank', size, theme });
    }
    vectors.push({ color: 'charcoal', size, theme });
  }
  for (const theme of ['light', 'dark'] as const) for (const size of [16, 32, 64, 96]) for (const { status } of getCharacterStatuses()) {
    for (const shape of getOneShapes()) vectors.push({ shape: shape.id, size, theme, state: { status } });
    vectors.push({ color: 'charcoal', size, theme, state: { status } });
  }
  vectors.push({ did: 'did:oas:openagent:agent:character-vector', size: 48 });
  return vectors;
}
const BASE_VECTORS_SHA256 = 'b05ff4dac79a90ff7adcce5405de46fe30ecb2eb400b5856f344bde329d82078';
// The design sheet's check (Build-Scratch/design-avatars-20261115/base-sdk-0.8.x.sha256): the fourteen heads at 96 px in their own colour.
const BASE_SHEET_SHA256 = 'e0a20d984b439973ef73e5600e70884ff8c8946568c23c9b994173eb65c0edfa';

describe('no regression: today\'s heads', () => {
  const vectors = baseVectors();

  it('renders every existing vector exactly as 0.8.x did', () => {
    expect(vectors).toHaveLength(11793);
    expect(sha256(vectors.map(options => renderOne(options)).join('\n'))).toBe(BASE_VECTORS_SHA256);
    expect(sha256(getOneShapes().map(shape => renderOne({ shape: shape.id, color: shape.color, size: 96 })).join('\n'))).toBe(BASE_SHEET_SHA256);
  });

  it('draws today\'s options through renderOneAvatar byte for byte, with framing head explicit or implied', () => {
    expect(sha256(vectors.map(options => renderOneAvatar(options)).join('\n'))).toBe(BASE_VECTORS_SHA256);
    for (const options of vectors.filter((_, i) => i % 97 === 0)) {
      expect(renderOneAvatar({ ...options, framing: 'head', eye: 'neutral', headwear: null, glasses: false })).toBe(renderOne(options));
    }
  });

  it('keeps the DID defaults on the first fourteen heads and eighteen colours', () => {
    const first = new Set<string>(getOneShapes().map(shape => shape.id)), colors = new Set<string>(getOneColors().map(color => color.id));
    for (let i = 0; i < 300; i++) {
      const look = oneLookForDid(`did:oas:openagent:agent:figure-${i}`);
      expect(first.has(look.shape) && colors.has(look.color)).toBe(true);
    }
  });

  it('lets a reader that knows only shape and colour draw a stored look with headwear as the bare head', () => {
    const stored = parseOneAvatarLook({ shape: 'squircle', color: 'indigo', headwear: 'cap', glasses: true });
    expect(renderOne({ shape: stored.shape as 'squircle', color: stored.color as 'indigo', size: 32 })).toBe(renderOneAvatar({ shape: 'squircle', color: 'indigo', size: 32 }));
  });
});

describe('the catalog', () => {
  it('lists twenty-four heads and twenty-three colours, today\'s first and unchanged', () => {
    const shapes = getOneAvatarShapes(), colors = getOneAvatarColors();
    expect(shapes).toHaveLength(24);
    expect(colors).toHaveLength(23);
    expect(shapes.slice(0, 14).map(s => [s.id, s.path, s.eye])).toEqual(getOneShapes().map(s => [s.id, s.path, s.eye]));
    expect(colors.slice(0, 18).map(c => [c.id, c.disc, c.eye, c.keyline])).toEqual(getOneColors().map(c => [c.id, c.disc, c.eye, c.keyline]));
    expect(shapes.slice(14).map(s => s.id)).toEqual(['capsule', 'chip', 'scallop', 'leaf', 'house', 'mushroom', 'ghost', 'tulip', 'bell', 'cat']);
    expect(new Set(ONE_AVATAR_SHAPE_ORDER).size).toBe(24);
  });

  it('draws every new head as one valid closed belt inside the head box', () => {
    for (const shape of getOneAvatarShapes().slice(14)) {
      expect(() => oneOutlineSegments(shape.path)).not.toThrow();
      for (const [x, y] of oneFlattenPath(shape.path)) {
        expect(Math.abs(x)).toBeLessThanOrEqual(100.01);
        expect(Math.abs(y)).toBeLessThanOrEqual(100.01);
      }
    }
  });

  it('refuses never pairs, including the warm colours that would make a sign', () => {
    expect(isOneAvatarColorAllowed('star', 'tomato')).toBe(false);
    expect(isOneAvatarColorAllowed('droplet', 'tomato')).toBe(false);
    expect(isOneAvatarColorAllowed('diamond', 'sunny')).toBe(false);
    expect(isOneAvatarColorAllowed('star', 'cherry')).toBe(false);
    expect(isOneAvatarColorAllowed('cat', 'tomato')).toBe(true);
    expect(() => renderOneAvatar({ shape: 'star', color: 'tomato', size: 32 })).toThrow(/never/);
    expect(() => parseOneAvatarLook({ shape: 'flower', color: 'cherry', headwear: 'beanie' })).toThrow(/never wears/);
    expect(() => parseOneAvatarLook({ shape: 'flower', color: 'cherry', limbs: true })).toThrow(/Invalid/);
  });
});

describe('16 px distinctness (MUST-AV2-C2)', () => {
  const circle = coverage([oneFlattenPath('M0 -100A100 100 0 0 1 0 100A100 100 0 0 1 0 -100Z')]);
  const cache = new Map<string, Float64Array>();
  const of = (shape: OneAvatarShape, item: OneHeadwear | 'glasses' | null): Float64Array => {
    const key = `${shape}|${item}`;
    let value = cache.get(key);
    if (!value) cache.set(key, value = coverage(oneAvatarSilhouetteOf(shape, item === 'glasses' ? null : item, item === 'glasses')));
    return value;
  };
  const first = getOneShapes().map(s => s.id as OneAvatarShape), all = getOneAvatarShapes().map(s => s.id);

  it('takes the floor from today\'s closest pair', () => {
    let floor = Infinity;
    for (let i = 0; i < first.length; i++) {
      floor = Math.min(floor, difference(of(first[i]!, null), circle));
      for (let j = i + 1; j < first.length; j++) floor = Math.min(floor, difference(of(first[i]!, null), of(first[j]!, null)));
    }
    expect(floor).toBeCloseTo(ONE_DISTINCT_FLOOR_16PX, 6);
  });

  it('keeps every pair of the twenty-four bare heads and Digital One at or above the floor', () => {
    for (let i = 0; i < all.length; i++) {
      expect(difference(of(all[i]!, null), circle)).toBeGreaterThanOrEqual(ONE_DISTINCT_FLOOR_16PX);
      for (let j = i + 1; j < all.length; j++) expect(difference(of(all[i]!, null), of(all[j]!, null)), `${all[i]} ${all[j]}`).toBeGreaterThanOrEqual(ONE_DISTINCT_FLOOR_16PX);
    }
  });

  it('orders the new heads by their worst-case difference from Digital One and every earlier head', () => {
    const placed = [circle, ...first.map(id => of(id, null))];
    let rest = all.slice(14);
    const order: OneAvatarShape[] = [];
    while (rest.length) {
      let best = -1, pick = rest[0]!;
      for (const id of rest) { const worst = Math.min(...placed.map(p => difference(of(id, null), p))); if (worst > best + 1e-9) { best = worst; pick = id; } }
      order.push(pick); placed.push(of(pick, null)); rest = rest.filter(id => id !== pick);
    }
    expect(ONE_AVATAR_SHAPE_ORDER.slice(14)).toEqual(order);
  });

  it('derives the headwear never list, and every offered pair clears the floor against every other head', () => {
    const accepted: { shape: string; grid: Float64Array }[] = [{ shape: 'circle', grid: circle }, ...ONE_AVATAR_SHAPE_ORDER.map(shape => ({ shape, grid: of(shape, null) }))];
    const never: Record<string, string[]> = {};
    for (const item of [...ONE_HEADWEAR, 'glasses'] as const) for (const shape of ONE_AVATAR_SHAPE_ORDER) {
      const grid = of(shape, item);
      const worst = Math.min(...accepted.filter(a => a.shape !== shape).map(a => difference(grid, a.grid)));
      if (worst >= ONE_DISTINCT_FLOOR_16PX) accepted.push({ shape, grid }); else (never[shape] ??= []).push(item);
    }
    expect(never).toEqual(Object.fromEntries(Object.entries(ONE_HEADWEAR_NEVER).map(([k, v]) => [k, [...v!]])));
    for (let i = 0; i < accepted.length; i++) for (let j = i + 1; j < accepted.length; j++) {
      if (accepted[i]!.shape !== accepted[j]!.shape) expect(difference(accepted[i]!.grid, accepted[j]!.grid)).toBeGreaterThanOrEqual(ONE_DISTINCT_FLOOR_16PX);
    }
    for (const shape of all) expect(isOneHeadwearAllowed(shape, null)).toBe(true);
  });
});

describe('headwear fits each head', () => {
  const offered = getOneAvatarShapes().flatMap(shape => ONE_HEADWEAR.filter(item => isOneHeadwearAllowed(shape.id, item)).map(item => [shape.id, item] as const));
  const inside = (poly: readonly (readonly [number, number])[], x: number, y: number): boolean => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  };

  it('never shows the background between a hat and the head (MUST-AV2-C1)', () => {
    for (const [shape, item] of offered.filter(([, item]) => item === 'beanie' || item === 'cap')) {
      const [head, ...parts] = oneAvatarSilhouetteOf(shape, item, false);
      const xs = parts[0]!.map(p => p[0]), x0 = Math.min(...xs) + 6, x1 = Math.max(...xs) - 6;
      for (let x = x0; x <= x1; x += 2) {
        // Down the column: the lowest hat row above the head must touch the head's first row.
        let lastHat = -Infinity, headTop = Infinity;
        for (let y = -100; y <= 100; y += 0.5) {
          if (inside(head!, x, y)) { headTop = y; break; }
          if (parts.some(part => inside(part, x, y))) lastHat = y;
        }
        if (lastHat > -Infinity && headTop < Infinity) expect(headTop - lastHat, `${shape} ${item} at x=${x}`).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('gives beanies and caps their own single soft dome, never the head\'s point (MUST-AV2-C3)', () => {
    for (const [shape, item] of offered.filter(([, item]) => item === 'beanie' || item === 'cap')) {
      const top = oneAvatarSilhouetteOf(shape, item, false)[1]!.slice(0, 33).map(p => p[1]);
      const peak = top.indexOf(Math.min(...top));
      for (let i = 1; i <= peak; i++) expect(top[i]!, `${shape} ${item}`).toBeLessThanOrEqual(top[i - 1]! + 1e-6);
      for (let i = peak + 1; i < top.length; i++) expect(top[i]!, `${shape} ${item}`).toBeGreaterThanOrEqual(top[i - 1]! - 1e-6);
    }
  });

  it('fits every head with headwear inside today\'s square, so no layout moves', () => {
    for (const [shape, item] of offered) for (const glasses of [false, true]) {
      for (const poly of oneAvatarSilhouette({ shape, color: getOneAvatarShapes().find(s => s.id === shape)!.color, headwear: item, glasses })) {
        for (const [x, y] of poly) { expect(Math.abs(x)).toBeLessThanOrEqual(100.01); expect(Math.abs(y)).toBeLessThanOrEqual(100.01); }
      }
    }
  });
});

describe('framing', () => {
  it('exports head-only renders at every app avatar size for any look, with no limbs', () => {
    const looks: OneAvatarLook[] = [
      { shape: 'cat', color: 'cream', headwear: 'bow', glasses: true },
      { shape: 'mushroom', color: 'sunny', headwear: 'beanie' },
      { shape: 'squircle', color: 'indigo', headwear: 'headset' },
      { shape: 'ghost', color: 'deepblue' },
    ];
    for (const look of looks) for (const eye of ONE_EYE_POSES) for (const theme of ['light', 'dark'] as const) {
      const renders = renderOneAvatarSizes({ ...look, eye, theme, label: 'Scout' });
      expect([...renders.keys()]).toEqual([...ONE_APP_AVATAR_SIZES]);
      for (const [size, svg] of renders) {
        expect(svg).toContain(`viewBox="-100 -100 200 200" width="${size}" height="${size}"`);
        expect(svg).not.toContain('data-one-limbs');
        expect(svg).toContain('aria-label="Scout"');
        expect(svg).not.toMatch(/NaN|undefined|Infinity/);
      }
    }
    expect(() => renderOneAvatarSizes({ shape: 'cat', framing: 'figure' } as never)).toThrow(/head framing/);
  });

  it('adds the same limbs to every character only in figure framing', () => {
    for (const motion of ONE_FIGURE_MOTIONS) {
      const svg = renderOneAvatar({ shape: 'bell', color: 'deepblue', size: 160, framing: 'figure', motion });
      expect(svg).toContain('viewBox="-130 -110 260 330" width="208" height="264"');
      expect(svg).toContain(`data-one-motion="${motion}"`);
      expect(svg).toContain('data-one-limbs="true"');
      expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    }
    // Limbs are uniform: the same four ink strokes and two shoes on every head; only the anchors come from the head's outline.
    for (const shape of getOneAvatarShapes()) {
      const svg = renderOneAvatar({ shape: shape.id, size: 96, framing: 'figure', motion: 'stand' });
      expect(svg.match(/fill="none" stroke="#141b16" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"\/>/g)).toHaveLength(4);
      expect(svg.match(/<ellipse cx="6" cy="[\d.]+" rx="15" ry="9" fill="#141b16"\/>/g)).toHaveLength(2);
    }
  });

  it('keeps Digital One plain: figure framing yes, accessories and eye poses no', () => {
    expect(renderOneAvatar({ color: 'charcoal', size: 64 })).toBe(renderOne({ color: 'charcoal', size: 64 }));
    expect(renderOneAvatar({ color: 'charcoal', size: 96, framing: 'figure' })).toContain('data-one-limbs');
    expect(() => renderOneAvatar({ color: 'charcoal', size: 64, headwear: 'cap' })).toThrow(/Digital One/);
    expect(() => renderOneAvatar({ color: 'charcoal', size: 64, eye: 'happy' })).toThrow(/Digital One/);
    expect(() => renderOneAvatar({ shape: 'cat', size: 64, motion: 'walk' })).toThrow(/figure framing/);
  });

  it('draws each eye pose differently, as one line except wide', () => {
    const svgs = ONE_EYE_POSES.map(eye => renderOneAvatar({ shape: 'ghost', size: 96, eye }));
    expect(new Set(svgs).size).toBe(ONE_EYE_POSES.length);
    expect((svgs[ONE_EYE_POSES.indexOf('wide')]!.match(/data-one-eye="true"/g) ?? []).length).toBe(2);
    for (const eye of ONE_EYE_POSES.filter(e => e !== 'wide')) expect((svgs[ONE_EYE_POSES.indexOf(eye)]!.match(/data-one-eye="true"/g) ?? []).length).toBe(1);
  });
});

describe('the distinct-combo picker', () => {
  const team = (n: number): OneAvatarLook[] => { const held: OneAvatarLook[] = []; for (let i = 0; i < n; i++) held.push(nextOneAvatar(held)); return held; };

  it('gives fifty-six agents fifty-six different looks, every head once before any repeats', () => {
    const held = team(56);
    expect(new Set(held.map(l => `${l.shape}|${l.color}|${l.headwear}|${l.glasses}`)).size).toBe(56);
    expect(new Set(held.slice(0, 24).map(l => l.shape)).size).toBe(24);
    expect(held[0]).toEqual({ shape: 'droplet', color: 'sky', headwear: null, glasses: false });
    for (const look of held) expect(() => parseOneAvatarLook(look)).not.toThrow();
  });

  it('keeps agents that share a head apart in colour under normal, protan and deutan vision (SHOULD-AV2-S1)', () => {
    const held = team(72);
    for (let i = 0; i < held.length; i++) for (let j = i + 1; j < held.length; j++) {
      if (held[i]!.shape === held[j]!.shape) expect(oneColorDistance(held[i]!.color, held[j]!.color)).toBeGreaterThanOrEqual(ONE_COLOR_FLOOR);
    }
  });

  it('adds headwear only when a head and colour are already held together', () => {
    const look = nextOneAvatar(Array.from({ length: 24 }, () => ({ shape: 'squircle' as const, color: 'indigo' as const })));
    expect(look.shape).not.toBe('squircle');
    const crowded = Array.from(ONE_AVATAR_SHAPE_ORDER, shape => ({ shape, color: getOneAvatarShapes().find(s => s.id === shape)!.color }));
    const next = nextOneAvatar(crowded);
    expect(next.headwear).toBeNull();
    expect(() => nextOneAvatar([{ shape: 'star', color: 'tomato' } as OneAvatarLook])).toThrow(/never/);
    expect(() => nextOneAvatar(null as never)).toThrow(/iterable/);
  });
});

describe('motion', () => {
  it('maps live states to figure motions and exports the numbers for native renderers', () => {
    expect(oneFigureMotionFor('working')).toBe('walk');
    expect(oneFigureMotionFor('listening')).toBe('lean');
    expect(oneFigureMotionFor('success')).toBe('hop');
    expect(oneFigureMotionFor('idle')).toBe('sit');
    expect(oneFigureMotionFor('paused')).toBe('doze');
    expect(Object.keys(ONE_FIGURE_MOTION).sort()).toEqual([...ONE_FIGURE_MOTIONS].sort());
  });

  it('animates figures only, pauses offscreen and stays still under reduced motion (AV-C2)', () => {
    const css = oneFigureCss();
    expect(css).toContain('@media (prefers-reduced-motion:reduce){[data-one-figure] *{animation:none!important}}');
    expect(css).toContain('[data-one-figure][data-one-paused] *{animation-play-state:paused!important}');
    expect(css).toContain('[data-one-figure][data-one-still] *{animation:none!important}');
    for (const rule of css.split('}')) if (rule.includes('animation:one-')) expect(rule.startsWith('[data-one-figure]') || rule.includes(',[data-one-figure]')).toBe(true);
  });

  it('needs a browser element to mount', () => {
    expect(() => mountOneAvatar(null as never, { shape: 'cat' })).toThrow(/browser element/);
  });
});
