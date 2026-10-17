import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { blake3 } from '@noble/hashes/blake3';
import { describe, expect, it } from 'vitest';
import * as eye from '../src/agent-eye.js';
import { createCharacterAnimator } from '../src/character-animation.js';
import {
  ONE_BLANK_SHAPE, ONE_KINDS, ONE_NEUTRAL, getOneColors, getOneShapes, isOneColor, isOneColorAllowed, isOneKind, isOneShape,
  levelTilt, limitPose, nextOneLook, oneColorForDid, oneEyeOutline, oneFaceFor, oneFrame, oneGeometry, oneHeldPose, oneInsetPath,
  oneKeylineWidth, oneLookForDid, oneOutlineSegments, onePaint, oneRimWidth, oneShapeForDid, oneShapeGeometry, oneShapeId, oneTemperament, oneTier, oneShapeInsetPath,
  type OneColor, type OneFace, type OneKind, type OneLook, type OneLookHolder, type OnePose, type OneShape,
} from '../src/character-one.js';
import { ONE_CIRCLE, ONE_COLORS, ONE_DIGITAL, ONE_SHAPES, ONE_SHAPE_ORDER } from '../src/character-one-shapes.js';
import { mountOne, renderOne } from '../src/one.js';
import { OneMotion, seededRandom, type OneMomentName } from '../src/character-one-motion.js';
import { getCharacterExpressions, getCharacterStatuses } from '../src/character-state.js';
import { agentAvatar } from '../src/glyph.js';
import { generateCharacter, getCharacterSkins, parseCharacterAppearance, type CharacterOptions } from '../src/characters.js';

// The byte-identical master contributed by JR (see test/fixtures/agent-eye/PROVENANCE.md).
const masterUrl = new URL('./fixtures/agent-eye/agent-eye.js', import.meta.url);
const MASTER_SHA256 = '83cc379a706b86899c56b41813030a721110071dbcd11274ebdc146a40b8bba4';
const master = await import(masterUrl.href) as typeof eye & {
  poseToFrame(pose: object): Record<string, number>;
  sampleCurve(curve: readonly unknown[], t: number): number;
};

// The Ones' shape library and agent palette, pinned (see test/fixtures/ones-shapes/PROVENANCE.md).
const SHAPES_SHA256 = '894f801c251f54c113adc2c4b7be9dc3bd5574f536897653330456475a8c1767';
const PALETTE_SHA256 = '76fa20166a4d4ed22021b49e418dd4d8cf8a8c2c30c1b0daa7f4e49eae76c991';
const shapesBytes = readFileSync(new URL('./fixtures/ones-shapes/shapes.json', import.meta.url));
const paletteBytes = readFileSync(new URL('./fixtures/ones-shapes/palette.json', import.meta.url));
interface LibraryShape {
  id: OneShape; label: string; d: string; eye: typeof ONE_CIRCLE.eye; mouthDy: number; pivot: { x: number; y: number };
  temperament: string; colour: OneColor; never: OneColor[];
}
const library = JSON.parse(shapesBytes.toString('utf8')) as {
  schema: string; eyeRule: { scale: number; margin: number; openScaleFloor: number; lookGainFloor: number; mouthFloor: number };
  digitalOne: LibraryShape & { id: 'circle'; colour: null }; shapes: LibraryShape[];
};
const palette = JSON.parse(paletteBytes.toString('utf8')) as {
  schema: string; order: OneColor[]; gates: Record<string, number> & { prefix: Record<string, number> };
  surfaces: { light: Record<string, string>; dark: Record<string, string> }; eyes: { paper: string; ink: string };
  references: { amber: string; amberSoft: string; needsYou: { light: string; dark: string }; danger: { light: string; dark: string }; google: Record<string, string> };
  digitalOne: { disc: string; eye: { light: string; dark: string }; rim: { colour: string; opacity: number; widthPx: number; surfaces: string }; rimHex: string };
  colours: { id: OneColor; label: string; hex: string; eyeHex: string; keyline: string | null }[];
};

const did = 'did:oas:openagent:agent:character-vector';
const shapeOrder: readonly OneShape[] = ['star', 'heart', 'flower', 'cloud', 'droplet', 'squircle', 'diamond', 'clover', 'gumdrop', 'hexagon', 'egg', 'blob', 'peanut', 'bean'];
const teamOrder: readonly OneColor[] = ['berry', 'lime', 'blush', 'jade', 'periwinkle', 'cherry', 'indigo', 'mint', 'bubblegum', 'apricot', 'sky', 'lemon', 'grape', 'lavender', 'watermelon', 'lagoon', 'orchid', 'aqua'];
const row = { x: 0.4, y: 0.1 } as const;
const DEG = Math.PI / 180;
const MARGIN = 10;
/** A shape in its own colour, as the site draws it; Digital One is charcoal. */
const look = (kind: OneKind): { shape: OneKind; color?: OneColor } => kind === 'charcoal' ? { shape: kind } : { shape: kind, color: getOneShapes().find(entry => entry.id === kind)!.color };
const kinds: readonly OneKind[] = ONE_KINDS;
/** One kind per temperament for the motion checks: Drop quick, Star bouncy, Square neat, Cloud slow, Digital One dry. */
const byTemperament = { quick: 'droplet', bouncy: 'star', neat: 'squircle', slow: 'cloud', dry: 'charcoal' } as const;

// ── colour science for the palette gates (WCAG 2.x, CIEDE2000, Machado 2009 severity 1.0) ─────────
const rgb = (hex: string): number[] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const linear = (v: number): number => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const gamma = (v: number): number => v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
const luminance = (hex: string): number => { const [r, g, b] = rgb(hex).map(linear) as [number, number, number]; return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: string, b: string): number => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number]; return (x + 0.05) / (y + 0.05); };
const toHex = (values: number[]): string => '#' + values.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
function lab(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map(linear) as [number, number, number];
  const X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b, Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b, Z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const f = (t: number): number => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  const [fx, fy, fz] = [X / 0.95047, Y, Z / 1.08883].map(f) as [number, number, number];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function de2000([L1, a1, b1]: number[], [L2, a2, b2]: number[]): number {
  const rad = DEG, deg = 1 / DEG;
  const C1 = Math.hypot(a1!, b1!), C2 = Math.hypot(a2!, b2!), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1!, a2p = (1 + G) * a2!;
  const C1p = Math.hypot(a1p, b1!), C2p = Math.hypot(a2p, b2!);
  const h = (a: number, b: number): number => { const v = Math.atan2(b, a) * deg; return v < 0 ? v + 360 : v; };
  const h1p = h(a1p, b1!), h2p = h(a2p, b2!);
  const dLp = L2! - L1!, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp / 2 * rad);
  const Lbp = (L1! + L2!) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) { if (Math.abs(h1p - h2p) > 180) hbp += h1p + h2p < 360 ? 360 : -360; hbp /= 2; }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + 0.015 * (Lbp - 50) ** 2 / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}
const deficiency: Record<string, number[][]> = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
function simulate(hex: string, condition: string): string {
  if (condition === 'normal') return hex;
  const value = rgb(hex).map(linear);
  return toHex(deficiency[condition]!.map(m => gamma(Math.min(1, Math.max(0, m[0]! * value[0]! + m[1]! * value[1]! + m[2]! * value[2]!)))));
}
const distance = (a: string, b: string, condition = 'normal'): number => de2000(lab(simulate(a, condition)), lab(simulate(b, condition)));
const surfaces = { light: Object.values(palette.surfaces.light), dark: Object.values(palette.surfaces.dark) };

// ── containment in a shape: the eye as drawn against the exact outline of arcs and lines ─────────
type Point = readonly [number, number];
type Segment = ReturnType<typeof oneOutlineSegments>[number];
function arcSweep(segment: Extract<Segment, { type: 'A' }>): { start: number; sweep: number } {
  const start = Math.atan2(segment.from[1] - segment.centre[1], segment.from[0] - segment.centre[0]);
  const end = Math.atan2(segment.to[1] - segment.centre[1], segment.to[0] - segment.centre[0]);
  let sweep = end - start;
  if (segment.sweep === 1) { while (sweep < 0) sweep += 2 * Math.PI; } else { while (sweep > 0) sweep -= 2 * Math.PI; }
  return { start, sweep };
}
function distanceToSegment(p: Point, segment: Segment): number {
  if (segment.type === 'L') {
    const dx = segment.to[0] - segment.from[0], dy = segment.to[1] - segment.from[1];
    const t = Math.max(0, Math.min(1, ((p[0] - segment.from[0]) * dx + (p[1] - segment.from[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p[0] - segment.from[0] - t * dx, p[1] - segment.from[1] - t * dy);
  }
  const { start, sweep } = arcSweep(segment);
  let rel = Math.atan2(p[1] - segment.centre[1], p[0] - segment.centre[0]) - start;
  if (segment.sweep === 1) { while (rel < 0) rel += 2 * Math.PI; } else { while (rel > 0) rel -= 2 * Math.PI; }
  if (Math.abs(rel) <= Math.abs(sweep)) return Math.abs(Math.hypot(p[0] - segment.centre[0], p[1] - segment.centre[1]) - segment.r);
  return Math.min(Math.hypot(p[0] - segment.from[0], p[1] - segment.from[1]), Math.hypot(p[0] - segment.to[0], p[1] - segment.to[1]));
}
function polygon(segments: readonly Segment[]): Point[] {
  const points: Point[] = [];
  for (const segment of segments) {
    if (segment.type === 'L') { points.push(segment.from); continue; }
    const { start, sweep } = arcSweep(segment);
    const n = Math.max(4, Math.ceil(Math.abs(sweep) * segment.r / 2));
    for (let i = 0; i < n; i++) { const a = start + sweep * i / n; points.push([segment.centre[0] + segment.r * Math.cos(a), segment.centre[1] + segment.r * Math.sin(a)]); }
  }
  return points;
}
function inside(p: Point, poly: readonly Point[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const outlines = new Map<OneKind, { segments: readonly Segment[]; polygon: Point[] }>(kinds.map(kind => {
  const segments = oneOutlineSegments(oneShapeGeometry(kind).path);
  return [kind, { segments, polygon: polygon(segments) }];
}));
/** The exact signed distance from a point to a kind's outline: positive inside, negative outside. */
const edgeDistance = (kind: OneKind, p: Point): number => {
  const { segments, polygon: poly } = outlines.get(kind)!;
  let d = Infinity;
  for (const segment of segments) d = Math.min(d, distanceToSegment(p, segment));
  return inside(p, poly) ? d : -d;
};
// A signed-distance grid at one unit per kind. The distance field is 1-Lipschitz, so a cell's value less half its
// diagonal bounds the distance of any point in the cell from below: the exact distance is computed only near the margin.
const HALF = 110, STEP = 1, CELLS = 2 * HALF / STEP + 1, SLACK = Math.SQRT1_2 * STEP;
const fields = new Map<OneKind, Float64Array>();
function field(kind: OneKind): Float64Array {
  let values = fields.get(kind);
  if (values) return values;
  values = new Float64Array(CELLS * CELLS);
  for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) values[j * CELLS + i] = edgeDistance(kind, [-HALF + i * STEP, -HALF + j * STEP]);
  fields.set(kind, values);
  return values;
}
/** How far a disc of radius `r` at `p` is inside a kind's outline, exactly when it is within a unit of `floor`, else a bound at or above it. */
function discClearance(kind: OneKind, p: Point, r: number, floor: number): number {
  const i = Math.round((p[0] + HALF) / STEP), j = Math.round((p[1] + HALF) / STEP);
  if (i >= 0 && j >= 0 && i < CELLS && j < CELLS) {
    const bound = field(kind)[j * CELLS + i]! - SLACK - r;
    if (bound >= floor) return bound;
  }
  return edgeDistance(kind, p) - r;
}
/** agent-eye's own containment sampling (the master's tools/build.mjs check): the stroked bar's outline, in eye-box units. */
function eyeOutline(frame: eye.AgentEyeFrame): { r: number; points: [number, number][] } {
  const { r, a, b } = eye.barShape(frame);
  const k = frame.k, c = Math.cos(frame.tilt * DEG), s = Math.sin(frame.tilt * DEG);
  const quad = (p0: number, p1: number, p2: number, t: number): number => p0 * (1 - t) ** 2 + 2 * p1 * t * (1 - t) + p2 * t * t;
  const local: [number, number][] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    local.push([-a - k + 2 * a * t, -b], [-a - k + 2 * a * t, b]);
    local.push([quad(a - k, a + k, a - k, t), quad(-b, 0, b, t)], [quad(-a - k, -a + k, -a - k, t), quad(-b, 0, b, t)]);
  }
  return { r, points: local.map(([px, py]) => [frame.x + px * c - py * s, frame.y + px * s + py * c]) };
}
/**
 * How far the drawn eye and smile line stay inside a kind's shape, as the SDK draws them (the shape's limits, its
 * level wide eye and its eye placement applied): the smallest clearance in head units, and the smile line's gap to
 * the eye in eye-box units. For the circle, agent-eye's own safe radius is the edge.
 */
function contained(pose: OnePose, kind: OneKind, blink = 1): { clearance: number; gap: number } {
  const geometry = oneShapeGeometry(kind);
  const frame = oneFrame(pose, blink, kind);
  const outline = eyeOutline(frame);
  const place = ([x, y]: readonly [number, number]): Point => [geometry.eye.x + geometry.eye.scale * x, geometry.eye.y + geometry.eye.scale * y];
  const solids: { p: Point; r: number }[] = outline.points.map(p => ({ p: place(p), r: outline.r * geometry.eye.scale }));
  let gap = Infinity;
  if (frame.mo > 0.01) {
    const corner = eye.GEOMETRY.cornerRadius;
    const ix = frame.ma - corner, iy = frame.mt / 2 - corner, my = frame.my + geometry.mouthDy;
    for (const [i, j] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) solids.push({ p: place([frame.mx + i * ix, my + j * iy]), r: corner * geometry.eye.scale });
    for (let i = 0; i <= 32; i++) {
      const px = frame.mx - frame.ma + 2 * frame.ma * i / 32, py = my - frame.mt / 2;
      for (const [ex, ey] of outline.points) gap = Math.min(gap, Math.hypot(px - ex, py - ey) - outline.r);
    }
  }
  let clearance = Infinity;
  if (kind === 'charcoal') {
    for (const { p, r } of solids) clearance = Math.min(clearance, eye.MOTION.safeRadius - Math.hypot(p[0], p[1]) - r);
  } else {
    // Consecutive samples are a few units apart and the belt is never thinner than twice the margin, so every sample
    // at least the margin inside the edge (a signed distance: outside is negative) means the whole outline is inside.
    for (const { p, r } of solids) clearance = Math.min(clearance, discClearance(kind, p, r, MARGIN));
  }
  return { clearance, gap };
}

const faces: readonly OneFace[] = ['idle', 'listening', 'thinking', 'working', 'typing', 'speaking', 'done', 'attention',
  'waiting', 'paused', 'offline', 'error', ...getCharacterExpressions()];
const moments: readonly OneMomentName[] = ['settle', 'home', 'psst', 'aha', 'smile', 'nod', 'dizzy', 'dozeOff', 'wake', 'read', 'ponder', 'keys', 'wave', 'firstBlink',
  'lookAtYou', 'shrug', 'popIn'];
const sizes = [16, 24, 44, 96] as const;

describe('agent-eye port', () => {
  it('pins the contributed master byte for byte', () => {
    const bytes = readFileSync(masterUrl);
    expect(bytes.byteLength).toBe(43948);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(MASTER_SHA256);
  });

  it('matches the master geometry, mouth, path and constants across a grid of poses', () => {
    expect({ ...eye.GEOMETRY }).toEqual({ ...master.GEOMETRY });
    expect({ ...eye.MOTION }).toEqual({ ...master.MOTION });
    expect({ ...eye.MOUTH }).toEqual({ ...master.MOUTH });
    for (const look of [-1, -0.55, -0.1, 0, 0.3, 0.9, 1]) for (const lift of [-1, -0.45, 0, 0.4, 1]) {
      for (const open of [0, 0.42, 0.72, 1, 1.15]) for (const tilt of [-16, 0, 12]) for (const smile of [0, 0.35, 1, 1.12]) {
        const pose = { look, lift, open, tilt, smile, mouth: smile ? 1 : 0 };
        const ours = eye.poseToFrame(pose);
        const theirs = master.poseToFrame(pose);
        for (const key of ['x', 'y', 'w', 'h', 'k', 'tilt', 'mx', 'my', 'ma', 'mt', 'mo'] as const) expect(ours[key]).toBe(theirs[key]);
        expect(eye.barPath(eye.barShape(ours).n)).toBe(master.barPath(master.barShape(theirs as never).n));
      }
    }
  });

  it('matches the master eases, blink and smile curves', () => {
    for (const [name, values] of Object.entries(master.EASE)) {
      expect(eye.EASE[name as keyof typeof eye.EASE]).toEqual(values);
      const ours = eye.cubicBezier(...(values as [number, number, number, number]));
      const theirs = master.cubicBezier(...(values as [number, number, number, number]));
      for (let x = 0; x <= 1; x += 0.05) expect(ours(x)).toBe(theirs(x));
    }
    expect(eye.BLINK).toEqual(master.BLINK);
    expect(eye.SMILE).toEqual({ ...master.SMILE });
  });
});

describe('the shape library', () => {
  it('pins the library and the palette byte for byte', () => {
    expect(shapesBytes.byteLength).toBe(40863);
    expect(createHash('sha256').update(shapesBytes).digest('hex')).toBe(SHAPES_SHA256);
    expect(paletteBytes.byteLength).toBe(21489);
    expect(createHash('sha256').update(paletteBytes).digest('hex')).toBe(PALETTE_SHA256);
    expect(library.schema).toBe('life/ones-shapes/v2');
    expect(palette.schema).toBe('life/ones-agent-palette/v1');
  });

  it('carries the fourteen shapes exactly as the library draws them, in library order', () => {
    expect(getOneShapes()).toBe(ONE_SHAPES);
    expect(getOneShapes().map(shape => shape.id)).toEqual(shapeOrder);
    expect(library.shapes.map(shape => shape.id)).toEqual(shapeOrder);
    for (const [index, shape] of getOneShapes().entries()) {
      const source = library.shapes[index]!;
      expect(shape).toEqual({ id: source.id, label: source.label, path: source.d, eye: source.eye, mouthDy: source.mouthDy, pivot: source.pivot,
        temperament: source.temperament, color: source.colour, never: source.never });
      expect(Object.isFrozen(shape)).toBe(true);
      expect(Object.isFrozen(shape.eye)).toBe(true);
      expect(Object.isFrozen(shape.never)).toBe(true);
      // The contract: one closed clockwise subpath of M, H, V, L, A and Z, starting at 12 o'clock on the eye's axis.
      expect(shape.path).toMatch(/^M[-0-9. ]+(?:[HVLA][-0-9. ]+)+Z$/);
      const [mx, my] = shape.path.slice(1).split(/[A-Z]/)[0]!.trim().split(' ').map(Number);
      expect(mx).toBe(shape.eye.x);
      expect(my).toBeLessThan(0);
      const segments = oneOutlineSegments(shape.path);
      expect(segments.length).toBeGreaterThanOrEqual(4);
      for (let i = 0; i < segments.length; i++) {
        const next = segments[(i + 1) % segments.length]!;
        expect(Math.hypot(segments[i]!.to[0] - next.from[0], segments[i]!.to[1] - next.from[1])).toBeLessThan(1e-9);
      }
      // The library's floors: the line at rest at least 0.7 of the mark, look gain at least 0.5, the smile line at least 0.6.
      expect(shape.eye.scale).toBe(library.eyeRule.scale);
      expect(shape.eye.openScale).toBeGreaterThanOrEqual(library.eyeRule.openScaleFloor);
      expect(shape.eye.lookGain).toBeGreaterThanOrEqual(library.eyeRule.lookGainFloor);
      expect(shape.eye.mouthMax).toBeGreaterThanOrEqual(library.eyeRule.mouthFloor);
      expect(shape.eye.openMax).toBeGreaterThanOrEqual(1.04);
    }
    expect(library.eyeRule.margin).toBe(MARGIN);
    expect(getOneShapes().find(shape => shape.id === 'squircle')!.label).toBe('Square');
    expect(getOneShapes().find(shape => shape.id === 'droplet')!.label).toBe('Drop');
    // Four shapes share SpaceX's literals; no colour id collides with a shape id.
    const spacex = getCharacterSkins().find(entry => entry.id === 'spacex')!.shapes;
    expect(shapeOrder.filter(id => spacex.includes(id))).toEqual(['cloud', 'droplet', 'squircle', 'hexagon']);
    expect(teamOrder.some(id => (shapeOrder as readonly string[]).includes(id))).toBe(false);
  });

  it('keeps Digital One the circle: the logo\'s disc, the eye at the centre at full scale, dry', () => {
    expect(ONE_CIRCLE).toEqual({ path: library.digitalOne.d, eye: library.digitalOne.eye, mouthDy: library.digitalOne.mouthDy, pivot: library.digitalOne.pivot });
    expect(ONE_CIRCLE.eye).toEqual({ x: 0, y: 0, scale: 1, openScale: 1, lookGain: 1, liftGain: 1, openMax: 1.35, mouthMax: 1 });
    expect(library.digitalOne.temperament).toBe('dry');
    expect(oneTemperament('charcoal')).toBe('dry');
    expect(oneShapeGeometry('charcoal')).toBe(ONE_CIRCLE);
    expect(oneShapeId('charcoal')).toBe('circle');
    for (const shape of getOneShapes()) {
      expect(oneTemperament(shape.id)).toBe(shape.temperament);
      expect(oneShapeGeometry(shape.id)).toBe(shape);
      expect(oneShapeId(shape.id)).toBe(shape.id);
      // No agent is a circle: every shape's outline differs from the disc.
      expect(shape.path).not.toBe(ONE_CIRCLE.path);
    }
    expect(ONE_KINDS).toEqual([...shapeOrder, 'charcoal']);
    expect(ONE_KINDS).not.toContain('circle');
    expect(() => oneTemperament('circle' as never)).toThrow('Unsupported One shape');
  });

  it('refuses the eleven never pairs everywhere and leaves 241 looks', () => {
    const never: Record<string, OneColor[]> = { star: ['cherry', 'watermelon'], droplet: ['cherry', 'watermelon', 'berry'], diamond: ['lemon', 'lime', 'apricot'],
      gumdrop: ['cherry', 'watermelon'], cloud: ['sky'] };
    let looks = 0;
    for (const shape of getOneShapes()) {
      expect(shape.never).toEqual(never[shape.id] ?? []);
      expect(isOneColorAllowed(shape.id, shape.color)).toBe(true);
      for (const color of teamOrder) if (isOneColorAllowed(shape.id, color)) looks++;
    }
    expect(looks).toBe(14 * 18 - 11);
    expect(isOneColorAllowed('star', 'cherry')).toBe(false);
    expect(isOneColorAllowed('charcoal', 'lemon')).toBe(false);
    expect(isOneColorAllowed('star', 'charcoal')).toBe(false);
    expect(isOneColorAllowed('circle', 'lemon')).toBe(false);
    for (const value of shapeOrder) { expect(isOneShape(value)).toBe(true); expect(isOneKind(value)).toBe(true); expect(isOneColor(value)).toBe(false); }
    for (const value of teamOrder) { expect(isOneColor(value)).toBe(true); expect(isOneShape(value)).toBe(false); expect(isOneKind(value)).toBe(false); }
    expect(isOneKind('charcoal')).toBe(true);
    for (const value of ['blank', 'circle', 'Star', 'blue', 'teal', '', null, 7]) { expect(isOneShape(value)).toBe(false); expect(isOneColor(value)).toBe(false); expect(isOneKind(value)).toBe(false); }
    // Four colours are no shape's default: they come through DID defaults, the team's 15th agent on and the look sheet.
    expect(teamOrder.filter(color => !getOneShapes().some(shape => shape.color === color))).toEqual(['berry', 'lime', 'periwinkle', 'lagoon']);
    expect(new Set(getOneShapes().map(shape => shape.color)).size).toBe(14);
  });

  it('orders the team shapes by distinctness at 16 px', () => {
    expect(ONE_SHAPE_ORDER).toEqual(['droplet', 'cloud', 'heart', 'diamond', 'star', 'bean', 'blob', 'peanut', 'egg', 'gumdrop', 'clover', 'hexagon', 'squircle', 'flower']);
    expect([...ONE_SHAPE_ORDER].sort()).toEqual([...shapeOrder].sort());
    expect(Object.isFrozen(ONE_SHAPE_ORDER)).toBe(true);
  });
});

describe('One palette', () => {
  it('lists the eighteen colours in team order, one value on every surface, with Digital One as the fifteenth kind', () => {
    expect(getOneColors()).toBe(ONE_COLORS);
    expect(getOneColors().map(entry => entry.id)).toEqual(teamOrder);
    expect(palette.order).toEqual(teamOrder);
    expect(getOneColors().map(entry => entry.label)).toEqual(['Berry', 'Lime', 'Blush', 'Jade', 'Periwinkle', 'Cherry', 'Indigo', 'Mint', 'Bubblegum', 'Apricot', 'Sky', 'Lemon', 'Grape', 'Lavender', 'Watermelon', 'Lagoon', 'Orchid', 'Aqua']);
    expect(Object.isFrozen(getOneColors())).toBe(true);
    for (const [index, entry] of getOneColors().entries()) {
      const source = palette.colours[index]!;
      expect(entry).toEqual({ id: source.id, label: source.label, disc: source.hex, eye: source.eyeHex, keyline: source.keyline });
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.keys(entry)).toEqual(['id', 'label', 'disc', 'eye', 'keyline']);
      // The line comes from the disc, never from the surface: paper on the deep colours, ink on the bright ones.
      expect([palette.eyes.paper, palette.eyes.ink]).toContain(entry.eye);
      expect(onePaint(entry.id, 'light')).toEqual({ disc: entry.disc, discOpacity: 1, eye: entry.eye, keyline: entry.keyline, rim: null });
      expect(onePaint(entry.id, 'dark')).toEqual({ disc: entry.disc, discOpacity: 1, eye: entry.eye, keyline: null, rim: null });
    }
    expect(getOneColors().filter(entry => entry.eye === palette.eyes.paper).map(entry => entry.id)).toEqual(['berry', 'jade', 'cherry', 'indigo', 'grape', 'lagoon']);
    expect(ONE_KINDS).toHaveLength(15);
  });

  it('keeps the plan-of-record values for Digital One and the blank head', () => {
    expect(ONE_DIGITAL).toEqual({ disc: '#141b16', eye: { light: null, dark: '#f2f1ea' }, rim: { color: '#f2f1ea', opacity: 0.44, flat: '#767973' } });
    expect(palette.digitalOne).toMatchObject({ disc: '#141b16', eye: { dark: '#f2f1ea' }, rim: { colour: '#f2f1ea', opacity: 0.44, widthPx: 1, surfaces: 'dark only' }, rimHex: '#767973' });
    // Black on both surfaces: the eye cut out on light, chalk with a chalk rim on dark. Never chalk-inverted.
    expect(onePaint('charcoal', 'light')).toEqual({ disc: '#141b16', discOpacity: 1, eye: null, keyline: null, rim: null });
    expect(onePaint('charcoal', 'dark')).toEqual({ disc: '#141b16', discOpacity: 1, eye: '#f2f1ea', keyline: null, rim: { color: '#f2f1ea', opacity: 0.44 } });
    expect(contrast('#f2f1ea', '#141b16')).toBeGreaterThanOrEqual(15);
    for (const surface of surfaces.dark) expect(contrast(ONE_DIGITAL.rim.flat, surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(ONE_DIGITAL.rim.flat, ONE_DIGITAL.disc)).toBeGreaterThanOrEqual(3.9);
    for (const surface of surfaces.light) expect(contrast(ONE_DIGITAL.disc, surface)).toBeGreaterThanOrEqual(14);
    // The rim is one CSS pixel inside the edge, two from 96 px, never reduced to a device pixel (R2); the keyline may be.
    for (const px of [16, 24, 44, 95]) expect(oneRimWidth(px)).toBeCloseTo(200 / px, 6);
    for (const px of [96, 512]) expect(oneRimWidth(px)).toBeCloseTo(400 / px, 6);
    expect(oneKeylineWidth(16, 2)).toBeCloseTo(100 / 16, 6);
    expect(oneRimWidth(16)).toBeCloseTo(200 / 16, 6);
    // A blank head is the surface's ink at 10 % with a muted eye (AVATARS.md §1.1), never a colour and never a shape of its own.
    expect(onePaint('blank', 'light')).toEqual({ disc: '#141b16', discOpacity: 0.1, eye: '#5a6256', keyline: null, rim: null });
    expect(onePaint('blank', 'dark')).toEqual({ disc: '#f2f1ea', discOpacity: 0.1, eye: '#a9b2a2', keyline: null, rim: null });
    expect(ONE_BLANK_SHAPE).toBe('squircle');
    expect(() => onePaint('blue' as never, 'light')).toThrow('Unsupported One colour');
  });

  it('passes the line and silhouette contrast gates on every surface', () => {
    expect(palette.gates).toMatchObject({ eye: 4.5, surfaceLight: 3, surfaceDark: 3 });
    for (const entry of getOneColors()) {
      // The line at 4.5:1 on its disc, so that at 16 px on a 1× screen it still renders at 3:1.
      expect(contrast(entry.eye, entry.disc), entry.id).toBeGreaterThanOrEqual(4.5);
      const silhouette = entry.keyline ?? entry.disc;
      for (const surface of surfaces.light) expect(contrast(silhouette, surface), `${entry.id} on ${surface}`).toBeGreaterThanOrEqual(3);
      // A keyline appears exactly where the disc alone does not reach 3:1 on a light surface, in the colour's own hue.
      expect(entry.keyline !== null, entry.id).toBe(Math.min(...surfaces.light.map(surface => contrast(entry.disc, surface))) < 3);
      for (const surface of surfaces.dark) expect(contrast(entry.disc, surface), `${entry.id} on ${surface}`).toBeGreaterThanOrEqual(3);
    }
    expect(getOneColors().filter(entry => entry.keyline !== null)).toHaveLength(12);
  });

  it('keeps colours apart from One, amber and its glow, needs-you green, danger, Google and each other', () => {
    const { references, gates } = palette;
    expect(gates).toMatchObject({ digitalOne: 25, amber: 18, amberSoft: 12, needsYou: 12, danger: 10, google: 10, normalPair: 10 });
    const google = Object.values(references.google);
    expect(google).toHaveLength(16);
    for (const entry of getOneColors()) {
      expect(distance(entry.disc, ONE_DIGITAL.disc), entry.id).toBeGreaterThanOrEqual(25);
      expect(distance(entry.disc, references.amber), entry.id).toBeGreaterThanOrEqual(18);
      expect(distance(entry.disc, references.amberSoft), entry.id).toBeGreaterThanOrEqual(12);
      expect(distance(entry.disc, references.needsYou.light), entry.id).toBeGreaterThanOrEqual(12);
      expect(distance(entry.disc, references.needsYou.dark), entry.id).toBeGreaterThanOrEqual(12);
      expect(distance(entry.disc, references.danger.light), entry.id).toBeGreaterThanOrEqual(10);
      expect(distance(entry.disc, references.danger.dark), entry.id).toBeGreaterThanOrEqual(10);
      expect(Math.min(...google.map(value => distance(entry.disc, value))), entry.id).toBeGreaterThanOrEqual(10);
      for (const other of getOneColors()) if (other !== entry) expect(distance(entry.disc, other.disc), `${entry.id} and ${other.id}`).toBeGreaterThanOrEqual(10);
    }
  });

  it('gives small teams the most distinct colours under every colour-vision condition, Digital One included', () => {
    const minimum = (n: number): number => {
      let worst = Infinity;
      for (const condition of ['normal', 'protan', 'deutan', 'tritan']) {
        const set = [ONE_DIGITAL.disc, ...getOneColors().slice(0, n).map(entry => entry.disc)];
        for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) worst = Math.min(worst, distance(set[i]!, set[j]!, condition));
      }
      return worst;
    };
    expect(palette.gates.prefix).toEqual({ 5: 15, 8: 10, 12: 4.5 });
    expect(minimum(5)).toBeGreaterThanOrEqual(15);
    expect(minimum(8)).toBeGreaterThanOrEqual(10);
    expect(minimum(12)).toBeGreaterThanOrEqual(4.5);
    // The palette's own measurements (17.37, 10.67 and 4.88), reproduced by the SDK's formulas.
    expect(minimum(5)).toBeCloseTo(17.37, 1);
    expect(minimum(8)).toBeCloseTo(10.67, 1);
    expect(minimum(12)).toBeCloseTo(4.88, 1);
  });
});

describe('One looks', () => {
  it('derives a stable default look from the literal DID and never picks Digital One (the plan\'s vectors)', () => {
    // BLAKE3("oaid-character-v1\0one\0" + DID): bytes 4–7 little-endian modulo 14 index library order for the shape;
    // bytes 0–3 modulo 18 index team order for the colour, stepped past the shape's never colours.
    expect(oneLookForDid(did)).toEqual({ shape: 'flower', color: 'bubblegum' });
    expect(oneLookForDid('did:oas:agent-instance:01ARZ3NDEKTSV4RRFFQ69G5FAV')).toEqual({ shape: 'star', color: 'apricot' });
    expect(oneLookForDid('did:l1fe:agent:character-vector')).toEqual({ shape: 'droplet', color: 'lagoon' });
    expect(oneLookForDid('did:oas:openagent:agent:preview')).toEqual({ shape: 'flower', color: 'blush' });
    // Lime is a never colour for the Diamond: the colour steps forward to Blush.
    expect(oneLookForDid('did:oas:openagent:agent:spread-5')).toEqual({ shape: 'diamond', color: 'blush' });
    expect(Object.isFrozen(oneLookForDid(did))).toBe(true);
    const encoder = new TextEncoder();
    for (let index = 0; index < 64; index++) {
      const identifier = `did:oas:openagent:agent:assign-${index}`;
      const seed = blake3(encoder.encode(`oaid-character-v1\u0000one\u0000${identifier}`));
      const u32 = (offset: number): number => (seed[offset]! | seed[offset + 1]! << 8 | seed[offset + 2]! << 16 | seed[offset + 3]! << 24) >>> 0;
      const shape = shapeOrder[u32(4) % 14]!;
      expect(oneShapeForDid(identifier)).toBe(shape);
      let step = u32(0) % 18;
      while (!isOneColorAllowed(shape, teamOrder[step]!)) step = (step + 1) % 18;
      expect(oneColorForDid(identifier)).toBe(teamOrder[step]);
      expect(oneLookForDid(identifier)).toEqual({ shape, color: teamOrder[step] });
      const character = generateCharacter(identifier, { skin: 'one' });
      expect(character.shape).toBe(shape);
      expect(character.oneColor).toBe(teamOrder[step]);
    }
    const shapes = new Map<string, number>(), colors = new Map<string, number>(), looks = new Set<string>();
    for (let index = 0; index < 3000; index++) {
      const value = oneLookForDid(`did:oas:openagent:agent:spread-${index}`);
      expect(isOneColorAllowed(value.shape, value.color)).toBe(true);
      shapes.set(value.shape, (shapes.get(value.shape) ?? 0) + 1);
      colors.set(value.color, (colors.get(value.color) ?? 0) + 1);
      looks.add(`${value.shape}/${value.color}`);
    }
    expect([...shapes.keys()].sort()).toEqual([...shapeOrder].sort());
    expect([...colors.keys()].sort()).toEqual([...teamOrder].sort());
    for (const count of shapes.values()) expect(count).toBeGreaterThan(150);
    for (const count of colors.values()) expect(count).toBeGreaterThan(90);
    expect(looks.size).toBeGreaterThan(230);
  });

  it('refuses non-agent identities', () => {
    for (const identifier of ['did:oas:openagent:tool:hammer', 'not a did', '', 'did:oas:openagent:agent:<x>']) {
      expect(() => oneShapeForDid(identifier)).toThrow();
      expect(() => oneColorForDid(identifier)).toThrow();
      expect(() => oneLookForDid(identifier)).toThrow();
    }
  });

  it('fills a team with the next free shape in its own colour, then free colours, then the least held (the plan\'s sequence)', () => {
    const held: OneLook[] = [];
    for (let n = 0; n < 18; n++) held.push(nextOneLook(held));
    expect(held).toEqual([
      { shape: 'droplet', color: 'sky' }, { shape: 'cloud', color: 'lavender' }, { shape: 'heart', color: 'bubblegum' }, { shape: 'diamond', color: 'aqua' },
      { shape: 'star', color: 'lemon' }, { shape: 'bean', color: 'grape' }, { shape: 'blob', color: 'mint' }, { shape: 'peanut', color: 'watermelon' },
      { shape: 'egg', color: 'blush' }, { shape: 'gumdrop', color: 'orchid' }, { shape: 'clover', color: 'jade' }, { shape: 'hexagon', color: 'apricot' },
      { shape: 'squircle', color: 'indigo' }, { shape: 'flower', color: 'cherry' },
      { shape: 'droplet', color: 'lime' }, { shape: 'cloud', color: 'berry' }, { shape: 'heart', color: 'periwinkle' }, { shape: 'diamond', color: 'lagoon' },
    ]);
    // The first fourteen are the site's characters: every shape and every default colour, all different.
    expect(new Set(held.slice(0, 14).map(entry => entry.shape)).size).toBe(14);
    expect(new Set(held.map(entry => `${entry.shape}/${entry.color}`)).size).toBe(18);
    for (const entry of held) { expect(isOneColorAllowed(entry.shape, entry.color)).toBe(true); expect(Object.isFrozen(entry)).toBe(true); }
    // Every look's colour is unique up to eighteen agents; the nineteenth repeats the least-held shape and colour.
    expect(new Set(held.map(entry => entry.color)).size).toBe(18);
    expect(nextOneLook(held)).toEqual({ shape: 'star', color: 'berry' });
    // A free shape comes first whatever is held; a held default colour yields to the first free allowed colour in team order.
    expect(nextOneLook([{ shape: 'droplet', color: 'sky' }])).toEqual({ shape: 'cloud', color: 'lavender' });
    expect(nextOneLook([{ shape: 'cloud', color: 'lavender' }])).toEqual({ shape: 'droplet', color: 'sky' });
    // Berry is a never colour for the Drop, so the first free colour it may wear is Lime.
    expect(nextOneLook([{ shape: 'star', color: 'sky' }])).toEqual({ shape: 'droplet', color: 'lime' });
    expect(nextOneLook([{ shape: 'star', color: 'sky' }, { shape: 'egg', color: 'lime' }])).toEqual({ shape: 'droplet', color: 'blush' });
    expect(nextOneLook(new Set<OneLookHolder>([{ shape: 'droplet', color: 'sky' }, { shape: 'cloud', color: 'lavender' }, { shape: 'heart', color: 'bubblegum' }]))).toEqual({ shape: 'diamond', color: 'aqua' });
  });

  it('refuses unknown values, never pairs and malformed holders instead of skipping them', () => {
    const bad: unknown[][] = [[{ shape: 'charcoal', color: 'lemon' }], [{ shape: 'star', color: 'charcoal' }], [{ shape: 'Star', color: 'lemon' }], [{ shape: 'star', color: 'Lemon' }],
      [{ shape: 'blue', color: 'blue' }], [{ shape: 'star', color: 'cherry' }], [{ shape: 'cloud', color: 'sky' }], [{ shape: 'star' }], [{ color: 'lemon' }], ['star'], [null],
      [{ shape: 'star', color: 'lemon', group: '' }], [{ shape: 'star', color: 'lemon', extra: 1 }], [{ shape: 'star', color: 'lemon', group: 'x'.repeat(201) }], [['star', 'lemon']]];
    for (const held of bad) expect(() => nextOneLook(held as OneLookHolder[]), JSON.stringify(held)).toThrow();
    for (const held of [null, undefined, 1, 'star']) expect(() => nextOneLook(held as unknown as OneLookHolder[])).toThrow();
    for (const options of [{ group: '' }, { group: 5 }, { other: 1 }, null, []]) expect(() => nextOneLook([], options as never)).toThrow();
  });

  it('lets stored appearance hold a shape and a colour, select Digital One, and refuses never pairs and colours alone', () => {
    expect(parseCharacterAppearance({ skin: 'one', shape: 'star', color: 'lemon' })).toEqual({ skin: 'one', shape: 'star', color: 'lemon' });
    expect(parseCharacterAppearance({ skin: 'one', shape: 'star' })).toEqual({ skin: 'one', shape: 'star' });
    expect(parseCharacterAppearance({ skin: 'one', shape: 'charcoal' })).toEqual({ skin: 'one', shape: 'charcoal' });
    expect(parseCharacterAppearance({ skin: 'one' })).toEqual({ skin: 'one' });
    for (const appearance of [{ skin: 'one', shape: 'star', color: 'cherry' }, { skin: 'one', shape: 'charcoal', color: 'lemon' }, { skin: 'one', color: 'lemon' },
      { skin: 'one', shape: 'standard' }, { skin: 'one', shape: 'teal' }, { skin: 'one', shape: 'blue' }, { skin: 'one', shape: 'circle' }, { skin: 'one', shape: 'star', color: 'teal' },
      { skin: 'one', shape: 'star', color: 'charcoal' }, { skin: 'one', shape: 'star', color: 'blank' }, { skin: 'autos', shape: 'star' }, { skin: 'autos', color: 'lemon' },
      { skin: 'spacex', shape: 'cloud', color: 'lavender' }, { skin: 'one', theme: 'dark' }, { skin: 'one', label: 'Scout' }]) {
      expect(() => parseCharacterAppearance(appearance), JSON.stringify(appearance)).toThrow();
    }
    const star = generateCharacter(did, { skin: 'one', shape: 'star', color: 'lemon' });
    expect(star).toMatchObject({ skin: 'one', shape: 'star', oneColor: 'lemon', color: '#ffe93f' });
    // A shape alone wears its own colour; a colour alone wears the DID's shape, which must allow it.
    expect(generateCharacter(did, { skin: 'one', shape: 'bean' })).toMatchObject({ shape: 'bean', oneColor: 'grape', color: '#9f47dc' });
    expect(generateCharacter(did, { skin: 'one', color: 'lime' })).toMatchObject({ shape: 'flower', oneColor: 'lime', color: '#b0dc3c' });
    expect(() => generateCharacter('did:oas:openagent:agent:spread-5', { skin: 'one', color: 'lime' })).toThrow('A diamond is never lime');
    expect(() => generateCharacter(did, { skin: 'one', shape: 'droplet', color: 'berry' })).toThrow('A droplet is never berry');
    expect(() => generateCharacter(did, { skin: 'one', shape: 'charcoal', color: 'lemon' })).toThrow('Digital One has no colour');
    expect(() => generateCharacter(did, { skin: 'autos', color: 'lemon' } as CharacterOptions)).toThrow('Colour is for the One family');
    expect(() => generateCharacter(did, { skin: 'one', color: 'teal' } as never)).toThrow('Unsupported One colour');
    // Digital One is black on both surfaces and carries no colour id.
    const digital = generateCharacter(did, { skin: 'one', shape: 'charcoal' });
    expect(digital.color).toBe('#141b16');
    expect(digital).not.toHaveProperty('oneColor');
    expect(generateCharacter(did, { skin: 'one', shape: 'charcoal', theme: 'dark' }).color).toBe('#141b16');
    expect(() => generateCharacter(did, { skin: 'one', shape: 'indigo' as never })).toThrow('Unsupported shape for character skin');
    expect(generateCharacter(did, { skin: 'one', shape: 'squircle', color: 'indigo', theme: 'dark' }).color).toBe('#5660f6');
    const avatar = decodeURIComponent(agentAvatar(did, { avatarSkin: { skin: 'one', shape: 'bean', color: 'grape' } }).split(',')[1]!);
    expect(avatar).toContain('data-character-skin="one"');
    expect(avatar).toContain('data-character-shape="bean"');
    expect(avatar).toContain('data-one-color="grape"');
    expect(avatar).toContain('fill="#9f47dc"');
  });
});

describe('One faces', () => {
  it('maps every status and expression to a face, activity statuses to their own faces', () => {
    const activity: Record<string, OneFace> = { idle: 'idle', listening: 'listening', reasoning: 'thinking', working: 'working',
      typing: 'typing', speaking: 'speaking', success: 'done', attention: 'attention', blocked: 'waiting', paused: 'paused',
      offline: 'offline', error: 'error' };
    for (const { status, expression } of getCharacterStatuses()) {
      const face = oneFaceFor({ status, expression });
      expect(face).toBe(activity[status] ?? expression);
      expect(() => oneHeldPose(face, row, 44)).not.toThrow();
    }
    // An explicit expression override shows that expression's face.
    expect(oneFaceFor({ status: 'working', expression: 'curious' })).toBe('curious');
    expect(oneFaceFor({ status: 'paused', expression: 'happy' })).toBe('happy');
  });

  it('keeps needs-you the only head looking at the viewer in a list', () => {
    for (const face of faces) for (const px of sizes) {
      const pose = oneHeldPose(face, row, px);
      const atViewer = Math.abs(pose.look) < 0.15 && Math.abs(pose.lift) < 0.2;
      // Listening and speaking are call faces, shown at the viewer by design.
      if (face === 'attention' || face === 'listening' || face === 'speaking') continue;
      expect(atViewer, `${face} at ${px}px`).toBe(false);
    }
    expect(oneHeldPose('attention', row, 44)).toMatchObject({ look: 0, lift: 0, open: 1.06 });
  });

  it('never holds a smile, a mouth or an eye that reads as a dot', () => {
    for (const face of faces) for (const px of sizes) for (const gaze of [row, { x: 0, y: 0 }, { x: -0.4, y: 0.1 }, { x: 1, y: -1 }]) {
      const pose = oneHeldPose(face, gaze, px);
      expect(pose.smile).toBe(0);
      expect(pose.mouth).toBe(0);
      expect(pose.open <= 0.08 || pose.open >= 0.35, `${face} open ${pose.open}`).toBe(true);
      if (pose.open <= 0.08) expect(px).toBeGreaterThanOrEqual(64);
    }
  });

  it('dozes with a visible eye below 64 px and closes the lid at 64 px and up', () => {
    expect(oneHeldPose('paused', row, 44).open).toBe(0.42);
    expect(oneHeldPose('paused', row, 64).open).toBe(0);
    expect(oneTier(16)).toBe('XS'); expect(oneTier(20)).toBe('XS'); expect(oneTier(24)).toBe('S'); expect(oneTier(36)).toBe('S');
    expect(oneTier(40)).toBe('M'); expect(oneTier(52)).toBe('M'); expect(oneTier(64)).toBe('L'); expect(oneTier(512)).toBe('L');
  });

  it('draws the mark itself at agent-eye REST, and keeps the centred face for needs-you', () => {
    const rest = oneGeometry(ONE_NEUTRAL, 'S', 'charcoal');
    const mark = eye.poseToFrame(eye.REST);
    expect(rest.bar).toBe(eye.barPath(eye.barShape(mark).n));
    expect(rest.eye).toBe('translate(0 0) rotate(0)');
    expect(rest.strokeWidth).toBe(eye.r2(2 * eye.barShape(mark).r));
    expect(rest.mouth).toBeNull();
    expect(rest.body).toBe('');
    // With no content direction (a hero), idle and neutral are warm at the viewer, so a head that needs you, centred
    // and a touch wide, is never mistaken for one at rest (AVATARS.md §2.2, Idle in heroes).
    for (const face of ['idle', 'neutral'] as const) {
      expect(oneHeldPose(face, { x: 0, y: 0 }, 96)).toMatchObject({ look: 0, lift: 0, tilt: 5, open: 0.92 });
      expect(oneHeldPose(face, { x: 0, y: 0.3 }, 40)).toMatchObject({ look: 0, lift: 0.3, tilt: 0, open: 1 });
    }
    expect(oneHeldPose('attention', { x: 0, y: 0 }, 96)).toMatchObject({ look: 0, lift: 0, tilt: 0, open: 1.06 });
  });

  it('places the eye by the library and limits the pose before agent-eye sees it', () => {
    const square = getOneShapes().find(shape => shape.id === 'squircle')!;
    const drop = getOneShapes().find(shape => shape.id === 'droplet')!;
    // The eye group: the shape's translate and scale, then agent-eye's own translate and tilt; the mouth at mouthDy.
    const rest = oneGeometry(ONE_NEUTRAL, 'L', 'squircle');
    expect(rest.eye).toBe('translate(0 0) scale(0.8) translate(0 0) rotate(0)');
    expect(rest.bar).toBe(eye.barPath(eye.barShape(eye.poseToFrame(eye.REST)).n));
    expect(oneGeometry(ONE_NEUTRAL, 'L', 'droplet').eye).toBe('translate(0 21) scale(0.8) translate(0 0) rotate(0)');
    // look × lookGain, lift × liftGain, open = min(open, openMax) × openScale, mouth × mouthMax; tilt and smile pass through.
    const pose: OnePose = { ...ONE_NEUTRAL, look: 0.8, lift: -0.6, open: 1.3, tilt: 7, smile: 1, mouth: 1 };
    expect(limitPose(pose, drop.eye)).toEqual({ ...pose, look: 0.4, lift: -0.6, open: 1.04 * 0.92, mouth: 0.6 });
    expect(limitPose(pose, square.eye)).toEqual({ ...pose, open: 1.3 });
    expect(limitPose(pose, ONE_CIRCLE.eye)).toEqual({ ...pose });
    expect(limitPose({ open: 0 }, drop.eye)).toEqual({ open: 0 });
    const frame = oneFrame(pose, 1, 'droplet');
    expect(frame).toEqual(eye.poseToFrame({ look: 0.4, lift: -0.6, open: 1.04 * 0.92, tilt: 7, smile: 1, mouth: 0.6 }));
    expect(oneFrame(pose, 1, 'charcoal')).toEqual(eye.poseToFrame({ look: 0.8, lift: -0.6, open: 1.3, tilt: 7, smile: 1, mouth: 1 }));
    // A blink still shuts a limited eye.
    expect(oneFrame(pose, 0, 'droplet').h).toBe(oneFrame({ ...pose, open: 0 }, 1, 'droplet').h);
    expect(oneFrame(pose, 0, 'droplet').h).toBe(eye.poseToFrame({ look: 0.4, lift: -0.6, open: 0, tilt: 7, smile: 1, mouth: 0.6 }).h);
    // A wide eye is held level in an agent shape (the library measured wide eyes level): tilt fades from the blink's
    // 1.04 overshoot to openMax. Digital One's circle is agent-eye's own and keeps every tilt.
    const diamond = getOneShapes().find(shape => shape.id === 'diamond')!;
    expect(levelTilt(6, 1, diamond.eye, 'diamond')).toBe(6);
    expect(levelTilt(6, 1.04, diamond.eye, 'diamond')).toBe(6);
    expect(levelTilt(6, 1.25, diamond.eye, 'diamond')).toBe(0);
    expect(levelTilt(6, 1.3, diamond.eye, 'diamond')).toBe(0);
    expect(levelTilt(-6, 1.145, diamond.eye, 'diamond')).toBeCloseTo(-3, 6);
    expect(levelTilt(6, 1.1, drop.eye, 'droplet')).toBe(6);
    expect(levelTilt(6, 1.3, ONE_CIRCLE.eye, 'charcoal')).toBe(6);
    expect(oneFrame({ ...ONE_NEUTRAL, open: 1.1, tilt: 6 }, 1, 'charcoal').tilt).toBe(6);
    expect(oneFrame({ ...ONE_NEUTRAL, open: 1.1, tilt: 6 }, 1, 'squircle').tilt).toBeCloseTo(6 * (1 - 0.06 / 0.31), 6);
    // The body squashes and hops about the shape's pivot.
    const hop = oneGeometry({ ...ONE_NEUTRAL, hop: -0.1, squash: 4 }, 'L', 'bean').body;
    expect(hop).toBe('translate(-9.73 80) rotate(0) scale(0.9806 1.0400) translate(9.73 -100)');
    expect(oneGeometry({ ...ONE_NEUTRAL, hop: -0.1, squash: 4 }, 'L', 'charcoal').body).toBe('translate(0 80) rotate(0) scale(0.9806 1.0400) translate(0 -100)');
    // Every kind's body transform is the identity on a resting pose.
    for (const kind of kinds) expect(oneGeometry(ONE_NEUTRAL, 'L', kind).body).toBe('');
  });

  it('draws no smile or mouth line at 24 px or smaller, on any One (R8)', () => {
    const smiling: OnePose = { ...ONE_NEUTRAL, smile: 1, mouth: 1, open: 0.6 };
    for (const kind of kinds) {
      expect(oneGeometry(smiling, 'XS', kind).mouth).toBeNull();
      expect(oneGeometry(smiling, 'S', kind).mouth).toBeNull();
      expect(oneGeometry(smiling, 'M', kind).mouth).not.toBeNull();
      expect(oneGeometry(smiling, 'L', kind).mouth).not.toBeNull();
    }
    const geometry = oneShapeGeometry('bean');
    const frame = oneFrame(smiling, 1, 'bean');
    expect(oneGeometry(smiling, 'L', 'bean').mouth).toEqual({ x: eye.r2(frame.mx - frame.ma), y: eye.r2(frame.my + geometry.mouthDy - frame.mt / 2),
      width: eye.r2(2 * frame.ma), height: eye.r2(frame.mt), rx: eye.r2(eye.GEOMETRY.cornerRadius), opacity: eye.r2(frame.mo) });
  });

  it('mirrors faces for right-to-left content', () => {
    for (const face of faces) {
      const ltr = oneHeldPose(face, row, 44), rtl = oneHeldPose(face, { x: -row.x, y: row.y }, 44);
      expect(rtl.look).toBeCloseTo(-ltr.look, 10);
      expect(rtl.tilt).toBeCloseTo(-ltr.tilt, 10);
      expect(rtl.lift).toBe(ltr.lift);
    }
  });

  it('keeps every held face at least ten units inside every shape, and inside agent-eye\'s safe radius in the circle', () => {
    for (const kind of kinds) for (const face of faces) for (const px of sizes) for (const gaze of [row, { x: 1, y: 1 }, { x: -1, y: -1 }, { x: 0, y: 0 }, { x: 1, y: -1 }, { x: -1, y: 1 }]) {
      const result = contained(oneHeldPose(face, gaze, px), kind);
      expect(result.clearance, `${face} at ${px}px in ${kind}, gaze ${gaze.x},${gaze.y}`).toBeGreaterThanOrEqual(kind === 'charcoal' ? -0.01 : MARGIN);
    }
  });
});

describe('One moments', () => {
  const motion = (face: OneFace, px: number, kind: OneKind = 'squircle', level?: () => number) =>
    new OneMotion({ face, gaze: row, px, kind, random: seededRandom(new Uint8Array([1, 2, 3, 4])),
      cadence: 'brief', ...(level ? { level } : {}), motion: true, at: 0 });
  const check = (pose: OnePose, kind: OneKind, context: string): void => {
    const result = contained(pose, kind);
    expect(result.clearance, context).toBeGreaterThanOrEqual(kind === 'charcoal' ? -0.01 : MARGIN);
    expect(result.gap, context).toBeGreaterThanOrEqual(eye.MOUTH.minGap);
  };

  it('keeps independent constructor-local state on separate motion instances', () => {
    const first = motion('idle', 64), second = motion('idle', 64);
    expect(Object.getPrototypeOf(first)).toBe(OneMotion.prototype);
    expect(first).toBeInstanceOf(OneMotion);
    first.setFace('working', row, 10);
    first.setSize(16);
    expect(first.face).toBe('working');
    expect(first.tier).toBe('XS');
    expect(second.face).toBe('idle');
    expect(second.tier).toBe('L');
  });

  it('keeps every frame of every moment inside the disc, with the smile clear of the eye, from every face (V2)', () => {
    for (const name of moments) for (const px of sizes) for (const kind of ['droplet', 'charcoal'] as const) for (const face of faces) {
      const head = motion(face, px, kind);
      head.start({ name, priority: 0 }, 0);
      const end = head.timelineEnd!;
      expect(end).toBeGreaterThan(0);
      expect(end).toBeLessThan(5000);
      for (let t = 0; t <= end + 16; t += 16) check(head.sample(t).frame.pose, kind, `${name} from ${face} at ${px}px in ${kind}, ${t} ms`);
      expect(head.moving).toBe(false);
      const settled = head.sample(end + 100).frame.pose, held = oneHeldPose(face, row, px);
      if (name === 'keys') continue; // keystrokes keep the typing face's level; the next state's entrance settles it
      for (const key of Object.keys(held) as (keyof typeof held)[]) expect(settled[key], `${name} from ${face} ${key}`).toBeCloseTo(held[key], 3);
    }
  }, 60_000);

  it('keeps every frame of every moment at least ten units inside every shape, at every tier', () => {
    for (const kind of shapeOrder) for (const name of moments) for (const px of [16, 24, 44, 96]) for (const face of ['idle', 'done', 'speaking', 'paused', 'excited', 'confused'] as const) {
      const head = motion(face, px, kind);
      head.start({ name, priority: 0 }, 0);
      const end = head.timelineEnd!;
      for (let t = 0; t <= end + 16; t += 24) check(head.sample(t).frame.pose, kind, `${name} from ${face} at ${px}px in ${kind}, ${t} ms`);
    }
    for (const kind of shapeOrder) {
      let level = 0;
      const head = motion('speaking', 96, kind, () => level);
      expect(head.startTalk(0)).toBe(true);
      for (let t = 0; t < 3000; t += 16) { level = Math.abs(Math.sin(t / 180)); check(head.sample(t).frame.pose, kind, `talk in ${kind} at ${t} ms`); }
    }
  }, 120_000);

  it('withdraws the smile line before an interrupting moment moves the eye (V2)', () => {
    for (const px of [44, 64, 96]) for (const name of moments) for (let offset = 0; offset <= 3300; offset += 50) {
      const head = motion('done', px, 'star');
      head.start({ name: 'smile', priority: 4 }, 0);
      for (let t = 0; t < offset; t += 25) head.sample(t);
      head.sample(offset);
      head.start({ name, priority: 6 }, offset);
      const end = head.timelineEnd!;
      // Whole moments are checked above; here every frame that still shows the line is checked against the eye.
      for (let t = offset; t <= end; t += 4) {
        const { frame } = head.sample(t);
        if (frame.geometry.mouth) check(frame.pose, 'star', `${name} cutting the smile at ${offset} ms, ${px}px, ${t} ms`);
      }
    }
    for (const name of moments) for (let offset = 100; offset <= 2000; offset += 50) {
      let level = 0;
      const head = motion('speaking', 96, 'charcoal', () => level);
      expect(head.startTalk(0)).toBe(true);
      for (let t = 0; t <= offset; t += 16) { level = Math.abs(Math.sin(t / 130)); head.sample(t); }
      head.start({ name, priority: 6 }, offset);
      const end = head.timelineEnd!;
      for (let t = offset; t <= end; t += 4) {
        const { frame } = head.sample(t);
        if (frame.geometry.mouth) check(frame.pose, 'charcoal', `${name} cutting talk at ${offset} ms, ${t} ms`);
      }
    }
  }, 60_000);

  it('smiles with a happy squint at 40 px and up, never a tall bar over the line', () => {
    for (const [px, open] of [[44, 0.42], [96, 0.6]] as const) for (const gaze of [row, { x: 0, y: 0.3 }]) {
      const head = new OneMotion({ face: 'done', gaze, px, kind: 'squircle', random: seededRandom(new Uint8Array(4)), cadence: 'brief', motion: true, at: 0 });
      head.start({ name: 'smile', priority: 4 }, 0);
      const peak = head.sample(1300).frame.pose;
      expect(peak.open).toBeCloseTo(open, 3);
      expect(peak.tilt).toBeCloseTo(10, 3);
      expect(peak.look).toBeCloseTo(gaze.x === 0 ? 0.12 : 0.2, 3);
      expect(peak.smile).toBeCloseTo(1, 2);
      expect(peak.mouth).toBeCloseTo(1, 2);
      // The eye's drawn height is less than half the mark's: it reads as a squinting face, not "!".
      expect(eye.poseToFrame(peak).h).toBeLessThan(eye.GEOMETRY.barHeight / 2);
    }
  });

  it('talks with a narrowed eye, a full smile and an opaque mouth that follows the voice level, inside the disc', () => {
    let level = 0;
    const head = motion('speaking', 96, 'charcoal', () => level);
    expect(head.startTalk(0)).toBe(true);
    let opened = 0;
    for (let t = 0; t < 4000; t += 16) {
      level = Math.abs(Math.sin(t / 180));
      const { frame } = head.sample(t);
      opened = Math.max(opened, frame.pose.mouth);
      check(frame.pose, 'charcoal', `talk at ${t} ms`);
      // A drawn mouth line is always fully opaque: a quiet syllable never flickers like a status light.
      if (frame.geometry.mouth) expect(frame.geometry.mouth.opacity).toBe(1);
      if (t > 600) { expect(frame.pose.smile).toBeGreaterThan(0.99); expect(frame.pose.open).toBeCloseTo(0.6, 2); }
    }
    expect(opened).toBeGreaterThan(0.9);
    level = 0;
    let closed = 1;
    for (let t = 4000; t < 5000; t += 16) closed = head.sample(t).frame.pose.mouth;
    expect(closed).toBe(0);
    // No talk without a level source, below the largest tier or without motion.
    expect(motion('speaking', 44, 'charcoal', () => 1).startTalk(0)).toBe(false);
    expect(motion('speaking', 96).startTalk(0)).toBe(false);
  });

  it('chooses entrances from the state map, by priority, and settles the smallest heads without moments', () => {
    const entering = (from: OneFace, to: OneFace, px = 44) => motion(from, px).entrance(from, to);
    expect(entering('idle', 'attention')).toEqual({ name: 'psst', priority: 6 });
    expect(entering('idle', 'error')).toEqual({ name: 'dizzy', priority: 5 });
    expect(entering('working', 'done')).toEqual({ name: 'smile', priority: 4 });
    expect(entering('working', 'done', 28)).toEqual({ name: 'nod', priority: 4 });
    expect(entering('idle', 'paused')).toEqual({ name: 'dozeOff', priority: 3 });
    expect(entering('paused', 'idle')).toEqual({ name: 'wake', priority: 3 });
    expect(entering('thinking', 'idle')).toEqual({ name: 'aha', priority: 3 });
    expect(entering('idle', 'working')).toEqual({ name: 'read', priority: 2 });
    expect(entering('idle', 'typing')).toEqual({ name: 'keys', priority: 2 });
    expect(entering('idle', 'thinking')).toEqual({ name: 'ponder', priority: 1 });
    expect(entering('idle', 'curious')).toEqual({ name: 'home', priority: 0 });
    expect(entering('idle', 'attention', 16)).toEqual({ name: 'settle', priority: 0, uncounted: true });
    // Needs you, then error, then done, then the ongoing states (AVATARS.md §2.3 rule 2).
    expect(['attention', 'error', 'done', 'paused', 'working', 'thinking'].map(to => entering('idle', to as OneFace).priority))
      .toEqual([6, 5, 4, 3, 2, 1]);
  });

  it('shuts a centred eye tilted, so a blink at the viewer never shows a level bar', () => {
    for (const [from, to] of [['idle', 'attention'], ['paused', 'idle']] as const) for (const px of [24, 44, 96]) {
      const head = motion(from, px);
      head.setFace(to, row, 0);
      head.start(head.entrance(from, to), 0);
      let shut: { open: number; tilt: number } | null = null;
      for (let t = 0; t <= head.timelineEnd!; t += 4) {
        const pose = head.sample(t).frame.pose;
        if (Math.abs(pose.look) < 0.15 && (!shut || pose.open < shut.open)) shut = { open: pose.open, tilt: pose.tilt };
      }
      expect(shut!.open, `${from}→${to} ${px}`).toBeLessThan(0.1);
      expect(Math.abs(shut!.tilt), `${from}→${to} ${px}`).toBeGreaterThanOrEqual(6);
    }
  });

  it('paces each kind by its shape\'s temperament: a quick glance up and read-along jumps at agent-eye speed for every temperament', () => {
    for (const [temperament, kind] of Object.entries(byTemperament) as [keyof typeof byTemperament, OneKind][]) {
      expect(motion('idle', 44, kind).temperament).toBe(temperament);
      expect(oneTemperament(kind)).toBe(temperament);
    }
    const head = motion('idle', 44, 'droplet');
    head.setKind('cloud');
    expect(head.temperament).toBe('slow');
    for (const kind of ['droplet', 'cloud'] as const) {
      const ponder = motion('thinking', 96, kind);
      ponder.start({ name: 'ponder', priority: 1 }, 0);
      expect(ponder.sample(400).frame.pose.lift).toBeLessThan(-0.4);
      const read = motion('working', 96, kind);
      read.start({ name: 'read', priority: 2 }, 0);
      // The first saccade (110 ms + 110 per unit of look, then a 160 ms settle) lands on time whatever the tempo.
      expect(read.sample(400).frame.pose.look).toBeCloseTo(-0.55, 1);
    }
  });

  it('types with keystrokes of a pixel or two', () => {
    const head = motion('typing', 96);
    head.start({ name: 'keys', priority: 2 }, 0);
    let lowest = 0;
    for (let t = 0; t <= head.timelineEnd!; t += 8) lowest = Math.max(lowest, head.sample(t).frame.pose.lift);
    expect(lowest - oneHeldPose('typing', row, 96).lift).toBeGreaterThanOrEqual(0.2);
  });

  it('opens a new agent\'s eye for the first time, shut and tilted, then looks toward its name', () => {
    for (const px of [24, 44, 96]) {
      const head = motion('idle', px);
      head.start({ name: 'firstBlink', priority: 7, user: true }, 0);
      const first = head.sample(1).frame.pose;
      expect(first.open).toBe(0);
      expect(Math.abs(first.tilt)).toBeGreaterThanOrEqual(6);
      expect(head.sample(450).frame.pose.open).toBeGreaterThan(0.9);
      const end = head.timelineEnd!;
      expect(end).toBeLessThanOrEqual(px >= 40 ? 1800 : 1000);
      expect(head.sample(end + 50).frame.pose).toEqual(expect.objectContaining({ look: expect.closeTo(row.x, 3), lift: expect.closeTo(row.y, 3) }));
    }
  });

  it('plays the host\'s gestures, each ending on the held face: look-at-you, a shrug and an arrival', () => {
    const peak = (head: OneMotion, pick: (pose: ReturnType<typeof oneHeldPose>) => number, max = true): number => {
      let best = max ? -Infinity : Infinity;
      for (let t = 0; t <= head.timelineEnd!; t += 8) { const v = pick(head.sample(t).frame.pose); best = max ? Math.max(best, v) : Math.min(best, v); }
      return best;
    };
    for (const px of [24, 44, 96]) {
      // Look-at-you turns square to the viewer, then blinks shut tilted, never as a level bar.
      const look = motion('idle', px);
      look.start({ name: 'lookAtYou', priority: 5, user: true }, 0);
      const square = look.sample(300).frame.pose;
      expect(Math.abs(square.look)).toBeLessThan(0.05);
      expect(Math.abs(square.lift)).toBeLessThan(0.05);
      let shut = false;
      for (let t = 0; t <= look.timelineEnd!; t += 4) {
        const pose = look.sample(t).frame.pose;
        if (pose.open < 0.05) { shut = true; expect(Math.abs(pose.tilt)).toBeGreaterThanOrEqual(4); }
      }
      expect(shut).toBe(true);
      expect(look.timelineEnd!).toBeLessThan(2000);
    }
    // Digital One holds deadpan with a dry chuckle at 40 px and up; a coloured One opens a touch wide.
    const dry = motion('idle', 44, 'charcoal');
    dry.start({ name: 'lookAtYou', priority: 5 }, 0);
    expect(dry.sample(300).frame.pose.open).toBeCloseTo(0.92, 2);
    expect(peak(dry, pose => pose.squash)).toBeGreaterThan(1);
    // The shrug looks up and aside and tips its body at 40 px and up.
    const shrug = motion('idle', 64);
    shrug.start({ name: 'shrug', priority: 5 }, 0);
    expect(peak(shrug, pose => pose.lift, false)).toBeLessThan(-0.3);
    expect(peak(shrug, pose => Math.abs(pose.rotate))).toBeGreaterThan(8);
    // The arrival starts by shutting the eye (tilted), pops up and lands with the eye wide open.
    const arrive = motion('idle', 96, 'charcoal');
    arrive.start({ name: 'popIn', priority: 3 }, 0);
    const closed = arrive.sample(120).frame.pose; // 80 ms at tempo 1; Digital One at 96 px is paced 1.18×
    expect(closed.open).toBeLessThan(0.05);
    expect(Math.abs(closed.tilt)).toBeGreaterThanOrEqual(6);
    expect(peak(arrive, pose => pose.hop, false)).toBeLessThan(-0.05);
    expect(peak(arrive, pose => pose.open)).toBeGreaterThan(1.03);
    expect(arrive.timelineEnd!).toBeLessThan(1500);
  });

  it('follows a fine pointer with the eye only, at rest and at 40 px and up', () => {
    const head = motion('idle', 64);
    expect(head.follow({ x: 0.8, y: -0.5 })).toBe(true);
    expect(head.moving).toBe(true);
    for (let t = 0; t <= 600; t += 16) head.sample(t);
    const pose = head.sample(616).frame.pose;
    expect(pose.look).toBeCloseTo(0.8, 2);
    expect(pose.lift).toBeCloseTo(-0.5, 2);
    expect(pose.squash).toBe(0);
    expect(head.request).toBeNull();
    expect(head.follow(null)).toBe(false);
    expect(head.moving).toBe(false);
    expect(motion('working', 64).follow({ x: 1, y: 0 })).toBe(false);
    expect(motion('idle', 32).follow({ x: 1, y: 0 })).toBe(false);
    const still = new OneMotion({ face: 'idle', gaze: row, px: 64, kind: 'squircle', random: seededRandom(new Uint8Array(4)), cadence: 'brief', motion: false, at: 0 });
    expect(still.follow({ x: 1, y: 0 })).toBe(false);
    // A moment takes over from following; containment holds at the pointer's extremes, in every shape.
    for (const kind of kinds) {
      const follower = motion('idle', 64, kind);
      follower.follow({ x: -1, y: 1 });
      for (let t = 0; t <= 800; t += 16) check(follower.sample(t).frame.pose, kind, `follow ${t} in ${kind}`);
    }
    head.follow({ x: -1, y: 1 });
    for (let t = 700; t <= 1500; t += 16) head.sample(t);
    head.start({ name: 'psst', priority: 6 }, 1500);
    expect(head.following).toBe(false);
  });

  it('repaints mid-moment without finishing it, so a host never loses track of a moving head', () => {
    const head = motion('idle', 44);
    head.start({ name: 'wave', priority: 4, user: true }, 0);
    const end = head.timelineEnd!;
    const peeked = head.peek(end + 10);
    expect(peeked.moving).toBe(true);
    expect(head.timelineEnd).toBe(end);
    expect(head.request).not.toBeNull();
    const { finished, frame } = head.sample(end + 10);
    expect(finished).toEqual({ name: 'wave', priority: 4, user: true });
    expect(frame.pose).toEqual(peeked.pose);
  });

  it('paces ongoing work briefly in lists and in clusters in headers, and never at rest', () => {
    const brief = motion('working', 44);
    expect(brief.cadenceRequest()).toMatchObject({ name: 'read', cadence: true });
    expect(brief.nextCadence(100)).toBeGreaterThanOrEqual(300);
    // The next cluster is drawn and measured up front, and is the one that plays.
    expect(brief.cadenceRequest()!.draws).toHaveLength(16);
    expect(brief.nextCadence(4000)).toBeNull();
    const repeat = new OneMotion({ face: 'thinking', gaze: row, px: 40, kind: 'squircle', random: seededRandom(new Uint8Array(4)), cadence: 'repeat', motion: true, at: 0 });
    const delay = repeat.nextCadence(10_000)!;
    expect(delay).toBeGreaterThanOrEqual(6000);
    expect(delay).toBeLessThanOrEqual(10_000);
    expect(repeat.nextCadence(70_000)).toBeNull();
    repeat.noteInput(70_000);
    expect(repeat.nextCadence(70_001)).not.toBeNull();
    // Typing in a header repeats like every ongoing state: one cluster every six to ten seconds, never back to back.
    const typing = new OneMotion({ face: 'typing', gaze: { x: 0, y: 0.3 }, px: 40, kind: 'squircle', random: seededRandom(new Uint8Array([9, 9, 9, 9])), cadence: 'repeat', motion: true, at: 0 });
    expect(typing.cadenceRequest()).toMatchObject({ name: 'keys', cadence: true });
    for (let i = 0; i < 50; i++) {
      const gap = typing.nextCadence(1000 + i)!;
      expect(gap).toBeGreaterThanOrEqual(6000);
      expect(gap).toBeLessThanOrEqual(10_000);
    }
    expect(motion('idle', 44).cadenceRequest()).toBeNull();
    expect(motion('working', 16).cadenceRequest()).toBeNull();
  });

  it('holds every face still without motion', () => {
    const head = new OneMotion({ face: 'idle', gaze: row, px: 44, kind: 'squircle', random: seededRandom(new Uint8Array(4)), cadence: 'brief', motion: false, at: 0 });
    expect(head.setFace('attention', row, 10)).toBeNull();
    expect(head.moving).toBe(false);
    expect(head.sample(20).frame.pose).toEqual(oneHeldPose('attention', row, 44));
    expect(head.cadenceRequest()).toBeNull();
  });
});

describe('One still glyph', () => {
  const attributes = (svg: string): Record<string, string> => Object.fromEntries([...svg.match(/^<svg\b[^>]*>/)![0]
    .matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1]!, match[2]!]));
  const shoelace = (d: string): number => {
    const points = d.slice(1, -1).split('L').map(pair => pair.split(' ').map(Number) as [number, number]);
    let area = 0;
    for (let i = 0; i < points.length; i++) { const [x1, y1] = points[i]!, [x2, y2] = points[(i + 1) % points.length]!; area += x1 * y2 - x2 * y1; }
    return Math.abs(area) / 2;
  };
  const attribute = (svg: string, element: string, name: string): string | undefined =>
    svg.match(new RegExp(`<path data-one-${element}="true"[^>]*\\s${name}="([^"]+)"`))?.[1];

  it('is a decorative, self-contained still SVG of the held face in its shape, with no element identifiers', () => {
    for (const kind of kinds) for (const theme of ['light', 'dark'] as const) for (const status of ['idle', 'working', 'attention', 'paused', 'error'] as const) {
      const character = generateCharacter(did, { skin: 'one', ...look(kind), theme, size: 44, state: { status, gaze: row } });
      const color = kind === 'charcoal' ? 'charcoal' : look(kind).color!;
      const root = attributes(character.svg);
      expect(root).toMatchObject({ viewBox: '-100 -100 200 200', width: '44', height: '44', 'aria-hidden': 'true', overflow: 'visible',
        'data-character-skin': 'one', 'data-character-shape': kind, 'data-character-theme': theme, 'data-one-shape': oneShapeId(kind), 'data-one-color': color, 'data-one-tier': 'M' });
      expect(root).not.toHaveProperty('role');
      expect(character.svg).not.toContain('<title>');
      expect(character.svg).not.toMatch(/<(?:script|foreignObject|image|text|animate|animateTransform|set|style|mask|use|clipPath)\b|\b(?:id|on\w+|href|xlink:href|style|clip-path)=/i);
      expect(character.svg).not.toContain(did);
      const paint = onePaint(color, theme);
      const shape = oneShapeGeometry(kind);
      const pose = oneHeldPose(oneFaceFor({ status, expression: character.expression }), row, 44);
      const geometry = oneGeometry(pose, 'M', kind);
      expect(character.svg.includes('data-one-keyline')).toBe(paint.keyline !== null);
      expect(character.svg.includes('data-one-rim')).toBe(paint.rim !== null);
      expect(character.svg).not.toContain('data-one-mouth');
      if (paint.eye === null) {
        // Digital One's eye on a light surface is cut out of the disc with the even-odd rule: the surface shows through, no mask.
        const outline = oneEyeOutline(oneFrame(pose, 1, 'charcoal'), ONE_CIRCLE.eye);
        expect(character.svg).toContain(`<path data-one-disc="true" fill-rule="evenodd" d="${ONE_CIRCLE.path}${outline}" fill="#141b16"/>`);
        expect(character.svg).not.toContain('data-one-eye');
      } else {
        expect(character.svg).toContain(`<path data-one-disc="true" d="${shape.path}" fill="${paint.disc}"/>`);
        expect(character.svg).toContain(`<g data-character-eyes="agent-eye-v1" transform="${geometry.eye}"><path data-one-eye="true" d="${geometry.bar}" fill="${paint.eye}" stroke="${paint.eye}"`);
      }
      if (kind === 'charcoal') {
        expect(character.color).toBe('#141b16');
        if (theme === 'dark') expect(character.svg).toContain(`<path data-one-rim="true" d="${oneInsetPath(ONE_CIRCLE.path, oneRimWidth(44) / 2)}" fill="none" stroke="#f2f1ea" stroke-opacity="0.44" stroke-width="${eye.r2(oneRimWidth(44))}"/>`);
      }
    }
  });

  it('insets every keyline and Digital One\'s rim exactly half its width inside the edge, never growing the silhouette', () => {
    const sample = (d: string): Point[] => {
      const segments = oneOutlineSegments(d);
      const points: Point[] = [];
      for (const segment of segments) {
        for (let i = 0; i < 12; i++) {
          const t = i / 12;
          if (segment.type === 'L') points.push([segment.from[0] + (segment.to[0] - segment.from[0]) * t, segment.from[1] + (segment.to[1] - segment.from[1]) * t]);
          else { const { start, sweep } = arcSweep(segment); const a = start + sweep * t; points.push([segment.centre[0] + segment.r * Math.cos(a), segment.centre[1] + segment.r * Math.sin(a)]); }
        }
      }
      return points;
    };
    for (const kind of kinds) for (const size of [16, 24, 44, 64, 96, 512]) {
      const width = kind === 'charcoal' ? oneRimWidth(size) : oneKeylineWidth(size);
      const d = oneInsetPath(oneShapeGeometry(kind).path, width / 2);
      for (const point of sample(d)) expect(edgeDistance(kind, point), `${kind} at ${size}px`).toBeCloseTo(width / 2, 1);
      const svg = generateCharacter(did, { skin: 'one', ...look(kind), size, theme: kind === 'charcoal' ? 'dark' : 'light' }).svg;
      const element = kind === 'charcoal' ? 'rim' : 'keyline';
      if (kind !== 'charcoal' && onePaint(look(kind).color!, 'light').keyline === null) { expect(svg).not.toContain('data-one-keyline'); continue; }
      expect(attribute(svg, element, 'd')).toBe(d);
      expect(Number(attribute(svg, element, 'stroke-width'))).toBeCloseTo(width, 2);
    }
    expect(() => oneInsetPath(ONE_CIRCLE.path, -1)).toThrow(RangeError);
    expect(() => oneInsetPath(ONE_CIRCLE.path, Number.NaN)).toThrow(RangeError);
    // Convex corners lose radius: the hexagon's 13.27-unit corners cannot take a 14-unit inset. Concave fillets gain it.
    expect(() => oneInsetPath(oneShapeGeometry('hexagon').path, 14)).toThrow(RangeError);
    expect(() => oneInsetPath(oneShapeGeometry('flower').path, 6)).not.toThrow();
    expect(() => oneInsetPath('M0 0L10 0L10 10Z M20 20L30 20Z', 1)).toThrow(TypeError);
    expect(() => oneInsetPath('M0 0C1 1 2 2 3 3Z', 1)).toThrow(TypeError);
    expect(() => oneInsetPath('M0 -100A100 50 0 0 1 100 0Z', 1)).toThrow(TypeError);
  });

  it('keeps generated catalog insets byte-identical to the general path helper', () => {
    for (const kind of kinds) for (const size of [16, 17, 20, 24, 40, 52, 64, 96, 128, 512, 2048]) {
      for (const dpr of [1, 1.25, 1.5, 2, 3]) {
        const delta = (kind === 'charcoal' ? oneRimWidth(size) : oneKeylineWidth(size, dpr)) / 2;
        expect(oneShapeInsetPath(kind, delta)).toBe(oneInsetPath(oneShapeGeometry(kind).path, delta));
      }
    }
    expect(() => oneShapeInsetPath('invalid' as OneKind, 1)).toThrow('Unsupported One shape');
    expect(() => oneShapeInsetPath('star', -1)).toThrow(RangeError);
    expect(() => oneShapeInsetPath('star', Number.NaN)).toThrow(RangeError);
  });

  it('cuts Digital One\'s eye exactly as the stroked bar it draws live', () => {
    for (const look of [-1, -0.5, 0, 0.3, 0.8]) for (const lift of [-0.45, 0, 0.55]) for (const open of [0, 0.42, 0.72, 1, 1.12]) for (const tilt of [-12, 0, 10]) {
      const frame = eye.poseToFrame({ look, lift, open, tilt });
      const { r, a, b } = eye.barShape(frame);
      const outline = oneEyeOutline(frame);
      const points = outline.slice(1, -1).split('L').map(pair => pair.split(' ').map(Number) as [number, number]);
      for (const [x, y] of points) expect(Math.hypot(x, y)).toBeLessThanOrEqual(eye.MOTION.safeRadius + 0.02);
      // Area of every point within r of the bar's filled outline (Steiner's formula): sides x = ±a - c·y².
      let expected: number;
      if (b < 1e-6) expected = 2 * r * (Math.max(a - frame.k, a) - Math.min(-a - frame.k, -a)) + Math.PI * r * r;
      else {
        const c = frame.k / (b * b);
        if (b * b / (2 * Math.abs(frame.k)) < r) continue; // a concave side tighter than the stroke folds over itself
        let side = 0;
        for (let i = 0; i < 2000; i++) { const y = -b + 2 * b * (i + 0.5) / 2000; side += Math.sqrt(1 + 4 * c * c * y * y) * 2 * b / 2000; }
        expected = 4 * a * b + r * (4 * a + 2 * side) + Math.PI * r * r;
      }
      expect(Math.abs(shoelace(outline) - expected), `look ${look} lift ${lift} open ${open} tilt ${tilt}`).toBeLessThanOrEqual(0.004 * expected + 0.6);
    }
    // In a shape's eye box the same outline is placed and scaled as the eye group is.
    const frame = eye.poseToFrame({ look: 0.3, lift: -0.2, open: 1, tilt: 5 });
    const placed = oneEyeOutline(frame, oneShapeGeometry('droplet').eye);
    const original = oneEyeOutline(frame).slice(1, -1).split('L').map(pair => pair.split(' ').map(Number) as [number, number]);
    const moved = placed.slice(1, -1).split('L').map(pair => pair.split(' ').map(Number) as [number, number]);
    for (const [index, [x, y]] of original.entries()) {
      expect(moved[index]![0]).toBeCloseTo(0.8 * x, 1);
      expect(moved[index]![1]).toBeCloseTo(21 + 0.8 * y, 1);
    }
  });

  it('names the head only from a supplied label and escapes it', () => {
    const named = generateCharacter(did, { skin: 'one', label: 'Scout & "Co" <agent>' });
    expect(attributes(named.svg)).toMatchObject({ role: 'img', 'aria-label': 'Scout &amp; &quot;Co&quot; &lt;agent&gt;' });
    expect(named.svg).toContain('<title>Scout &amp; &quot;Co&quot; &lt;agent&gt;</title>');
    expect(named.svg).not.toContain('aria-hidden');
    for (const label of ['', '   ', 'a'.repeat(201), 'line\nbreak', 7, null]) {
      expect(() => generateCharacter(did, { skin: 'one', label } as CharacterOptions)).toThrow();
    }
    // Other families keep their generic title unless a label is supplied.
    expect(generateCharacter(did).svg).toContain('<title>OpenAgent Autos character</title>');
    const autos = generateCharacter(did, { label: 'Scout' });
    expect(autos.svg).toContain('<title>Scout</title>');
    expect(attributes(autos.svg)['aria-label']).toBe('Scout');
  });

  it('scales the keyline to one pixel, two at 96 px and up, on light surfaces only', () => {
    const width = (size: number) => Number(attribute(generateCharacter(did, { skin: 'one', shape: 'star', color: 'lemon', size }).svg, 'keyline', 'stroke-width'));
    expect(attribute(generateCharacter(did, { skin: 'one', shape: 'star', color: 'lemon', size: 44 }).svg, 'keyline', 'stroke')).toBe('#918312');
    expect(width(16)).toBeCloseTo(200 / 16, 2);
    expect(width(24)).toBeCloseTo(200 / 24, 2);
    expect(width(32)).toBeCloseTo(200 / 32, 2);
    expect(width(64)).toBeCloseTo(200 / 64, 2);
    expect(width(96)).toBeCloseTo(400 / 96, 2);
    expect(generateCharacter(did, { skin: 'one', shape: 'star', color: 'lemon', theme: 'dark' }).svg).not.toContain('data-one-keyline');
    // The deep colours wear a paper line and need no keyline; the same disc on both surfaces.
    for (const theme of ['light', 'dark'] as const) {
      const svg = generateCharacter(did, { skin: 'one', shape: 'clover', color: 'jade', theme }).svg;
      expect(svg).not.toContain('data-one-keyline');
      expect(svg).toContain('fill="#068368"');
      expect(svg).toContain('data-one-eye="true"');
      expect(attribute(svg, 'eye', 'fill')).toBe('#fbfaf6');
    }
  });

  it('renders One heads at the One app\'s smallest sizes, 16–28 px, and only One below 32 px', () => {
    for (const size of [16, 20, 24, 28]) {
      const head = generateCharacter(did, { skin: 'one', shape: 'star', size, state: { status: 'working', gaze: row } });
      expect(head.size).toBe(size);
      expect(attributes(head.svg)).toMatchObject({ width: String(size), 'data-one-tier': size <= 20 ? 'XS' : 'S' });
      const animator = createCharacterAnimator(did, { skin: 'one', shape: 'star', size, now: () => 0, state: { gaze: row } });
      animator.update({ status: 'attention' }, 0);
      expect(animator.sample(10).one!.tier).toBe(size <= 20 ? 'XS' : 'S');
    }
    for (const size of [15, 2049, 16.5]) expect(() => generateCharacter(did, { skin: 'one', size })).toThrow('One size must be an integer from 16 to 2048');
    for (const skin of ['autos', 'spacex', 'christmas'] as const) {
      expect(() => generateCharacter(did, { skin, size: 16 })).toThrow('Character size must be an integer from 32 to 2048');
    }
  });

  it('draws the slumped body of a paused head at 64 px and up about the shape\'s pivot, as the live head holds it', () => {
    const paused = generateCharacter(did, { skin: 'one', shape: 'bean', size: 96, state: { status: 'paused', gaze: row } });
    const body = oneGeometry(oneHeldPose('paused', row, 96), 'L', 'bean').body;
    expect(body).toMatch(/^translate\(-9\.73 100\) rotate\(6\)/);
    expect(paused.svg).toContain(`<g data-character-body="true" transform="${body}">`);
    expect(generateCharacter(did, { skin: 'one', shape: 'bean', size: 44, state: { status: 'paused', gaze: row } }).svg).toContain('<g data-character-body="true">');
  });

  it('keeps finish, eye placement and accessories in the descriptor without drawing them', () => {
    const plain = generateCharacter(did, { skin: 'one', shape: 'star', animated: false });
    const dressed = generateCharacter(did, { skin: 'one', shape: 'star', animated: false, finish: 'flat', eyePlacement: 'raised', accessories: ['glasses', 'headphones'] });
    expect(dressed).toMatchObject({ finish: 'flat', eyePlacement: 'raised', accessories: ['glasses', 'headphones'] });
    const body = (svg: string) => svg.slice(svg.indexOf('<g data-character-body'));
    expect(body(dressed.svg)).toBe(body(plain.svg));
    expect(dressed.svg).not.toMatch(/data-character-accessory|data-character-eye-mount|<filter/);
  });

  it('never embeds animation, whatever the animated option says', () => {
    const animated = generateCharacter(did, { skin: 'one', state: { status: 'working' } });
    const still = generateCharacter(did, { skin: 'one', animated: false, state: { status: 'working' } });
    expect(animated.animated).toBe(true);
    expect(animated.svg).toBe(still.svg);
    expect(animated.svg).not.toMatch(/<animate/);
  });

  it('applies an explicit blink to the held face', () => {
    const open = generateCharacter(did, { skin: 'one', shape: 'squircle', state: { blink: 0 } });
    const shut = generateCharacter(did, { skin: 'one', shape: 'squircle', state: { blink: 1 } });
    const bar = (svg: string) => svg.match(/data-one-eye="true" d="([^"]+)"/)![1];
    expect(bar(shut.svg)).toBe(eye.barPath(eye.barShape(eye.poseToFrame({ ...oneHeldPose('neutral', { x: 0, y: 0 }, 512), open: 0 })).n));
    expect(bar(open.svg)).not.toBe(bar(shut.svg));
  });

  it('lists the One family in the catalog with its fifteen kinds and its own eye style', () => {
    const family = getCharacterSkins().find(entry => entry.id === 'one')!;
    expect(family).toEqual({ id: 'one', label: 'One', version: 1, eyeStyles: ['agent-eye-v1'], shapes: ONE_KINDS, expressions: getCharacterExpressions() });
    expect(family.shapes).toHaveLength(15);
    expect(getCharacterSkins().at(-1)).toBe(family);
    for (const entry of getCharacterSkins()) if (entry.id !== 'one') expect(entry.eyeStyles).toEqual(['live-v1']);
  });

  it('refuses an eye style that belongs to another family, in options, stored appearance and descriptors', () => {
    expect(generateCharacter(did, { skin: 'one' }).eyeStyle).toBe('agent-eye-v1');
    expect(generateCharacter(did, { skin: 'one', eyeStyle: 'agent-eye-v1' }).eyeStyle).toBe('agent-eye-v1');
    expect(generateCharacter(did).eyeStyle).toBe('live-v1');
    expect(() => generateCharacter(did, { skin: 'one', eyeStyle: 'live-v1' })).toThrow('Unsupported eye style for character skin');
    expect(() => generateCharacter(did, { skin: 'autos', eyeStyle: 'agent-eye-v1' })).toThrow('Unsupported eye style for character skin');
    expect(parseCharacterAppearance({ skin: 'one', eyeStyle: 'agent-eye-v1', shape: 'star', color: 'lemon' })).toEqual({ skin: 'one', eyeStyle: 'agent-eye-v1', shape: 'star', color: 'lemon' });
    expect(() => parseCharacterAppearance({ skin: 'one', eyeStyle: 'live-v1' })).toThrow();
    expect(() => parseCharacterAppearance({ skin: 'autos', eyeStyle: 'agent-eye-v1' })).toThrow();
  });
});

describe('One looks by group', () => {
  const team: OneLook[] = [];
  for (let n = 0; n < 18; n++) team.push(nextOneLook(team));

  it('repeats from the fifteenth shape and the nineteenth colour with the least-held ones whose holders sit in another group', () => {
    // Eighteen agents, alternating groups: the Drop, Cloud, Heart and Diamond are held twice (agents 1–4 and 15–18),
    // every other shape once (the Star by the team, the Bean by the company, …), and every colour once.
    const mixed = team.map((entry, index) => ({ ...entry, group: index % 2 ? 'company' : 'team' }));
    // The least-held shape whose holders all sit in the other group, in the first allowed colour in team order whose
    // holders do too: for the team the company's Bean in the company's Berry; for the company the team's Star in the
    // team's Lime (Berry is the company's own).
    expect(nextOneLook(mixed, { group: 'team' })).toEqual({ shape: 'bean', color: 'berry' });
    expect(nextOneLook(mixed, { group: 'company' })).toEqual({ shape: 'star', color: 'lime' });
    // Fewest holders first; among those, another group; then the order: a second Berry moves the team's colour on to
    // the company's Cherry, the next single-holder colour in team order that the team does not wear.
    const berry = [...mixed, { shape: 'cloud' as const, color: 'berry' as const, group: 'company' }];
    expect(nextOneLook(berry, { group: 'team' })).toEqual({ shape: 'bean', color: 'cherry' });
    // Everyone in one group: the least held, by the order. A holder with no group is never another group.
    expect(nextOneLook(team.map(entry => ({ ...entry, group: 'team' })), { group: 'team' })).toEqual({ shape: 'star', color: 'berry' });
    expect(nextOneLook(team, { group: 'team' })).toEqual({ shape: 'star', color: 'berry' });
    // Free shapes and colours always come first, whatever the groups.
    expect(nextOneLook([{ shape: 'droplet', color: 'sky', group: 'company' }], { group: 'team' })).toEqual({ shape: 'cloud', color: 'lavender' });
    // Without a group the rule is the plain one.
    expect(nextOneLook(mixed)).toEqual({ shape: 'star', color: 'berry' });
    // A shape's never colours are never handed out, however the counts fall: with every shape held fifteen times and
    // the Drop wearing each of its fifteen allowed colours, its three never colours are the only ones nobody wears.
    const drops = teamOrder.filter(color => isOneColorAllowed('droplet', color)).map(color => ({ shape: 'droplet' as const, color }));
    const others = shapeOrder.filter(shape => shape !== 'droplet').flatMap(shape => Array.from({ length: 15 }, () => look(shape) as OneLook));
    const next = nextOneLook([...drops, ...others]);
    expect(next.shape).toBe('droplet');
    expect(isOneColorAllowed('droplet', next.color)).toBe(true);
    expect(['cherry', 'watermelon', 'berry']).not.toContain(next.color);
  });
});

describe('the light One entry', () => {
  it('renders the same still glyph as generateCharacter for the One family', () => {
    for (const kind of kinds) for (const theme of ['light', 'dark'] as const) for (const size of [16, 44, 96]) {
      for (const state of [{}, { status: 'paused', gaze: row }, { status: 'reasoning', expression: 'curious', blink: 0.3 }] as const) {
        const options = { size, theme, state, label: 'Scout, agent' };
        const still = kind === 'charcoal' ? renderOne({ did, color: 'charcoal', ...options }) : renderOne({ did, shape: kind, ...options });
        expect(still).toBe(generateCharacter(did, { skin: 'one', shape: kind, ...options }).svg);
        // Blush is allowed on every shape.
        if (kind !== 'charcoal') expect(renderOne({ did, shape: kind, color: 'blush', ...options })).toBe(generateCharacter(did, { skin: 'one', shape: kind, color: 'blush', ...options }).svg);
      }
    }
    expect(renderOne({ did })).toBe(generateCharacter(did, { skin: 'one' }).svg);
    expect(renderOne({ did, color: 'lime' })).toBe(generateCharacter(did, { skin: 'one', color: 'lime' }).svg);
    expect(renderOne({ shape: 'heart', color: 'periwinkle' })).toContain('data-one-color="periwinkle"');
    expect(renderOne({ shape: 'heart' })).toContain('data-one-color="bubblegum"');
    expect(renderOne({ did, expression: 'happy' })).toBe(generateCharacter(did, { skin: 'one', expression: 'happy' }).svg);
  });

  it('renders a blank head for a ready-made agent without a DID, in the shape it will get, and never stores or assigns one', () => {
    const blank = renderOne({ color: 'blank', size: 40, state: { gaze: row } });
    expect(blank).toContain('data-one-color="blank"');
    expect(blank).toContain('data-one-shape="squircle"');
    expect(blank).toContain(`<path data-one-disc="true" d="${oneShapeGeometry('squircle').path}" fill="#141b16" fill-opacity="0.1"/>`);
    expect(blank).toContain('fill="#5a6256"');
    expect(blank).not.toContain('data-character-seed');
    expect(blank).not.toContain('data-one-keyline');
    expect(renderOne({ color: 'blank', theme: 'dark' })).toContain('fill="#f2f1ea" fill-opacity="0.1"');
    expect(renderOne({ color: 'blank', shape: 'heart' })).toContain(`<path data-one-disc="true" d="${oneShapeGeometry('heart').path}" fill="#141b16" fill-opacity="0.1"/>`);
    expect(ONE_KINDS).not.toContain('blank');
    expect(() => parseCharacterAppearance({ skin: 'one', shape: 'blank' })).toThrow();
    expect(() => parseCharacterAppearance({ skin: 'one', shape: 'star', color: 'blank' })).toThrow();
    expect(() => generateCharacter(did, { skin: 'one', shape: 'blank' as never })).toThrow();
    expect(() => generateCharacter(did, { skin: 'one', color: 'blank' as never })).toThrow();
  });

  it('validates its options and fails closed', () => {
    for (const options of [{}, { did: 'did:oas:openagent:tool:hammer' }, { color: 'orange' }, { color: 'teal' }, { color: 'lemon' }, { shape: 'blue' }, { did, size: 15 }, { did, size: 2049 },
      { did, theme: 'dim' }, { did, label: '' }, { did, view: 'full' }, { did, shape: 'teal' }, { did, shape: 'charcoal' }, { shape: 'star', color: 'charcoal' }, { shape: 'star', color: 'cherry' },
      { did, shape: 'cloud', color: 'sky' }, { shape: 'circle' }, { did, state: { status: 'flying' } }, null]) {
      expect(() => renderOne(options as never), JSON.stringify(options)).toThrow();
    }
    expect(() => renderOne({ shape: 'star', color: 'cherry' })).toThrow('A star is never cherry');
    expect(() => renderOne({ color: 'lemon' })).toThrow('A coloured One head needs a shape or an agent DID');
    expect(() => renderOne({ did, shape: 'charcoal' } as never)).toThrow("Digital One is color: 'charcoal' and takes no shape");
    expect(() => mountOne({} as never, { shape: 'star' })).toThrow('One head requires a browser element');
  });
});

describe('One on the clock-driven animator', () => {
  it('holds still at rest and moves only on a state change, ending on the held face', () => {
    const animator = createCharacterAnimator(did, { skin: 'one', shape: 'star', size: 44, now: () => 0, state: { gaze: row } });
    const rest = animator.sample(0).one!;
    expect(rest).toMatchObject({ face: 'neutral', tier: 'M', moving: false });
    for (let t = 0; t <= 20_000; t += 500) expect(animator.sample(t).one!.moving).toBe(false);
    animator.update({ status: 'attention' }, 20_000);
    expect(animator.sample(20_100).one!.moving).toBe(true);
    const frame = animator.sample(30_000).one!;
    expect(frame).toMatchObject({ face: 'attention', moving: false });
    expect(frame.pose).toEqual(oneHeldPose('attention', row, 44));
    expect(frame.geometry).toEqual(oneGeometry(frame.pose, 'M', 'star'));
  });

  it('moves for at most five seconds of brief cadence for every temperament and size, then holds', () => {
    for (const shape of Object.values(byTemperament)) for (const size of [24, 44, 96]) {
      for (const status of ['working', 'reasoning', 'typing'] as const) for (const subject of ['did:oas:openagent:agent:a', 'did:oas:openagent:agent:b', did]) {
        const animator = createCharacterAnimator(subject, { skin: 'one', shape, size, now: () => 0, state: { gaze: row } });
        animator.update({ status }, 1000);
        let lastMoving = 0;
        for (let t = 1000; t <= 12_000; t += 10) if (animator.sample(t).one!.moving) lastMoving = t;
        expect(lastMoving, `${shape} ${size} ${status}`).toBeGreaterThan(1300);
        expect(lastMoving, `${shape} ${size} ${status}`).toBeLessThanOrEqual(1000 + 5000);
        expect(animator.sample(25_000).one!.moving).toBe(false);
      }
    }
  });

  it('replays identically for the same DID and clock', () => {
    const run = () => {
      const animator = createCharacterAnimator(did, { skin: 'one', shape: 'heart', color: 'blush', size: 96, cadence: 'repeat', now: () => 0, state: { gaze: row } });
      animator.update({ status: 'typing' }, 0);
      const out: string[] = [];
      for (let t = 0; t < 30_000; t += 50) out.push(animator.sample(t).one!.geometry.bar);
      return out;
    };
    const first = run();
    expect(run()).toEqual(first);
    expect(new Set(first).size).toBeGreaterThan(3);
  });

  it('has no motion under reduced motion, and resumes when allowed', () => {
    const animator = createCharacterAnimator(did, { skin: 'one', size: 64, reducedMotion: true, now: () => 0, state: { gaze: row } });
    animator.update({ status: 'error' }, 10);
    expect(animator.sample(20).one).toMatchObject({ face: 'error', moving: false });
    expect(animator.sample(20).one!.pose).toEqual(oneHeldPose('error', row, 64));
    animator.setReducedMotion(false, 30);
    animator.update({ status: 'success' }, 40);
    expect(animator.sample(100).one!.moving).toBe(true);
  });

  it('validates One live options and never pairs', () => {
    for (const options of [{ cadence: 'often' }, { cadence: null }, { voiceLevel: 1 }, { voiceLevel: 'loud' }, { shape: 'star', color: 'cherry' }, { shape: 'charcoal', color: 'lemon' }, { color: 'teal' }]) {
      expect(() => createCharacterAnimator(did, { skin: 'one', ...options } as never)).toThrow();
    }
    expect(createCharacterAnimator(did, { now: () => 0 }).sample(0).one).toBeUndefined();
  });
});
