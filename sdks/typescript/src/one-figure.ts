/**
 * The One avatar family, expanded: twenty-four heads in twenty-three colours, eye poses, head-fitting accessories
 * (beanie, cap, bow, headset, glasses) generated from each head's own outline, uniform limbs, and an explicit framing.
 *
 * - `framing: 'head'` (the default) is what every avatar slot uses at its current size: rows, chips, headers, cards,
 *   group stacks, notifications, call-screen avatars. A head never has limbs.
 * - `framing: 'figure'` adds the same thin ink arms and legs to every character, for large surfaces only
 *   (onboarding, empty states, an agent's page, celebrations). Limbs are never customised.
 *
 * No regression: a head with only today's options (one of the fourteen shapes, one of the eighteen colours, Digital
 * One or a blank head, no eye pose and no accessory) is `renderOne`'s output byte for byte, and its live head is
 * `mountOne`'s. The DID defaults are unchanged (`oneLookForDid` keeps the fourteen shapes and eighteen colours).
 * Digital One keeps his disc and line in every slot; he takes limbs only in figure framing and no accessory.
 */
import { barPath, barShape, poseToFrame, r2 } from './agent-eye.js';
import { M_PI, clamp, freeze, mAbs, mCos, mHypot, mMax, mMin, mPow, mSin, mSqrt, objectKeys } from './character-intrinsics.js';
import { hasOnlyKeys } from './character-record.js';
import { isAgentAvatarDid } from './avatar-did.js';
import { parseCharacterLabel } from './character-label.js';
import { ONE_SHAPE_ORDER, getOneColors, getOneShapes, isOneColor, isOneShape, levelTilt, limitPose, oneFaceFor, oneLookForDid,
  oneHeldPose, oneKeylineWidth, onePaint, oneShapeInsetPath, oneTier, escapeXml,
  type OneColor, type OneFace, type OnePose, type OneShape, type OneShapeEye, type OneTemperament, type OneTheme, type OneTier } from './character-one.js';
import { parseAvatarExpression, parseCharacterState, type AvatarExpression, type AvatarStatus, type LiveEyeState } from './character-state.js';
import { mountOne, renderOne, type OneMountOptions, type OneOptions, type OnePlayer } from './one.js';
import { ONE_NEW_SHAPES, ONE_WARM_COLORS, ONE_WARM_NEVER, type OneNewShape, type OneWarmColor } from './one-figure-shapes.js';

export type { OneNewShape, OneWarmColor } from './one-figure-shapes.js';

/** Any of the twenty-four heads. */
export type OneAvatarShape = OneShape | OneNewShape;
/** Any of the twenty-three agent colours. */
export type OneAvatarColor = OneColor | OneWarmColor;
export type OneFraming = 'head' | 'figure';
/** The One line, re-posed. Always one line, except `wide`, the only two-line pose. */
export type OneEyePose = 'neutral' | 'curious' | 'thinking' | 'blink' | 'happy' | 'asleep' | 'wide';
/** Items that sit on top of the head. A head wears at most one, plus glasses. */
export type OneHeadwear = 'beanie' | 'cap' | 'bow' | 'headset';
/** Figure motions; each has a still key pose for reduced motion. */
export type OneFigureMotion = 'stand' | 'walk' | 'wave' | 'sit' | 'hop' | 'lean' | 'doze';

/** Every avatar size the apps draw today, in CSS px. Head framing is tested at each. */
export const ONE_APP_AVATAR_SIZES: readonly number[] = freeze([16, 20, 24, 28, 32, 40, 44, 52, 56, 60, 64, 80, 88, 96]);
export const ONE_EYE_POSES: readonly OneEyePose[] = freeze(['neutral', 'curious', 'thinking', 'blink', 'happy', 'asleep', 'wide']);
export const ONE_HEADWEAR: readonly OneHeadwear[] = freeze(['beanie', 'cap', 'bow', 'headset']);
export const ONE_FIGURE_MOTIONS: readonly OneFigureMotion[] = freeze(['stand', 'walk', 'wave', 'sit', 'hop', 'lean', 'doze']);

/**
 * The 16 px distinctness floor: today's closest pair of heads (star and flower) differs by 20.25 px of coverage at
 * 16 px (this SDK's flattening; the design sheet measured 20.38 with a coarser one). Every pair of different heads, with or without headwear, must differ by at least this much; a head and
 * headwear pair that cannot is never offered (`ONE_HEADWEAR_NEVER`).
 */
export const ONE_DISTINCT_FLOOR_16PX = 20.25;
/** Colour floor for agents that share a head: the least CIEDE2000 difference under normal, protan and deutan vision. */
export const ONE_COLOR_FLOOR = 20;

/**
 * Headwear a head never wears, because at 16 px the head with it would read as another head (MUST-AV2-C2). Derived
 * by the conformance suite: in `ONE_AVATAR_SHAPE_ORDER`, item by item (beanie, cap, bow, headset, then glasses), a
 * pair is kept only when it clears `ONE_DISTINCT_FLOOR_16PX` against Digital One, every other bare head and every
 * other head's pair kept before it. Glasses clear it on every head. The list only ever grows: a pair it refuses stays
 * refused in every later version (egg cap, tulip cap, ghost cap and bow, and star headset are kept although they now
 * clear the floor), and a stored look holding a pair a later version refuses draws as the bare head
 * (`readOneAvatarLook`).
 */
export const ONE_HEADWEAR_NEVER: Readonly<Partial<Record<OneAvatarShape, readonly OneHeadwear[]>>> = freeze({
  peanut: freeze(['beanie', 'bow'] as OneHeadwear[]),
  egg: freeze(['beanie', 'cap', 'bow'] as OneHeadwear[]),
  clover: freeze(['beanie'] as OneHeadwear[]),
  hexagon: freeze(['beanie'] as OneHeadwear[]),
  squircle: freeze(['beanie'] as OneHeadwear[]),
  flower: freeze(['beanie', 'cap', 'bow', 'headset'] as OneHeadwear[]),
  tulip: freeze(['beanie', 'cap'] as OneHeadwear[]),
  cat: freeze(['beanie', 'cap'] as OneHeadwear[]),
  ghost: freeze(['cap', 'bow'] as OneHeadwear[]),
  droplet: freeze(['bow'] as OneHeadwear[]),
  star: freeze(['bow', 'headset'] as OneHeadwear[]),
  scallop: freeze(['beanie', 'headset'] as OneHeadwear[]),
});

/**
 * The order new agents take heads in: the fourteen in their team order, then the ten new heads, each with the largest
 * worst-case 16 px difference from Digital One and every earlier head (ties by library order).
 */
export const ONE_AVATAR_SHAPE_ORDER: readonly OneAvatarShape[] = freeze([...ONE_SHAPE_ORDER,
  'leaf', 'chip', 'capsule', 'house', 'mushroom', 'ghost', 'tulip', 'cat', 'scallop', 'bell'] as OneAvatarShape[]);

// ── Catalog ──────────────────────────────────────────────────────────────────────────────────────

/** A head as the catalog lists it. `version` 1 is the first fourteen (the DID defaults); 2 is the ten new heads. */
export interface OneAvatarShapeDescription {
  readonly id: OneAvatarShape;
  readonly label: string;
  readonly path: string;
  readonly eye: OneShapeEye;
  readonly mouthDy: number;
  readonly pivot: { readonly x: number; readonly y: number };
  readonly temperament: Exclude<OneTemperament, 'dry'>;
  readonly color: OneAvatarColor;
  readonly never: readonly OneAvatarColor[];
  readonly version: 1 | 2;
}
export interface OneAvatarColorDescription {
  readonly id: OneAvatarColor;
  readonly label: string;
  readonly disc: string;
  readonly eye: string;
  readonly keyline: string | null;
  readonly version: 1 | 2;
}

const SHAPES: readonly OneAvatarShapeDescription[] = freeze([
  // The fourteen keep their own fields in their own order; only the warm colours they never take are added.
  ...getOneShapes().map(s => freeze({ ...s, never: freeze([...s.never, ...(ONE_WARM_NEVER[s.id] ?? [])]), version: 1 }) as OneAvatarShapeDescription),
  ...ONE_NEW_SHAPES.map(s => freeze({ ...s, color: s.color as OneAvatarColor, never: s.never as readonly OneAvatarColor[], version: 2 as const })),
]);
const COLORS: readonly OneAvatarColorDescription[] = freeze([
  ...getOneColors().map(c => freeze({ ...c, version: 1 }) as OneAvatarColorDescription),
  ...ONE_WARM_COLORS.map(c => freeze({ ...c, version: 2 as const })),
]);
const shapeById = new Map<string, OneAvatarShapeDescription>(SHAPES.map(s => [s.id, s]));
const colorById = new Map<string, OneAvatarColorDescription>(COLORS.map(c => [c.id, c]));

/** The twenty-four heads: the fourteen in library order, then the ten new heads. */
export function getOneAvatarShapes(): readonly OneAvatarShapeDescription[] { return SHAPES; }
/** The twenty-three colours: the eighteen in team order, then the five warm colours. */
export function getOneAvatarColors(): readonly OneAvatarColorDescription[] { return COLORS; }
export function isOneAvatarShape(value: unknown): value is OneAvatarShape { return typeof value === 'string' && shapeById.has(value); }
export function isOneAvatarColor(value: unknown): value is OneAvatarColor { return typeof value === 'string' && colorById.has(value); }
export function isOneHeadwear(value: unknown): value is OneHeadwear { return ONE_HEADWEAR.includes(value as OneHeadwear); }
/** Whether `shape` may wear `color`: both known and not a never pair. */
export function isOneAvatarColorAllowed(shape: unknown, color: unknown): boolean {
  const entry = shapeById.get(shape as string);
  return entry !== undefined && isOneAvatarColor(color) && !entry.never.includes(color);
}
/** Whether `shape` may wear `headwear` (null, no headwear, always may). */
export function isOneHeadwearAllowed(shape: unknown, headwear: unknown): boolean {
  if (!isOneAvatarShape(shape)) return false;
  if (headwear === null || headwear === undefined) return true;
  return isOneHeadwear(headwear) && !(ONE_HEADWEAR_NEVER[shape] ?? []).includes(headwear);
}

// ── Looks: what the person's studio record stores ────────────────────────────────────────────────

/**
 * An agent's look as stored with its avatar in the person's own studio record: a head, a colour and, optionally, a
 * headwear item and glasses. Readers that know only `{ shape, color }` keep drawing the bare head.
 */
export interface OneAvatarLook {
  readonly shape: OneAvatarShape;
  readonly color: OneAvatarColor;
  readonly headwear?: OneHeadwear | null;
  readonly glasses?: boolean;
}

const lookKeys = ['shape', 'color', 'headwear', 'glasses'];

/** A stored look, validated: unknown values, never pairs and headwear a head never wears are refused, not changed. */
export function parseOneAvatarLook(value: unknown): OneAvatarLook { return readLook(value, false); }

/**
 * A stored look for drawing (SHOULD-79-S2): validated like `parseOneAvatarLook`, except that headwear this version
 * refuses on the head (`ONE_HEADWEAR_NEVER` only grows) is dropped, so a saved look never stops an avatar drawing; the
 * bare head is drawn instead. Malformed records still throw.
 */
export function readOneAvatarLook(value: unknown): OneAvatarLook { return readLook(value, true); }

function readLook(value: unknown, bare: boolean): OneAvatarLook {
  if (!hasOnlyKeys(value, lookKeys)) throw new TypeError('Invalid One avatar look');
  const shape = value.shape, color = value.color;
  if (!isOneAvatarShape(shape)) throw new TypeError('Unsupported One shape');
  if (!isOneAvatarColor(color)) throw new TypeError('Unsupported One colour');
  if (!isOneAvatarColorAllowed(shape, color)) throw new TypeError(`A ${shape} is never ${color}`);
  let [headwear, glasses] = accessoriesOf(value);
  if (bare && !isOneHeadwearAllowed(shape, headwear)) headwear = null;
  if (!isOneHeadwearAllowed(shape, headwear)) throw new TypeError(`A ${shape} never wears a ${headwear}`);
  return freeze({ shape, color, headwear, glasses });
}
/** Headwear (null when absent) and glasses (false when absent) from a look or avatar options, each validated. */
function accessoriesOf(value: Record<string, unknown>): [OneHeadwear | null, boolean] {
  const headwear = value.headwear ?? null, glasses = value.glasses ?? false;
  if (headwear !== null && !isOneHeadwear(headwear)) throw new TypeError('Unsupported One headwear');
  if (typeof glasses !== 'boolean') throw new TypeError('One glasses must be boolean');
  return [headwear, glasses];
}

// ── Colour difference (CIEDE2000, with protan and deutan simulation) ─────────────────────────────

type Rgb = readonly [number, number, number];
const linear = (v: number): number => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : mPow((c + 0.055) / 1.055, 2.4); };
function rgbOf(hex: string): Rgb { const n = parseInt(hex.slice(1), 16); return [linear(n >> 16 & 255), linear(n >> 8 & 255), linear(n & 255)]; }
// Machado, Oliveira and Fernandes (2009), severity 1.0, in linear RGB.
const PROTAN = [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998];
const DEUTAN = [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881];
const apply = (m: readonly number[], [r, g, b]: Rgb): Rgb =>
  [clamp(m[0]! * r + m[1]! * g + m[2]! * b, 0, 1), clamp(m[3]! * r + m[4]! * g + m[5]! * b, 0, 1), clamp(m[6]! * r + m[7]! * g + m[8]! * b, 0, 1)];
function lab([r, g, b]: Rgb): Rgb {
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047, y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number): number => t > 216 / 24389 ? mPow(t, 1 / 3) : (24389 / 27 * t + 16) / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const deg = (rad: number): number => rad * 180 / M_PI;
const rad = (d: number): number => d * M_PI / 180;
function ciede2000([l1, a1, b1]: Rgb, [l2, a2, b2]: Rgb): number {
  const c1 = mHypot(a1, b1), c2 = mHypot(a2, b2), cm = (c1 + c2) / 2;
  const g = 0.5 * (1 - mSqrt(mPow(cm, 7) / (mPow(cm, 7) + mPow(25, 7))));
  const ap1 = (1 + g) * a1, ap2 = (1 + g) * a2, cp1 = mHypot(ap1, b1), cp2 = mHypot(ap2, b2);
  const hue = (b: number, a: number): number => { if (b === 0 && a === 0) return 0; const h = deg(Math.atan2(b, a)); return h < 0 ? h + 360 : h; };
  const hp1 = hue(b1, ap1), hp2 = hue(b2, ap2);
  const dl = l2 - l1, dc = cp2 - cp1;
  let dh = 0;
  if (cp1 * cp2 !== 0) { dh = hp2 - hp1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dH = 2 * mSqrt(cp1 * cp2) * mSin(rad(dh / 2));
  const lm = (l1 + l2) / 2, cpm = (cp1 + cp2) / 2;
  let hm = hp1 + hp2;
  if (cp1 * cp2 !== 0) hm = mAbs(hp1 - hp2) > 180 ? (hp1 + hp2 < 360 ? (hp1 + hp2 + 360) / 2 : (hp1 + hp2 - 360) / 2) : (hp1 + hp2) / 2;
  const t = 1 - 0.17 * mCos(rad(hm - 30)) + 0.24 * mCos(rad(2 * hm)) + 0.32 * mCos(rad(3 * hm + 6)) - 0.2 * mCos(rad(4 * hm - 63));
  const sl = 1 + 0.015 * (lm - 50) ** 2 / mSqrt(20 + (lm - 50) ** 2), sc = 1 + 0.045 * cpm, sh = 1 + 0.015 * cpm * t;
  const rt = -2 * mSqrt(mPow(cpm, 7) / (mPow(cpm, 7) + mPow(25, 7))) * mSin(rad(60 * Math.exp(-(((hm - 275) / 25) ** 2))));
  return mSqrt((dl / sl) ** 2 + (dc / sc) ** 2 + (dH / sh) ** 2 + rt * (dc / sc) * (dH / sh));
}

/** The least CIEDE2000 difference between two agent colours under normal, protan and deutan vision. */
export function oneColorDistance(a: OneAvatarColor, b: OneAvatarColor): number {
  const ca = colorById.get(a), cb = colorById.get(b);
  if (!ca || !cb) throw new TypeError('Unsupported One colour');
  const x = rgbOf(ca.disc), y = rgbOf(cb.disc);
  return mMin(ciede2000(lab(x), lab(y)), ciede2000(lab(apply(PROTAN, x)), lab(apply(PROTAN, y))), ciede2000(lab(apply(DEUTAN, x)), lab(apply(DEUTAN, y))));
}

// ── The distinct-combo picker ────────────────────────────────────────────────────────────────────

/** An agent that already holds a look. */
export interface OneAvatarHolder {
  readonly shape: OneAvatarShape;
  readonly color: OneAvatarColor;
  readonly headwear?: OneHeadwear | null;
  readonly glasses?: boolean;
}

/**
 * The look for a person's new agent, so that a person with fifty agents and more can tell them apart at a glance:
 * - the head: the least-held head in `ONE_AVATAR_SHAPE_ORDER` (every head is used once before any repeats);
 * - the colour: the head's own colour if no agent wears it; otherwise the allowed colour farthest (CIEDE2000, worst of
 *   normal, protan and deutan vision) from every colour already on this head, then the least-held colour overall;
 * - headwear only when that head and colour are already held together: the first headwear the head may wear that
 *   makes the combination new.
 * Pass the looks of every agent the person has. Malformed holders are refused rather than ignored. The person can
 * change the result (by asking One or in the studio); the picker only chooses a starting look.
 */
export function nextOneAvatar(held: Iterable<OneAvatarHolder>): OneAvatarLook {
  if (held === null || typeof held !== 'object' || typeof (held as Iterable<unknown>)[Symbol.iterator] !== 'function') throw new TypeError('Held One looks must be iterable');
  const looks: OneAvatarLook[] = [];
  for (const entry of held as Iterable<unknown>) looks.push(readOneAvatarLook(entry));
  const shapeCount = new Map<OneAvatarShape, number>(ONE_AVATAR_SHAPE_ORDER.map(id => [id, 0]));
  const colorCount = new Map<OneAvatarColor, number>(COLORS.map(c => [c.id, 0]));
  for (const look of looks) { shapeCount.set(look.shape, shapeCount.get(look.shape)! + 1); colorCount.set(look.color, colorCount.get(look.color)! + 1); }
  let shape = ONE_AVATAR_SHAPE_ORDER[0]!;
  for (const id of ONE_AVATAR_SHAPE_ORDER) if (shapeCount.get(id)! < shapeCount.get(shape)!) shape = id;
  const entry = shapeById.get(shape)!;
  const onShape = looks.filter(look => look.shape === shape).map(look => look.color);
  const allowed = COLORS.map(c => c.id).filter(id => !entry.never.includes(id));
  let color: OneAvatarColor;
  if (onShape.length === 0 && colorCount.get(entry.color) === 0) color = entry.color;
  else {
    let best = -1, bestCount = Infinity;
    color = allowed[0]!;
    for (const id of allowed) {
      // Distances are compared in whole CIEDE2000 units, so near-equal colours fall back to how often they are held.
      const far = onShape.length === 0 ? Infinity : Math.floor(mMin(...onShape.map(other => oneColorDistance(id, other))));
      const count = colorCount.get(id)!;
      if (far > best || (far === best && count < bestCount)) { best = far; bestCount = count; color = id; }
    }
  }
  const taken = (headwear: OneHeadwear | null): boolean => looks.some(look => look.shape === shape && look.color === color && (look.headwear ?? null) === headwear);
  let headwear: OneHeadwear | null = null;
  if (taken(null)) headwear = ONE_HEADWEAR.find(item => isOneHeadwearAllowed(shape, item) && !taken(item)) ?? null;
  return freeze({ shape, color, headwear, glasses: false });
}

// ── Outline geometry (flattened, for headwear fitting, keylines and silhouettes) ─────────────────

type Pt = readonly [number, number];

/** A head path (M, H, V, L, A with circular arcs, Z) flattened to one polygon. */
export function oneFlattenPath(d: string): Pt[] {
  const tokens = d.match(/[MHVLAZ]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  const out: Pt[] = [];
  let i = 0, x = 0, y = 0, sx = 0, sy = 0, cmd = '';
  const num = (): number => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[MHVLAZ]/.test(tokens[i]!)) cmd = tokens[i++]!;
    if (cmd === 'M') { x = num(); y = num(); sx = x; sy = y; out.push([x, y]); cmd = 'L'; }
    else if (cmd === 'L') { x = num(); y = num(); out.push([x, y]); }
    else if (cmd === 'H') { x = num(); out.push([x, y]); }
    else if (cmd === 'V') { y = num(); out.push([x, y]); }
    else if (cmd === 'A') {
      const r0 = num(); num(); num(); const large = num(), sweep = num(), ex = num(), ey = num();
      const hx = (x - ex) / 2, hy = (y - ey) / 2, d2 = hx * hx + hy * hy;
      if (d2 > 1e-12) {
        const r = mMax(r0, mSqrt(d2));
        const k = (large === sweep ? -1 : 1) * mSqrt(mMax(0, r * r - d2) / d2);
        const cx = k * hy + (x + ex) / 2, cy = -k * hx + (y + ey) / 2;
        const a0 = Math.atan2(y - cy, x - cx);
        let da = Math.atan2(ey - cy, ex - cx) - a0;
        if (sweep === 1 && da < 0) da += 2 * M_PI;
        if (sweep === 0 && da > 0) da -= 2 * M_PI;
        const n = mMax(2, Math.ceil(mAbs(da) / 0.12));
        for (let s = 1; s < n; s++) out.push([cx + r * mCos(a0 + da * s / n), cy + r * mSin(a0 + da * s / n)]);
      }
      x = ex; y = ey; out.push([x, y]);
    } else if (cmd === 'Z') { x = sx; y = sy; cmd = ''; }
    else throw new TypeError('Unsupported One path');
  }
  const clean: Pt[] = [];
  for (const p of out) { const q = clean[clean.length - 1]; if (!q || mHypot(p[0] - q[0], p[1] - q[1]) > 1e-6) clean.push(p); }
  const first = clean[0]!, last = clean[clean.length - 1]!;
  if (clean.length > 1 && mHypot(first[0] - last[0], first[1] - last[1]) <= 1e-6) clean.pop();
  return clean;
}

/** The polygon moved `delta` inside its edge (clockwise outline), each corner along its bisector, capped at 3 × delta. */
function insetPolygon(poly: readonly Pt[], delta: number): Pt[] {
  const n = poly.length;
  return poly.map((p, i) => {
    const a = poly[(i - 1 + n) % n]!, b = poly[(i + 1) % n]!;
    const l1 = mHypot(p[0] - a[0], p[1] - a[1]), l2 = mHypot(b[0] - p[0], b[1] - p[1]);
    const n1: Pt = [-(p[1] - a[1]) / l1, (p[0] - a[0]) / l1], n2: Pt = [-(b[1] - p[1]) / l2, (b[0] - p[0]) / l2];
    const sx = n1[0] + n2[0], sy = n1[1] + n2[1], s2 = sx * sx + sy * sy;
    if (s2 < 1e-9) return [p[0] + n1[0] * delta, p[1] + n1[1] * delta] as Pt;
    const m = mMin(2 * delta / s2, 3 * delta);
    return [p[0] + sx * m, p[1] + sy * m] as Pt;
  });
}

const polyPath = (poly: readonly Pt[]): string => 'M' + poly.map(p => `${r2(p[0])} ${r2(p[1])}`).join('L') + 'Z';

/** The x extent of the polygon's interior on the row y, or null when the row misses it. */
function chordAt(poly: readonly Pt[], y: number): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if ((yi > y) !== (yj > y)) { const x = xi + (y - yi) * (xj - xi) / (yj - yi); lo = mMin(lo, x); hi = mMax(hi, x); }
  }
  return lo <= hi ? [lo, hi] : null;
}
/** The head's top surface: for each whole x, the highest edge point there (Infinity where the head is absent). */
function topProfile(poly: readonly Pt[]): (x: number) => number {
  const table = new Map<number, number>();
  for (let x = -100; x <= 100; x++) {
    let best = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
      if ((xi <= x && xj >= x) || (xj <= x && xi >= x)) best = mMin(best, xj === xi ? mMin(yi, yj) : yi + (x - xi) * (yj - yi) / (xj - xi));
    }
    table.set(x, best);
  }
  return x => {
    const a = Math.floor(x), t = x - a, ya = table.get(clamp(a, -100, 100)) ?? Infinity, yb = table.get(clamp(a + 1, -100, 100)) ?? Infinity;
    return ya === Infinity || yb === Infinity ? mMin(ya, yb) : ya + (yb - ya) * t;
  };
}
/** The upper convex hull of the top profile between x0 and x1, as a function of x: a hat spans lobes, it never dips into them. */
function upperHull(profile: (x: number) => number, x0: number, x1: number): (x: number) => number {
  const hull: Pt[] = [];
  for (let x = Math.ceil(x0); x <= Math.floor(x1); x++) {
    const p: Pt = [x, profile(x)];
    if (p[1] === Infinity) continue;
    while (hull.length >= 2) {
      const a = hull[hull.length - 2]!, b = hull[hull.length - 1]!;
      if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) <= 0) hull.pop(); else break;
    }
    hull.push(p);
  }
  return x => {
    if (x <= hull[0]![0]) return hull[0]![1];
    for (let i = 1; i < hull.length; i++) if (x <= hull[i]![0]) { const a = hull[i - 1]!, b = hull[i]!; return a[1] + (b[1] - a[1]) * (x - a[0]) / ((b[0] - a[0]) || 1); }
    return hull[hull.length - 1]![1];
  };
}

interface Fit {
  readonly poly: readonly Pt[];
  readonly profile: (x: number) => number;
  readonly hull: (x: number) => number;
  readonly fullHull: (x: number) => number;
  readonly apex: number;
  readonly depth: number;
  readonly xl: number;
  readonly xr: number;
  readonly eyeTop: number;
  readonly el: number;
  readonly er: number;
  /** How far below the hull the hat's edge must reach so it covers the head's own top everywhere on its span. */
  readonly under: number;
}
const fits = new Map<OneAvatarShape | 'charcoal', Fit>();

/**
 * How headwear fits a head, from the head's own outline: the hat comes down until its chord is 62 % of the head's
 * widest chord, never past the top of the eye; it spans the upper hull of the head over that chord.
 */
function fitOf(shape: OneAvatarShape): Fit {
  let fit = fits.get(shape);
  if (fit) return fit;
  const entry = shapeById.get(shape)!;
  const poly = oneFlattenPath(entry.path);
  const profile = topProfile(poly);
  const ys = poly.map(p => p[1]);
  const apex = mMin(...ys), bottom = mMax(...ys), height = bottom - apex;
  const eyeTop = entry.eye.y - 50 * entry.eye.scale - 6;
  let widest = 0;
  for (let k = 0; k <= 40; k++) { const c = chordAt(poly, apex + height * k / 40); if (c) widest = mMax(widest, c[1] - c[0]); }
  let depth = 18;
  while (depth < height * 0.42) { const c = chordAt(poly, apex + depth); if (c && c[1] - c[0] >= widest * 0.62) break; depth += 2; }
  depth = mMin(depth, eyeTop - apex);
  const [xl, xr] = chordAt(poly, apex + depth) ?? [-40, 40];
  const [el, er] = chordAt(poly, entry.eye.y) ?? [-80, 80];
  const hull = upperHull(profile, xl - 1, xr + 1);
  let under = OVERLAP;
  for (let x = Math.ceil(xl); x <= xr; x++) { const own = profile(x); if (own !== Infinity) under = mMax(under, own - hull(x) + OVERLAP); }
  fit = { poly, profile, hull, fullHull: upperHull(profile, -100, 100), apex, depth, xl, xr, eyeTop, el, er, under };
  fits.set(shape, fit);
  return fit;
}

// ── Headwear ─────────────────────────────────────────────────────────────────────────────────────

/** One part of an accessory: a filled outline (also its silhouette), or a stroke (its silhouette is the stroke's width). */
interface Part { readonly fill: string | null; readonly d: string; readonly poly: readonly Pt[]; readonly stroke?: number; readonly opacity?: number }

const HAT = { tomato: '#f2542d', sunny: '#ffc928', cream: '#fbefd5', deepblue: '#2747d6' } as const;
const CLOTH = 5; // thickness above the head
const OVERLAP = 6; // how far every hat edge reaches into the head itself, so no background shows between them (MUST-AV2-C1)

/**
 * The hat's lower edge at x: the hull lowered by the hat's depth, never higher than the head's own top plus OVERLAP
 * anywhere on the span (MUST-AV2-C1), and never past the eye. Both bounds are rising functions of the hull's height, so
 * the edge dips once and follows the hull: on a lobed head (scallop) it spans the valleys at their depth instead of
 * drawing an ink V into each one (MUST-79-C1). On a head whose top is its hull this is the head's own top plus OVERLAP.
 */
function lowEdge(f: Fit, x: number): number {
  const h = f.hull(clamp(x, f.xl, f.xr));
  const design = mMin(h + f.depth, f.apex + f.depth + (h - f.apex) * 0.35);
  return mMin(mMax(design, h + f.under), f.eyeTop);
}

/**
 * A superellipse arc of power `n` from (l, ends) to (r, ends), left to right in 33 points (k / 32 of a half turn),
 * at least `rise` tall and tall enough to stay above `above(x)` wherever it is at least 30 % of its height.
 */
function dome(l: number, r: number, ends: number, rise: number, above: (x: number) => number, n = 2): Pt[] {
  const cx = (l + r) / 2, half = (r - l) / 2;
  const at = Array.from({ length: 33 }, (_, k): Pt => {
    const c = mCos(M_PI * k / 32), x = cx - half * Math.sign(c) * mPow(mAbs(c), 2 / n), v = mPow(mSin(M_PI * k / 32), 2 / n);
    if (v > 0.3) rise = mMax(rise, (ends - above(x)) / v);
    return [x, v];
  });
  return at.map(([x, v]): Pt => [x, ends - rise * v]);
}

/**
 * A crown with its own soft dome (MUST-AV2-C3): an ellipse over the hat's span, just tall enough to clear the head's
 * hull by the cloth's thickness everywhere, so a pointed head gets a rounded hat instead of a cone that copies the point.
 * It is at least `roundness` × the half-span tall, so a beanie is a dome and a cap a shallower one, on wide heads too.
 */
function crown(f: Fit, base: (x: number) => number, roundness: number): { top: Pt[]; low: Pt[]; peak: Pt } {
  const x0 = f.xl - 4, x1 = f.xr + 4;
  const arc = dome(x0, x1, (base(x0) + base(x1)) / 2, roundness * (x1 - x0) / 2, x => f.hull(clamp(x, f.xl, f.xr)) - CLOTH);
  return { top: arc.map(([x, y]): Pt => [x, mMin(y, base(x) - 2)]), low: arc.map(([x]): Pt => [x, base(x)]), peak: arc[16]! };
}

const circlePoly = (cx: number, cy: number, r: number, n = 16): Pt[] => Array.from({ length: n }, (_, k) => [cx + r * mCos(2 * M_PI * k / n), cy + r * mSin(2 * M_PI * k / n)] as Pt);
const circlePath = (cx: number, cy: number, r: number): string => `M${r2(cx - r)} ${r2(cy)}A${r2(r)} ${r2(r)} 0 1 1 ${r2(cx + r)} ${r2(cy)}A${r2(r)} ${r2(r)} 0 1 1 ${r2(cx - r)} ${r2(cy)}Z`;
/** A polyline's stroke as a polygon strip (for silhouettes). */
function strokePoly(points: readonly Pt[], width: number): Pt[] {
  const left: Pt[] = [], right: Pt[] = [];
  points.forEach((p, i) => {
    const a = points[mMax(0, i - 1)]!, b = points[mMin(points.length - 1, i + 1)]!;
    const l = mHypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / l * width / 2, ny = (b[0] - a[0]) / l * width / 2;
    left.push([p[0] + nx, p[1] + ny]); right.push([p[0] - nx, p[1] - ny]);
  });
  return [...left, ...right.reverse()];
}
const cupPath = (cx: number, y: number): string => `M${r2(cx - 11)} ${r2(y - 9)}A11 11 0 0 1 ${r2(cx + 11)} ${r2(y - 9)}V${r2(y + 9)}A11 11 0 0 1 ${r2(cx - 11)} ${r2(y + 9)}Z`;
const linePath = (points: readonly Pt[]): string => 'M' + points.map(p => `${r2(p[0])} ${r2(p[1])}`).join('L');

function headwearParts(shape: OneAvatarShape, item: OneHeadwear): Part[] {
  const f = fitOf(shape);
  const low = (x: number): number => lowEdge(f, x);
  switch (item) {
    case 'beanie': {
      const band = (x: number): number => low(x) - 15;
      const { top, low: bandLow, peak } = crown(f, band, 0.5);
      const bandTop = bandLow.map(([x, y]) => [x, y] as Pt), bandBottom = bandLow.map(([x]) => [x, low(x)] as Pt);
      const body = [...top, ...bandBottom.slice().reverse()];
      const strip = [...bandTop, ...bandBottom.slice().reverse()];
      const pom = circlePoly(peak[0], peak[1] - 8, 13);
      const ribs = [0.2, 0.4, 0.6, 0.8].map(t => { const x = f.xl + (f.xr - f.xl) * t; return `M${r2(x)} ${r2(low(x) - 13)}V${r2(low(x) - 2)}`; }).join('');
      return [
        { fill: HAT.sunny, d: polyPath(body), poly: body },
        { fill: HAT.tomato, d: polyPath(strip), poly: strip },
        { fill: null, d: ribs, poly: [], stroke: 2.5, opacity: 0.5 },
        { fill: HAT.cream, d: circlePath(peak[0], peak[1] - 8, 13), poly: pom },
      ];
    }
    case 'cap': {
      const { top, low: edge, peak } = crown(f, low, 0.32);
      const body = [...top, ...edge.slice().reverse()];
      // The brim follows the edge's own slope, kept within about 17 degrees of level so it never droops down a steep head.
      const end = edge[edge.length - 1]!, prev = edge[edge.length - 4]!;
      const ang = clamp(Math.atan2(end[1] - prev[1], end[0] - prev[0]), -0.3, 0.3), length = 26 + (f.xr - f.xl) * 0.22;
      const cos = mCos(ang), sin = mSin(ang), nx = -sin * 9, ny = cos * 9;
      const start: Pt = [end[0] - cos * 14, end[1] - sin * 14], tip: Pt = [end[0] + cos * length, end[1] + sin * length];
      const brim: Pt[] = [start, tip, [tip[0] + nx, tip[1] + ny], [start[0] + nx, start[1] + ny]];
      return [
        { fill: HAT.tomato, d: polyPath(body), poly: body },
        { fill: HAT.tomato, d: polyPath(brim), poly: brim },
        { fill: HAT.tomato, d: circlePath(peak[0], peak[1], 5), poly: circlePoly(peak[0], peak[1], 5) },
      ];
    }
    case 'bow': {
      // The bow sits on the head's own surface (not on the hull), so it never floats over a notch.
      const x = f.xl + (f.xr - f.xl) * 0.2, y = f.profile(x) + 4;
      const g = Math.atan2(f.profile(x + 3) - f.profile(x - 3), 6);
      const s = clamp((f.xr - f.xl) / 120, 0.7, 1.1), cos = mCos(g) * s, sin = mSin(g) * s;
      const at = ([px, py]: Pt): Pt => [x + px * cos - py * sin, y + px * sin + py * cos];
      const leftWing = ([[0, 0], [-34, -18], [-34, 18]] as Pt[]).map(at), rightWing = ([[0, 0], [34, -18], [34, 18]] as Pt[]).map(at);
      const knot = at([0, 0]);
      return [
        { fill: HAT.tomato, d: polyPath(leftWing), poly: leftWing },
        { fill: HAT.tomato, d: polyPath(rightWing), poly: rightWing },
        { fill: HAT.tomato, d: circlePath(knot[0], knot[1], 8 * s), poly: circlePoly(knot[0], knot[1], 8 * s) },
      ];
    }
    case 'headset': {
      // A rigid band with its own arc (SHOULD-79-S1) from one cup to the other, just tall enough to clear the head
      // everywhere, so it rests on the crown and never copies a point; both ends sit in the cups (MUST-79-C2).
      const y = f.eyeTop + 14, l = f.el, r = f.er, base = y - 16;
      // The band's curve is a superellipse; the roundest that sits lowest wins (an arc on round heads, a squarer band
      // that hugs a head with high sides, such as the tulip, instead of a tall loop).
      let arc: Pt[] = [];
      for (const n of [2, 3, 4, 6]) {
        const at = dome(l, r, base, (r - l) * 0.3, x => f.fullHull(x) - 4, n);
        if (!arc.length || at[16]![1] > arc[16]![1] + 2) arc = at;
      }
      const cup = (cx: number): Pt[] => [[cx - 11, y - 20], [cx + 11, y - 20], [cx + 11, y + 20], [cx - 11, y + 20]];
      const mic: Pt[] = [[r, y + 16], [r - 8, y + 44], [r - 40, y + 56]];
      return [
        { fill: null, d: linePath(arc), poly: strokePoly(arc, 8), stroke: 8 },
        { fill: HAT.deepblue, d: cupPath(l, y), poly: cup(l) },
        { fill: HAT.deepblue, d: cupPath(r, y), poly: cup(r) },
        { fill: null, d: linePath(mic), poly: strokePoly(mic, 5), stroke: 5 },
      ];
    }
  }
}

function glassesParts(shape: OneAvatarShape): Part[] {
  const entry = shapeById.get(shape)!, f = fitOf(shape);
  const radius = 52 * entry.eye.scale + 6, x = entry.eye.x, y = entry.eye.y;
  const parts: Part[] = [{ fill: '#ffffff', d: circlePath(x, y, radius), poly: circlePoly(x, y, radius + 3.25), stroke: 6.5, opacity: 0.22 }];
  if (f.er - (x + radius) > 4) {
    const arm: Pt[] = [[x + radius, y - 6], [f.er, y - 14]];
    parts.push({ fill: null, d: linePath(arm), poly: strokePoly(arm, 6), stroke: 6 });
  }
  return parts;
}

/** Scale and centre so a head with headwear still fits today's square (no layout moves). */
function fitBox(polys: readonly (readonly Pt[])[]): { k: number; tx: number; ty: number } {
  let x0 = -100, x1 = 100, y0 = -100, y1 = 100;
  for (const poly of polys) for (const [x, y] of poly) { x0 = mMin(x0, x); x1 = mMax(x1, x); y0 = mMin(y0, y); y1 = mMax(y1, y); }
  if (x0 >= -100 && x1 <= 100 && y0 >= -100 && y1 <= 100) return { k: 1, tx: 0, ty: 0 };
  const k = 200 / mMax(x1 - x0, y1 - y0);
  return { k, tx: -k * (x0 + x1) / 2, ty: -k * (y0 + y1) / 2 };
}

function accessoryParts(shape: OneAvatarShape, headwear: OneHeadwear | null, glasses: boolean): Part[] {
  return [...(headwear ? headwearParts(shape, headwear) : []), ...(glasses ? glassesParts(shape) : [])];
}

/**
 * A head's silhouette with its accessories, as polygons in the head box, after the fit to today's square: what the
 * 16 px distinctness conformance case rasterises, and what native renderers can use to hit-test.
 */
export function oneAvatarSilhouette(look: OneAvatarLook): readonly (readonly Pt[])[] {
  const value = parseOneAvatarLook(look);
  return oneAvatarSilhouetteOf(value.shape, value.headwear!, value.glasses!);
}

/**
 * The silhouette of any head and headwear pair, including pairs `ONE_HEADWEAR_NEVER` refuses: the conformance suite
 * measures every pair to derive that list. Renderers never draw a refused pair.
 */
export function oneAvatarSilhouetteOf(shape: OneAvatarShape, headwear: OneHeadwear | null, glasses: boolean): readonly (readonly Pt[])[] {
  if (!isOneAvatarShape(shape) || (headwear !== null && !isOneHeadwear(headwear)) || typeof glasses !== 'boolean') throw new TypeError('Invalid One avatar silhouette');
  const head = fitOf(shape).poly;
  const parts = accessoryParts(shape, headwear, glasses);
  const polys = [head, ...parts.map(p => p.poly).filter(p => p.length > 2)];
  const { k, tx, ty } = fitBox(polys);
  return k === 1 ? polys : polys.map(poly => poly.map(([x, y]) => [x * k + tx, y * k + ty] as Pt));
}

// ── Eye poses ────────────────────────────────────────────────────────────────────────────────────

const poseFace: Readonly<Partial<Record<OneEyePose, OneFace>>> = freeze({ curious: 'curious', thinking: 'thinking', happy: 'happy', asleep: 'sleepy', wide: 'surprised' });

function placement(eye: OneShapeEye): string {
  return eye.x === 0 && eye.y === 0 && eye.scale === 1 ? '' : `translate(${r2(eye.x)} ${r2(eye.y)}) scale(${r2(eye.scale)}) `;
}

const temperamentSquash: Readonly<Record<OneTemperament, number>> = freeze({ quick: 16, bouncy: 12, neat: 8, slow: 7, dry: 8 });

/** The eye group and body transform for a still head, as `oneGeometry` draws them, for any of the twenty-four heads. */
function stillEye(pose: OnePose, tier: OneTier, entry: OneAvatarShapeDescription, eyePose: OneEyePose, color: string): { eye: string; body: string } {
  const eye = entry.eye;
  const limited = limitPose(pose, eye);
  const blink = eyePose === 'blink' ? 0.12 : 1;
  const tilt = levelTilt(pose.tilt, mMin(pose.open, eye.openMax) * blink, eye, entry.id as OneShape);
  const frame = poseToFrame({ look: limited.look, lift: limited.lift, open: limited.open * blink, tilt, smile: pose.smile, mouth: limited.mouth });
  const bar = barShape(frame);
  const at = `${placement(eye)}translate(${r2(frame.x)} ${r2(frame.y)})`;
  const stroke = (d: string, width: number): string => `<path data-one-eye="true" d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const barMark = `<path data-one-eye="true" d="${barPath(bar.n)}" fill="${color}" stroke="${color}" stroke-width="${r2(2 * bar.r)}" stroke-linejoin="round"/>`;
  let eyeSvg: string;
  const curve = eyePose === 'happy' ? 'M-32 14Q0 -30 32 14' : eyePose === 'asleep' ? 'M-32 -10Q0 32 32 -10' : null;
  if (curve) eyeSvg = `<g data-character-eyes="agent-eye-v1" data-one-eye-pose="${eyePose}" transform="${placement(eye)}">${stroke(curve, 20)}</g>`;
  else if (eyePose === 'wide') eyeSvg = `<g data-character-eyes="agent-eye-v1" data-one-eye-pose="wide" transform="${placement(eye)}"><g transform="translate(-20 0) scale(0.84)">${barMark}</g><g transform="translate(20 0) scale(0.84)">${barMark}</g></g>`;
  else eyeSvg = `<g data-character-eyes="agent-eye-v1"${eyePose === 'neutral' ? '' : ` data-one-eye-pose="${eyePose}"`} transform="${at} rotate(${r2(frame.tilt)})">${barMark}</g>`;
  const cap = tier === 'XS' ? 0 : tier === 'S' ? 3 : tier === 'M' ? 8 : temperamentSquash[entry.temperament];
  const squash = clamp(pose.squash, -cap, cap), sy = 1 + squash / 100, sx = mPow(sy, -0.5);
  const rotate = tier === 'XS' || tier === 'S' ? 0 : tier === 'M' ? clamp(pose.rotate, -8, 8) : pose.rotate;
  const body = rotate || squash
    ? `translate(${r2(entry.pivot.x)} ${r2(entry.pivot.y)}) rotate(${r2(rotate)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(${r2(-entry.pivot.x)} ${r2(-entry.pivot.y)})`
    : '';
  return { eye: eyeSvg, body };
}

// ── Options ──────────────────────────────────────────────────────────────────────────────────────

export interface OneAvatarOptions {
  /** As `renderOne`: without `shape` and `color`, the DID's default look (always one of the first fourteen). */
  readonly did?: string;
  readonly shape?: OneAvatarShape;
  /** An agent colour, 'charcoal' for Digital One, or 'blank' for a ready-made agent. */
  readonly color?: OneAvatarColor | 'charcoal' | 'blank';
  /** The head's displayed size in CSS px, 16–2048; default 512. In figure framing the figure is 1.3 × wide and 1.65 × tall. */
  readonly size?: number;
  readonly theme?: OneTheme;
  readonly label?: string;
  readonly expression?: AvatarExpression;
  readonly state?: LiveEyeState;
  /** 'head' (default) for every avatar slot; 'figure' adds the uniform limbs, for large surfaces only. */
  readonly framing?: OneFraming;
  /** A held eye pose over the state's face. Default: the state's face. */
  readonly eye?: OneEyePose;
  readonly headwear?: OneHeadwear | null;
  readonly glasses?: boolean;
  /** Figure framing only: the motion whose key pose is drawn (and which `mountOneAvatar` animates). Default: from the state. */
  readonly motion?: OneFigureMotion;
}

const avatarKeys = ['did', 'shape', 'color', 'size', 'theme', 'label', 'expression', 'state', 'framing', 'eye', 'headwear', 'glasses', 'motion'];

interface Parsed {
  readonly base: OneOptions;
  readonly identical: boolean;
  readonly framing: OneFraming;
  readonly eye: OneEyePose;
  readonly headwear: OneHeadwear | null;
  readonly glasses: boolean;
  readonly motion: OneFigureMotion | undefined;
}

function parseAvatar(options: unknown): Parsed {
  if (!hasOnlyKeys(options, avatarKeys)) throw new TypeError('Invalid One avatar options');
  const framing = options.framing ?? 'head';
  if (framing !== 'head' && framing !== 'figure') throw new TypeError("One framing is 'head' or 'figure'");
  const eye = options.eye ?? 'neutral';
  if (!ONE_EYE_POSES.includes(eye as OneEyePose)) throw new TypeError('Unsupported One eye pose');
  const [headwear, glasses] = accessoriesOf(options);
  const motion = options.motion;
  if (motion !== undefined && !ONE_FIGURE_MOTIONS.includes(motion as OneFigureMotion)) throw new TypeError('Unsupported One figure motion');
  if (motion !== undefined && framing !== 'figure') throw new TypeError('A One motion needs figure framing');
  const shape = options.shape, color = options.color;
  if (shape !== undefined && !isOneAvatarShape(shape)) throw new TypeError('Unsupported One shape');
  if (color !== undefined && color !== 'charcoal' && color !== 'blank' && !isOneAvatarColor(color)) throw new TypeError('Unsupported One colour');
  if (color === 'charcoal' && (headwear !== null || glasses || eye !== 'neutral')) throw new TypeError('Digital One wears no accessory and keeps his line');
  const baseShape = shape === undefined || isOneShape(shape);
  const baseColor = color === undefined || color === 'charcoal' || color === 'blank' || isOneColor(color);
  const base: Record<string, unknown> = {};
  // renderOne's own options: the first eight avatar keys.
  for (const key of avatarKeys.slice(0, 8)) if (options[key] !== undefined) base[key] = options[key];
  return {
    base: base as OneOptions, framing, eye: eye as OneEyePose, headwear: headwear as OneHeadwear | null, glasses, motion: motion as OneFigureMotion | undefined,
    identical: framing === 'head' && eye === 'neutral' && headwear === null && !glasses && baseShape && baseColor,
  };
}

interface Resolved {
  readonly shape: OneAvatarShape | 'charcoal';
  readonly color: OneAvatarColor | 'charcoal' | 'blank';
  readonly theme: OneTheme;
  readonly size: number;
  readonly label: string | undefined;
  readonly status: AvatarStatus;
  readonly expression: AvatarExpression;
  readonly blink: number;
  readonly gaze: { readonly x: number; readonly y: number };
}

function resolve(p: Parsed): Resolved {
  const o = p.base as Record<string, unknown>;
  const theme = o.theme ?? 'light';
  if (theme !== 'light' && theme !== 'dark') throw new TypeError('Unsupported character theme');
  const size = o.size ?? 512;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 16 || size > 2048) throw new RangeError('One size must be an integer from 16 to 2048');
  const label = o.label === undefined ? undefined : parseCharacterLabel(o.label);
  let shape = o.shape as OneAvatarShape | undefined, color = o.color as Resolved['color'] | undefined;
  if (color === 'charcoal') { if (shape !== undefined) throw new TypeError('Digital One is always the circle: give it no shape'); }
  else if (shape === undefined && color === 'blank') shape = 'squircle';
  else if (shape === undefined) {
    if (o.did === undefined) throw new TypeError(color === undefined ? 'A One head needs a shape, a colour or an agent DID' : 'A coloured One head needs a shape or an agent DID');
    // The DID's default look: always one of the first fourteen heads and eighteen colours.
    const look = oneLookForDid(o.did as string);
    shape = look.shape;
    color ??= look.color;
  }
  color ??= shapeById.get(shape!)!.color;
  if (o.did !== undefined && !isAgentAvatarDid(o.did)) throw new TypeError('One heads require an agent or agent instance DID');
  if (color !== 'charcoal' && color !== 'blank' && !isOneAvatarColorAllowed(shape, color)) throw new TypeError(`A ${shape} is never ${color}`);
  if (color !== 'charcoal' && !isOneHeadwearAllowed(shape, p.headwear)) throw new TypeError(`A ${shape} never wears a ${p.headwear}`);
  const preferred = o.expression === undefined ? 'neutral' : parseAvatarExpression(o.expression);
  const state = parseCharacterState(o.state ?? {}, preferred);
  return { shape: color === 'charcoal' ? 'charcoal' : shape!, color: color!, theme, size, label, status: state.status, expression: state.expression, blink: state.blink, gaze: state.gaze };
}

// ── Rendering ────────────────────────────────────────────────────────────────────────────────────

const INK = '#141b16', CHALK = '#f2f1ea';

function paintOf(color: Resolved['color'], theme: OneTheme): { disc: string; opacity: number; eye: string; keyline: string | null } {
  if (color === 'charcoal') throw new TypeError('Digital One is drawn by renderOne');
  if (color === 'blank' || isOneColor(color)) { const p = onePaint(color, theme); return { disc: p.disc, opacity: p.discOpacity, eye: p.eye!, keyline: p.keyline }; }
  const c = colorById.get(color)!;
  return { disc: c.disc, opacity: 1, eye: c.eye, keyline: theme === 'light' ? c.keyline : null };
}

/** The inner markup of a head (everything inside its root element), for any head, pose and accessories. */
/** The accessible name: the agent's label on the svg and as its title, or hidden when there is none. */
function named(label: string | undefined): [string, string] {
  const n = label === undefined ? undefined : escapeXml(label);
  return n === undefined ? [' aria-hidden="true" focusable="false"', ''] : [` role="img" aria-label="${n}"`, `<title>${n}</title>`];
}

function headInner(r: Resolved, p: Parsed): { root: string; inner: string; face: OneFace } {
  if (r.shape === 'charcoal' || (p.identical)) {
    const svg = renderOne(p.base);
    const open = svg.indexOf('>') + 1;
    return { root: svg.slice(0, open), inner: svg.slice(open, -'</svg>'.length), face: oneFaceFor(r) };
  }
  const entry = shapeById.get(r.shape)!;
  const tier = oneTier(r.size);
  const face = poseFace[p.eye] ?? oneFaceFor(r);
  const pose = oneHeldPose(face, r.gaze, r.size);
  const paint = paintOf(r.color, r.theme);
  const { eye, body } = stillEye(pose, tier, entry, p.eye, paint.eye);
  const ink = r.theme === 'dark' ? CHALK : INK;
  const parts = accessoryParts(r.shape, p.headwear, p.glasses);
  const { k, tx, ty } = fitBox([fitOf(r.shape).poly, ...parts.map(part => part.poly).filter(poly => poly.length > 2)]);
  const line = mMax(3.5, 0.6 * 200 / r.size) / k;
  const out: string[] = [];
  if (k !== 1) out.push(`<g data-one-fit="true" transform="translate(${r2(tx)} ${r2(ty)}) scale(${k.toFixed(4)})">`);
  out.push(`<g data-character-body="true"${body ? ` transform="${body}"` : ''}>`);
  out.push(`<path data-one-disc="true" d="${entry.path}" fill="${paint.disc}"${paint.opacity === 1 ? '' : ` fill-opacity="${paint.opacity}"`}/>`);
  if (paint.keyline !== null) {
    const width = oneKeylineWidth(r.size) / k;
    const d = entry.version === 1 ? oneShapeInsetPath(entry.id as OneShape, width / 2) : polyPath(insetPolygon(fitOf(r.shape).poly, width / 2));
    out.push(`<path data-one-keyline="true" d="${d}" fill="none" stroke="${paint.keyline}" stroke-width="${r2(width)}"/>`);
  }
  out.push(eye);
  if (parts.length) {
    out.push(`<g data-one-accessories="${[p.headwear, p.glasses ? 'glasses' : null].filter(Boolean).join(' ')}" aria-hidden="true">`);
    for (const part of parts) {
      const width = r2(part.stroke ?? line);
      out.push(part.fill === null
        ? `<path d="${part.d}" fill="none" stroke="${ink}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${part.opacity === undefined ? '' : ` opacity="${part.opacity}"`}/>`
        : `<path d="${part.d}" fill="${part.fill}"${part.opacity === undefined ? '' : ` fill-opacity="${part.opacity}"`} stroke="${ink}" stroke-width="${part.stroke === undefined ? r2(line) : width}" stroke-linejoin="round"/>`);
    }
    out.push('</g>');
  }
  out.push('</g>');
  if (k !== 1) out.push('</g>');
  const [access, title] = named(r.label);
  const root = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -100 200 200" width="${r.size}" height="${r.size}" overflow="visible"${access} data-character-skin="one" data-character-version="2" data-character-shape="${r.shape}" data-character-expression="${r.expression}" data-character-theme="${r.theme}" data-one-shape="${r.shape}" data-one-color="${r.color}" data-one-face="${face}" data-one-tier="${tier}" data-one-framing="head"${p.headwear ? ` data-one-headwear="${p.headwear}"` : ''}${p.glasses ? ' data-one-glasses="true"' : ''}>`;
  return { root, inner: title + out.join(''), face };
}

// ── Figure: uniform limbs and motion ─────────────────────────────────────────────────────────────

/**
 * Live-state motion, as data so web and iOS animate from the same numbers. Periods in ms at the bouncy/neat pace;
 * temperament scales them (quick 0.85, slow 1.25). Every motion has a still key pose for reduced motion.
 */
export const ONE_FIGURE_MOTION = freeze({
  walk: freeze({ periodMs: 900, legSwingDeg: 14, armSwingDeg: 14, bob: 5, ease: 'ease-in-out', iterations: Infinity }),
  wave: freeze({ periodMs: 3600, swings: 3, swingMs: 1100, armRestDeg: -120, armSwingDeg: -142, ease: 'ease-in-out', iterations: 2 }),
  sit: freeze({ periodMs: 4000, breathe: 0.015, feetMs: 2400, feetDeg: 3, ease: 'ease-in-out', iterations: Infinity }),
  hop: freeze({ periodMs: 630, squash: 0.9, rise: 40, ease: 'cubic-bezier(.3,0,.2,1)', iterations: 1 }),
  lean: freeze({ periodMs: 1600, leanDeg: 7, nodDeg: 2, inMs: 400, ease: 'ease-out', iterations: Infinity }),
  doze: freeze({ periodMs: 5000, breathe: 0.015, ease: 'ease-in-out', iterations: Infinity }),
  stand: freeze({ periodMs: 4000, breathe: 0.01, ease: 'ease-in-out', iterations: Infinity }),
});
export const ONE_TEMPERAMENT_TEMPO: Readonly<Record<OneTemperament, number>> = freeze({ quick: 0.85, bouncy: 1, neat: 1, slow: 1.25, dry: 1 });

/** The figure motion for a runtime status: working walks, listening leans in, done hops, idle sits, paused dozes. */
export function oneFigureMotionFor(status: AvatarStatus): OneFigureMotion {
  switch (status) {
    case 'working': case 'typing': return 'walk';
    case 'listening': case 'speaking': return 'lean';
    case 'success': case 'happy': case 'excited': case 'proud': return 'hop';
    case 'paused': case 'offline': case 'sleepy': return 'doze';
    case 'idle': case 'reasoning': case 'thoughtful': return 'sit';
    default: return 'stand';
  }
}

const motionEye: Readonly<Partial<Record<OneFigureMotion, OneEyePose>>> = freeze({ wave: 'happy', hop: 'happy', doze: 'asleep', lean: 'curious' });

/** Where limbs attach on a head, generated from its outline (never tuned per app). */
function limbAnchors(shape: OneAvatarShape | 'charcoal'): { hip: number; hipY: number; shoulder: number; shoulderY: number } {
  const poly = shape === 'charcoal' ? oneFlattenPath('M0 -100A100 100 0 0 1 0 100A100 100 0 0 1 0 -100Z') : fitOf(shape).poly;
  const bottom = mMax(...poly.map(p => p[1]));
  const shoulderY = 18, hipY = bottom - 6;
  const sc = chordAt(poly, shoulderY) ?? [-80, 80], hc = chordAt(poly, bottom - 20) ?? [-40, 40];
  return { hip: clamp((hc[1] - hc[0]) * 0.22, 18, 34), hipY, shoulder: mMax(mAbs(sc[0]), sc[1]) - 4, shoulderY };
}

const GROUND = 206;

function limbs(shape: OneAvatarShape | 'charcoal', motion: OneFigureMotion, ink: string): { back: string; front: string } {
  const a = limbAnchors(shape);
  const w = 7, line = `fill="none" stroke="${ink}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
  const legLength = GROUND - a.hipY - 8;
  const sitting = motion === 'sit' || motion === 'doze';
  const legPath = sitting ? `M0 0L14 ${r2(legLength * 0.45)}L30 ${r2(legLength * 0.5)}` : `M0 0V${r2(legLength)}`;
  const foot = sitting ? [30, legLength * 0.5] : [0, legLength];
  const shoe = `<ellipse cx="${r2(foot[0]! + 6)}" cy="${r2(foot[1]! + 2)}" rx="15" ry="9" fill="${ink}"/>`;
  const legAngle = motion === 'walk' ? ONE_FIGURE_MOTION.walk.legSwingDeg : motion === 'hop' ? 22 : 0;
  const leg = (side: 'l' | 'r', angle: number): string =>
    `<g data-one-part="leg-${side}" transform="translate(${r2(side === 'l' ? -a.hip : a.hip)} ${r2(a.hipY)})"><g data-one-limb="true" transform="rotate(${r2(angle)})"><path d="${legPath}" ${line}/>${shoe}</g></g>`;
  const armDrop = 58;
  const armPath = (dir: 1 | -1): string => `M0 0Q${r2(dir * 22)} ${r2(armDrop * 0.45)} ${r2(dir * 26)} ${r2(armDrop)}`;
  const hand = (dir: 1 | -1): string => `<circle cx="${r2(dir * 26)}" cy="${r2(armDrop)}" r="6" fill="${ink}"/>`;
  const armAngle = (side: 'l' | 'r'): number => motion === 'walk' ? (side === 'l' ? 1 : -1) * ONE_FIGURE_MOTION.walk.armSwingDeg : 0;
  const arm = (side: 'l' | 'r'): string => {
    const dir = side === 'l' ? -1 : 1;
    const angle = motion === 'wave' && side === 'r' ? ONE_FIGURE_MOTION.wave.armRestDeg : armAngle(side);
    return `<g data-one-part="arm-${side}" transform="translate(${r2(dir * a.shoulder)} ${r2(a.shoulderY)})"><g data-one-limb="true" transform="rotate(${r2(angle)})"><path d="${armPath(dir)}" ${line}/>${hand(dir)}</g></g>`;
  };
  // Walking legs scissor; hopping legs spread outward (positive turns the left foot further left).
  return { back: motion === 'hop' ? leg('l', legAngle) + leg('r', -legAngle) : leg('l', -legAngle) + leg('r', legAngle), front: arm('l') + arm('r') };
}

// ── Public rendering ─────────────────────────────────────────────────────────────────────────────

/**
 * A One avatar as a still, self-contained SVG. Head framing (the default) is a head in today's square at the given
 * size: with only today's options it is `renderOne`'s output byte for byte. Figure framing adds the uniform limbs
 * under the head in a 260 × 330 box (1.3 × the size wide, 1.65 × tall) with the motion's key pose; the head sits where
 * it would in head framing. Limbs and accessories are decorative; the accessible name stays the agent's name.
 */
export function renderOneAvatar(options: OneAvatarOptions): string {
  const p = parseAvatar(options);
  if (p.identical) return renderOne(p.base);
  const r = resolve(p);
  if (p.framing === 'head') { const { root, inner } = headInner(r, p); return root + inner + '</svg>'; }
  const motion = p.motion ?? oneFigureMotionFor(r.status);
  const eyePose = p.eye !== 'neutral' || r.color === 'charcoal' ? p.eye : motionEye[motion] ?? 'neutral';
  const head = headInner(r, { ...p, eye: eyePose, identical: false });
  const ink = r.theme === 'dark' ? CHALK : INK;
  const { back, front } = limbs(r.shape, motion, ink);
  const temperament = r.shape === 'charcoal' ? 'dry' : shapeById.get(r.shape)!.temperament;
  const [access, title] = named(r.label);
  const inner = head.inner.replace(/^<title>[^<]*<\/title>/, '');
  const lift = motion === 'hop' ? -ONE_FIGURE_MOTION.hop.rise / 2 : motion === 'sit' || motion === 'doze' ? 30 : 0;
  const lean = motion === 'lean' ? ` rotate(${ONE_FIGURE_MOTION.lean.leanDeg} 0 ${GROUND})` : '';
  const z = motion === 'doze' ? `<path data-one-part="z" d="M70 -96H86L70 -80H86" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-130 -110 260 330" width="${r2(r.size * 1.3)}" height="${r2(r.size * 1.65)}" overflow="visible"${access} data-character-skin="one" data-character-version="2" data-one-framing="figure" data-one-figure="true" data-one-motion="${motion}" data-one-temperament="${temperament}" data-one-shape="${r.shape === 'charcoal' ? 'circle' : r.shape}" data-one-color="${r.color}">` +
    title +
    `<g data-one-part="figure"${lean ? ` transform="${lean.trim()}"` : ''}><g data-one-part="body" transform="translate(0 ${lift})">` +
    `<g data-one-limbs="true" aria-hidden="true">${back}</g><g data-one-part="head">${inner}</g><g data-one-limbs="true" aria-hidden="true">${front}</g>${z}</g></g></svg>`;
}

/** Head-only renders at every app avatar size (16–96 px) for one look: what an avatar slot draws at each size. */
export function renderOneAvatarSizes(options: Omit<OneAvatarOptions, 'size' | 'framing' | 'motion'>): ReadonlyMap<number, string> {
  if ((options as { framing?: unknown }).framing !== undefined) throw new TypeError('Avatar slot renders are always head framing');
  return new Map(ONE_APP_AVATAR_SIZES.map(size => [size, renderOneAvatar({ ...options, size, framing: 'head' })]));
}

// ── Motion CSS and the live figure ───────────────────────────────────────────────────────────────

/**
 * The stylesheet that animates figures (and only figures): transforms on the body, limbs and z, paced by
 * temperament, paused while `data-one-paused` is set (offscreen or hidden) and still under reduced motion, where each
 * motion shows its key pose. Hosts add it once per document; `mountOneAvatar` does.
 */
export function oneFigureCss(): string {
  const m = ONE_FIGURE_MOTION, F = '[data-one-figure]';
  const dur = (ms: number): string => `calc(${ms}ms * var(--one-tempo, 1))`;
  const tempo = objectKeys(ONE_TEMPERAMENT_TEMPO).map(t => `${F}[data-one-temperament="${t}"]{--one-tempo:${ONE_TEMPERAMENT_TEMPO[t as OneTemperament]}}`).join('');
  return tempo +
    `@keyframes one-walk-l{0%,100%{transform:rotate(${-m.walk.legSwingDeg}deg)}50%{transform:rotate(${m.walk.legSwingDeg}deg)}}` +
    `@keyframes one-walk-r{0%,100%{transform:rotate(${m.walk.legSwingDeg}deg)}50%{transform:rotate(${-m.walk.legSwingDeg}deg)}}` +
    `@keyframes one-bob{0%,50%,100%{transform:translateY(0)}25%,75%{transform:translateY(${-m.walk.bob}px)}}` +
    `@keyframes one-wave{0%,${r2(100 * m.wave.swingMs / m.wave.periodMs)}%,100%{transform:rotate(${m.wave.armRestDeg}deg)}${[1, 2].map(i => `${r2(100 * m.wave.swingMs * i / m.wave.swings / m.wave.periodMs)}%{transform:rotate(${m.wave.armRestDeg}deg)}`).join('')}${[1, 2, 3].map(i => `${r2(100 * m.wave.swingMs * (i - 0.5) / m.wave.swings / m.wave.periodMs)}%{transform:rotate(${m.wave.armSwingDeg}deg)}`).join('')}}` +
    `@keyframes one-breathe{0%,100%{transform:scale(1)}50%{transform:scale(${1 + m.sit.breathe},${1 + m.sit.breathe * 2})}}` +
    `@keyframes one-feet{0%,100%{transform:rotate(${-m.sit.feetDeg}deg)}50%{transform:rotate(${m.sit.feetDeg}deg)}}` +
    `@keyframes one-hop{0%{transform:translateY(0) scale(1,1)}19%{transform:translateY(0) scale(1.05,${m.hop.squash})}60%{transform:translateY(${-m.hop.rise}px) scale(1,1)}76%{transform:translateY(0) scale(1.05,${m.hop.squash})}100%{transform:translateY(0) scale(1,1)}}` +
    `@keyframes one-nod{0%,100%{transform:rotate(0)}50%{transform:rotate(${m.lean.nodDeg}deg)}}` +
    `@keyframes one-z{0%{opacity:0;transform:translate(0,8px)}30%{opacity:1}100%{opacity:0;transform:translate(6px,-14px)}}` +
    `${F} [data-one-part="body"]{transform-box:view-box;transform-origin:0 ${GROUND}px}` +
    `${F}[data-one-motion="walk"] [data-one-part="leg-l"]>g{animation:one-walk-l ${dur(m.walk.periodMs)} ${m.walk.ease} infinite}` +
    `${F}[data-one-motion="walk"] [data-one-part="leg-r"]>g,${F}[data-one-motion="walk"] [data-one-part="arm-l"]>g{animation:one-walk-r ${dur(m.walk.periodMs)} ${m.walk.ease} infinite}` +
    `${F}[data-one-motion="walk"] [data-one-part="arm-r"]>g{animation:one-walk-l ${dur(m.walk.periodMs)} ${m.walk.ease} infinite}` +
    `${F}[data-one-motion="walk"] [data-one-part="head"]{animation:one-bob ${dur(m.walk.periodMs)} ${m.walk.ease} infinite}` +
    `${F}[data-one-motion="wave"] [data-one-part="arm-r"]>g{animation:one-wave ${dur(m.wave.periodMs)} ${m.wave.ease} ${m.wave.iterations}}` +
    `${F}[data-one-motion="sit"] [data-one-part="head"],${F}[data-one-motion="stand"] [data-one-part="head"]{transform-box:fill-box;transform-origin:50% 100%;animation:one-breathe ${dur(m.sit.periodMs)} ${m.sit.ease} infinite}` +
    `${F}[data-one-motion="doze"] [data-one-part="head"]{transform-box:fill-box;transform-origin:50% 100%;animation:one-breathe ${dur(m.doze.periodMs)} ${m.doze.ease} infinite}` +
    `${F}[data-one-motion="sit"] [data-one-part^="leg"]>g{animation:one-feet ${dur(m.sit.feetMs)} ${m.sit.ease} infinite}` +
    `${F}[data-one-motion="hop"] [data-one-part="body"]{animation:one-hop ${dur(m.hop.periodMs)} ${m.hop.ease} 1 both}` +
    `${F}[data-one-motion="lean"] [data-one-part="head"]{transform-box:fill-box;transform-origin:50% 100%;animation:one-nod ${dur(m.lean.periodMs)} ${m.lean.ease} infinite}` +
    `${F}[data-one-motion="doze"] [data-one-part="z"]{transform-box:fill-box;animation:one-z ${dur(m.doze.periodMs)} ease-out infinite}` +
    `${F}[data-one-paused] *{animation-play-state:paused!important}` +
    `${F}[data-one-still] *{animation:none!important}` +
    `@media (prefers-reduced-motion:reduce){${F} *{animation:none!important}}`;
}

export interface OneAvatarMountOptions extends Omit<OneAvatarOptions, 'did'> {
  /** As `mountOne`: false holds the avatar still, like reduced motion. */
  readonly animated?: boolean;
  /** Defaults to the operating system's reduced-motion preference. */
  readonly reducedMotion?: boolean | 'system';
  /** Passed to `mountOne` for today's heads. */
  readonly cadence?: OneMountOptions['cadence'];
  readonly group?: string;
  readonly follow?: boolean;
}

export interface OneAvatarPlayer {
  /** Redraw with new options (the same keys as mounting). */
  update(options: OneAvatarMountOptions): void;
  dispose(): void;
}

const mountExtra = ['animated', 'reducedMotion', 'cadence', 'group', 'follow'];

/**
 * A live One avatar in `element`. Head framing with only today's options is `mountOne` (today's live head, every
 * existing animation kept). Anything else is the still avatar; in figure framing it is animated by `oneFigureCss`,
 * paused while offscreen or while the page is hidden, and still under reduced motion.
 */
export function mountOneAvatar(element: Element, options: OneAvatarMountOptions): OneAvatarPlayer {
  if (!element || element.nodeType !== 1 || !element.ownerDocument?.defaultView) throw new TypeError('One avatar requires a browser element');
  const doc = element.ownerDocument, win = doc.defaultView!;
  let current: { head: OnePlayer } | { observer: IntersectionObserver | null; onVisibility: () => void } | null = null;
  const teardown = (): void => {
    if (current && 'head' in current) current.head.dispose();
    else if (current) { current.observer?.disconnect(); doc.removeEventListener('visibilitychange', current.onVisibility); }
    current = null;
  };
  const draw = (value: OneAvatarMountOptions): void => {
    if (!hasOnlyKeys(value, [...avatarKeys.filter(k => k !== 'did'), ...mountExtra])) throw new TypeError('Invalid One avatar options');
    const { animated, reducedMotion } = value, still = Object.fromEntries(Object.entries(value).filter(([key]) => !mountExtra.includes(key)));
    const parsed = parseAvatar(still);
    teardown();
    if (parsed.identical) {
      const live: Record<string, unknown> = { ...parsed.base };
      for (const key of mountExtra) if ((value as Record<string, unknown>)[key] !== undefined) live[key] = (value as Record<string, unknown>)[key];
      element.replaceChildren();
      current = { head: mountOne(element, live as OneMountOptions) };
      return;
    }
    const svg = renderOneAvatar(still as OneAvatarOptions);
    const holder = doc.createElement('template');
    holder.innerHTML = svg;
    const root = holder.content.firstElementChild!;
    if (parsed.framing === 'figure') {
      if (!doc.querySelector('style[data-one-figure-css]')) {
        const style = doc.createElement('style');
        style.setAttribute('data-one-figure-css', 'true');
        style.textContent = oneFigureCss();
        doc.head.append(style);
      }
      const reduced = reducedMotion === true || (reducedMotion !== false && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
      if (animated === false || reduced) root.setAttribute('data-one-still', 'true');
    }
    element.replaceChildren(root);
    let visible = true;
    const sync = (): void => { if (visible && doc.visibilityState !== 'hidden') root.removeAttribute('data-one-paused'); else root.setAttribute('data-one-paused', 'true'); };
    const observer = typeof win.IntersectionObserver === 'function' && parsed.framing === 'figure'
      ? new win.IntersectionObserver(entries => { for (const entry of entries) visible = entry.isIntersecting; sync(); }) : null;
    observer?.observe(element);
    doc.addEventListener('visibilitychange', sync);
    sync();
    current = { observer, onVisibility: sync };
  };
  draw(options);
  let disposed = false;
  return {
    update(next) { if (disposed) throw new Error('One avatar is disposed'); draw(next); },
    dispose() { if (disposed) return; disposed = true; teardown(); element.replaceChildren(); },
  };
}
