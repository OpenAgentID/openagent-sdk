/**
 * agent-eye: the pure geometry and motion math of One's animated mark, a disc
 * with one bar for an eye.
 *
 * Provenance: a line-for-line TypeScript port of the pure exports of
 * `agent-eye.js`, sha256
 * 83cc379a706b86899c56b41813030a721110071dbcd11274ebdc146a40b8bba4. agent-eye is
 * written by JR and is copyright L1fe Labs, Inc., which contributes it to this
 * repository under Apache-2.0 OR MIT. The byte-identical master is kept
 * as a test fixture (test/fixtures/agent-eye) and the port is checked against
 * it. Only the pure functions are ported: the master's <agent-eye> custom
 * element is not part of the SDK, so importing this module never touches a DOM.
 *
 * Coordinates: the disc has radius 100 in a `-100 -100 200 200` viewBox.
 */

export const GEOMETRY = Object.freeze({
  radius: 100,
  barWidth: 200 / 9,
  barHeight: 400 / 3,
  cornerRadius: 200 / 45,
});

export const MOTION = Object.freeze({
  maxTurn: 55,
  turnRadius: 70,
  foreshorten: 0.8,
  maxLift: 14,
  closedHeight: 7,
  lidSquash: 0.3,
  safeRadius: 89,
  smileLift: 2.5,
  smileSquint: 35,
  squeeze: 1,
  bend: 1,
});

export const MOUTH = Object.freeze({
  y: 66,
  halfWidth: 44,
  birthHalfWidth: 20,
  thickness: 200 / 9,
  born: 3,
  follow: 0.6,
  minGap: 6,
});

/** A face pose: look -1 left … 1 right, lift -1 up … 1 down, open 0 shut … 1 rest (above 1 is wide). */
export interface AgentEyePose {
  readonly look?: number;
  readonly lift?: number;
  readonly open?: number;
  /** Degrees, clockwise. */
  readonly tilt?: number;
  readonly smile?: number;
  readonly mouth?: number;
}

export interface AgentEyeBar {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly k: number;
  readonly tilt: number;
}

export interface AgentEyeMouth {
  readonly mx: number;
  readonly my: number;
  readonly ma: number;
  readonly mt: number;
  readonly mo: number;
}

export type AgentEyeFrame = AgentEyeBar & AgentEyeMouth;

export const REST = Object.freeze({ look: 0, lift: 0, open: 1, tilt: 0, smile: 0, mouth: 0 });

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Two-decimal rounding, as the master writes path numbers. */
export function r2(n: number): number {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? 0 : v;
}

export function poseToBar({ look = 0, lift = 0, open = 1, tilt = 0, smile = 0 }: AgentEyePose = {}): AgentEyeBar {
  const turn = clamp(look, -1, 1) * MOTION.maxTurn * DEG;
  const x = MOTION.turnRadius * Math.sin(turn);
  const y = clamp(lift, -1, 1) * MOTION.maxLift - (MOTION.smileLift + MOTION.smileSquint / 2) * smile;
  const shut = 1 - clamp(open, 0, 1);
  const w =
    GEOMETRY.barWidth *
    (1 - MOTION.foreshorten * (1 - Math.cos(turn))) *
    (1 + MOTION.lidSquash * shut);
  let h = Math.max(
    MOTION.closedHeight,
    MOTION.closedHeight + (GEOMETRY.barHeight - MOTION.closedHeight) * Math.max(0, open) - MOTION.smileSquint * smile,
  );
  h *= 1 - MOTION.squeeze * (1 - Math.sqrt(1 - (x / GEOMETRY.radius) ** 2));
  h = fitHeight(x, y, w, h, tilt);
  return { x, y, w, h, k: bendAt(x, h), tilt };
}

function bendAt(x: number, h: number): number {
  const lat = Math.asin(Math.min(1, h / 2 / GEOMETRY.radius));
  return MOTION.bend * x * (1 - Math.cos(lat));
}

export interface AgentEyeBarShape {
  readonly r: number;
  readonly a: number;
  readonly b: number;
  readonly n: readonly [number, number, number, number, number, number];
}

export function barShape({ w, h, k = 0 }: { readonly w: number; readonly h: number; readonly k?: number }): AgentEyeBarShape {
  const r = Math.min(GEOMETRY.cornerRadius, h / 2, w / 2);
  const a = w / 2 - r;
  const b = h / 2 - r;
  return { r, a, b, n: [-a - k, -b, a - k, a + k, b, -a + k] };
}

export function barPath([left, top, right, bulge, bottom, back]: readonly number[]): string {
  return `M${r2(left!)} ${r2(top!)}H${r2(right!)}Q${r2(bulge!)} 0 ${r2(right!)} ${r2(bottom!)}H${r2(left!)}Q${r2(back!)} 0 ${r2(left!)} ${r2(top!)}Z`;
}

function barExtents(x: number, y: number, w: number, h: number, tilt: number): { r: number; points: [number, number][] } {
  const { r, a, b } = barShape({ w, h });
  const k = bendAt(x, h);
  const c = Math.cos(tilt * DEG);
  const s = Math.sin(tilt * DEG);
  const local: [number, number][] = [[a - k, -b], [a - k, b], [-a - k, -b], [-a - k, b], [a, 0], [-a, 0]];
  return { r, points: local.map(([px, py]) => [x + px * c - py * s, y + px * s + py * c]) };
}

function fitHeight(x: number, y: number, w: number, h: number, tilt: number): number {
  const inside = (hh: number): boolean => {
    const { r, points } = barExtents(x, y, w, hh, tilt);
    return points.every(([px, py]) => Math.hypot(px, py) + r <= MOTION.safeRadius);
  };
  if (inside(h)) return h;
  let lo = 0;
  let hi = h;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inside(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function poseToMouth({ look = 0, lift = 0, mouth = 0 }: AgentEyePose = {}): AgentEyeMouth {
  const M = MOUTH;
  const m = Math.max(0, mouth);
  if (m === 0) return { mx: 0, my: M.y + M.born, ma: M.birthHalfWidth, mt: M.thickness, mo: 0 };
  const turn = clamp(look, -1, 1) * MOTION.maxTurn * DEG;
  const mx = M.follow * MOTION.turnRadius * Math.sin(turn);
  const my = M.y + M.born * (1 - Math.min(1, m)) + 0.5 * clamp(lift, -1, 1) * MOTION.maxLift;
  const mt = M.thickness;
  const r = GEOMETRY.cornerRadius;
  let ma = (M.birthHalfWidth + (M.halfWidth - M.birthHalfWidth) * m) * (1 - 0.5 * (1 - Math.cos(turn)));
  const reach = (a: number): number => Math.hypot(Math.abs(mx) + a - r, my + mt / 2 - r) + r;
  if (reach(ma) > MOTION.safeRadius) {
    let lo = 0, hi = ma;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (reach(mid) > MOTION.safeRadius) hi = mid;
      else lo = mid;
    }
    ma = lo;
  }
  return { mx, my, ma, mt, mo: clamp((m - 0.05) / 0.4, 0, 1) };
}

/** The master's poseToFrame without its rainbow layer, which the SDK does not draw. */
export function poseToFrame(pose: AgentEyePose): AgentEyeFrame {
  const p = { ...REST, ...pose };
  return { ...poseToBar(p), ...poseToMouth(p) };
}

export const EASE = Object.freeze({
  linear: [0, 0, 1, 1],
  shut: [0.6, 0, 0.9, 0.55],
  snap: [0.1, 0.9, 0.25, 1],
  settle: [0.3, 0, 0.3, 1],
  glide: [0.45, 0, 0.25, 1],
  emerge: [0.2, 0.6, 0.35, 1],
  charge: [0.4, 0, 0.2, 1],
  exit: [0.45, 0, 0.7, 0.9],
} as const);

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number): number => ((ay * t + by) * t + cy) * t;
  const dx = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x;
      if (Math.abs(err) < 1e-7) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0, hi = 1;
    t = x;
    while (hi - lo > 1e-7) {
      if (sx(t) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

/** A curve key: [seconds, value, ease into this key]. */
export type AgentEyeKey = readonly [number, number, (keyof typeof EASE)?];

/** One blink: 80 ms close, 50 ms shut, 170 ms open with a little overshoot. Values multiply openness. */
export const BLINK: readonly AgentEyeKey[] = Object.freeze([[0, 1], [0.08, 0, 'shut'], [0.13, 0], [0.3, 1.04, 'snap'], [0.42, 1, 'settle']] as const);

/** The smile, 2.9 s: the eye shortens upward while a second line grows under it, one happy pulse, then back. */
export const SMILE: Readonly<{ smile: readonly AgentEyeKey[]; mouth: readonly AgentEyeKey[] }> = Object.freeze({
  smile: Object.freeze([[0, 0], [0.36, 1, 'glide'], [1.3, 1], [1.46, 1.12, 'snap'], [1.76, 1, 'settle'], [2.2, 1], [2.7, -0.06, 'glide'], [2.9, 0, 'settle']] as const),
  mouth: Object.freeze([[0, 0], [0.2, 0], [0.46, 0.8, 'emerge'], [0.62, 1.04, 'snap'], [0.82, 1, 'settle'], [1.3, 1], [1.46, 1.05, 'snap'], [1.76, 1, 'settle'], [2.05, 1], [2.26, 0.12, 'glide'], [2.32, 0]] as const),
});
