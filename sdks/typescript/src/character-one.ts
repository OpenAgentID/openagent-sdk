/**
 * The One family: fourteen fun shapes in eighteen colours for agents, and Digital One, the black circle, for
 * One itself. Every head wears One's single-line eye, drawn only from agent-eye's geometry (see agent-eye.ts
 * for provenance) and placed by the shape library (character-one-shapes.ts); nothing is redrawn. The family
 * also has a blank head for ready-made agents that are not anybody yet, a still glyph for static and
 * reduced-motion rendering, and the faces that the shared live status timeline maps to.
 *
 * A shape and a colour are identity, never status: a One keeps its look whatever its state. State is carried by
 * the face. Digital One is always the circle and always `#141b16`, on every surface; no agent is a circle and no
 * agent is black. A never pair (a shape in a colour that would turn it into a sign) is refused, never changed.
 */
import { blake3 } from '@noble/hashes/blake3';
import { barPath, barShape, GEOMETRY, poseToFrame, r2, type AgentEyeFrame } from './agent-eye.js';
import { isAgentAvatarDid } from './avatar-did.js';
import { ONE_CIRCLE, ONE_COLORS, ONE_DIGITAL, ONE_SHAPES, ONE_SHAPE_ORDER, ONE_PATH_COMMANDS,
  type OneColor, type OneColorDescription, type OneShape, type OneShapeDescription, type OneShapeEye, type OneShapeGeometry, type OneTemperament } from './character-one-shapes.js';
import { expressionForStatus, type AvatarExpression, type AvatarStatus } from './character-state.js';

export { ONE_DIGITAL, ONE_SHAPE_ORDER } from './character-one-shapes.js';
export type { OneColor, OneColorDescription, OneShape, OneShapeDescription, OneShapeEye, OneShapeGeometry, OneTemperament } from './character-one-shapes.js';

/** A One kind, as stored and as the catalog lists it: an agent shape, or 'charcoal' for Digital One (One itself). */
export type OneKind = OneShape | 'charcoal';
/**
 * What a head is painted as: an agent colour, 'charcoal' for Digital One, or 'blank' for a ready-made agent that has
 * not been added yet. A blank head is presentation only: it is never stored, never a DID default and never assigned.
 */
export type OneHeadColor = OneColor | 'charcoal' | 'blank';
export type OneTheme = 'light' | 'dark';
/** An agent's look: a shape and a colour it is allowed in. */
export interface OneLook {
  readonly shape: OneShape;
  readonly color: OneColor;
}

/** The eye colours: paper on the deep colours, ink on the bright ones; never taken from the surface. */
export const ONE_EYE_LIGHT = '#fbfaf6';
export const ONE_EYE_INK = '#141b16';
/** A blank head: the surface's ink at 10 % for the disc and the muted text tone for the eye (AVATARS.md §1.1). */
export const ONE_BLANK = Object.freeze({
  light: Object.freeze({ disc: '#141b16', discOpacity: 0.1, eye: '#5a6256' }),
  dark: Object.freeze({ disc: '#f2f1ea', discOpacity: 0.1, eye: '#a9b2a2' }),
});
/** The shape a blank head is drawn as when the agent's own shape is not known yet. */
export const ONE_BLANK_SHAPE: OneShape = 'squircle';

const shapeIds: readonly OneShape[] = Object.freeze(ONE_SHAPES.map(entry => entry.id));
const colorIds: readonly OneColor[] = Object.freeze(ONE_COLORS.map(entry => entry.id));
const shapeById = new Map<OneShape, OneShapeDescription>(ONE_SHAPES.map(entry => [entry.id, entry]));
const colorById = new Map<OneColor, OneColorDescription>(ONE_COLORS.map(entry => [entry.id, entry]));
/** Catalog kinds for the One family: the fourteen shapes in library order, then Digital One. */
export const ONE_KINDS: readonly OneKind[] = Object.freeze([...shapeIds, 'charcoal'] as const);

/** The fourteen shapes in library order, each with its path, eye placement and limits, pivot, temperament, own colour and never list. */
export function getOneShapes(): readonly OneShapeDescription[] {
  return ONE_SHAPES;
}

/** The eighteen agent colours in team order, one value each for every surface, with the eye and the light-surface keyline. */
export function getOneColors(): readonly OneColorDescription[] {
  return ONE_COLORS;
}

export function isOneShape(value: unknown): value is OneShape {
  return typeof value === 'string' && (shapeIds as readonly string[]).includes(value);
}

export function isOneColor(value: unknown): value is OneColor {
  return typeof value === 'string' && (colorIds as readonly string[]).includes(value);
}

export function isOneKind(value: unknown): value is OneKind {
  return value === 'charcoal' || isOneShape(value);
}

export function isOneHeadColor(value: unknown): value is OneHeadColor {
  return value === 'charcoal' || value === 'blank' || isOneColor(value);
}

/** Whether `shape` may wear `color`: a known shape, a known colour, and not a never pair. */
export function isOneColorAllowed(shape: unknown, color: unknown): boolean {
  return isOneShape(shape) && isOneColor(color) && !shapeById.get(shape)!.never.includes(color);
}

function shapeOf(shape: OneShape): OneShapeDescription {
  const entry = shapeById.get(shape);
  if (!entry) throw new TypeError('Unsupported One shape');
  return entry;
}

/** The pace of a kind's moves: the shape's temperament; Digital One is dry. */
export function oneTemperament(kind: OneKind): OneTemperament {
  return kind === 'charcoal' ? 'dry' : shapeOf(kind).temperament;
}

/** The geometry a kind is drawn with: the shape's, or Digital One's circle. */
export function oneShapeGeometry(kind: OneKind): OneShapeGeometry {
  return kind === 'charcoal' ? ONE_CIRCLE : shapeOf(kind);
}

/** The drawn shape's id for host styles: the shape, or `circle` for Digital One. */
export function oneShapeId(kind: OneKind): OneShape | 'circle' {
  return kind === 'charcoal' ? 'circle' : shapeOf(kind).id;
}

/** The colour at team index `index` for `shape`, stepping forward past the shape's never colours. */
function colorAt(shape: OneShapeDescription, index: number): OneColor {
  const n = colorIds.length;
  for (let step = 0; step < n; step++) {
    const color = colorIds[(((index + step) % n) + n) % n]!;
    if (!shape.never.includes(color)) return color;
  }
  throw new TypeError(`${shape.id} allows no colour`);
}

const encoder = new TextEncoder();

/** The character seed shared with every family: BLAKE3 over `oaid-character-v1\0one\0<did>`. */
export function oneSeed(did: string): Uint8Array {
  return blake3(encoder.encode(`oaid-character-v1\u0000one\u0000${did}`));
}

function agentSeed(did: string): Uint8Array {
  if (!isAgentAvatarDid(did)) throw new TypeError('One looks require an agent or agent instance DID');
  return oneSeed(did);
}

const u32le = (seed: Uint8Array, offset: number): number =>
  (seed[offset]! | seed[offset + 1]! << 8 | seed[offset + 2]! << 16 | seed[offset + 3]! << 24) >>> 0;

/**
 * The deterministic default shape for an agent DID: the seed's bytes 4–7 as a little-endian unsigned integer, modulo
 * fourteen, indexing library order. Digital One is never a default. Display only: a look neither identifies nor
 * authenticates the agent.
 */
export function oneShapeForDid(did: string): OneShape {
  return shapeIds[u32le(agentSeed(did), 4) % shapeIds.length]!;
}

/**
 * The deterministic default colour for an agent DID: the seed's first four bytes as a little-endian unsigned integer,
 * modulo eighteen, indexing team order, stepped forward past the DID's default shape's never colours.
 */
export function oneColorForDid(did: string): OneColor {
  const seed = agentSeed(did);
  return colorAt(shapeOf(shapeIds[u32le(seed, 4) % shapeIds.length]!), u32le(seed, 0) % colorIds.length);
}

/** The deterministic default look for an agent DID: `oneShapeForDid` and `oneColorForDid` together. */
export function oneLookForDid(did: string): OneLook {
  return Object.freeze({ shape: oneShapeForDid(did), color: oneColorForDid(did) });
}

/** An agent that already holds a look, with the group it sits in (for example a team or a company). */
export interface OneLookHolder {
  readonly shape: OneShape;
  readonly color: OneColor;
  readonly group?: string;
}

function parseGroup(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 200) throw new TypeError('One look groups must be 1–200 characters');
  return value;
}

/** The least-held candidate; among those, with a group, one whose holders all sit in other groups; ties by `order`. */
function leastHeld<T extends string>(order: readonly T[], counts: ReadonlyMap<T, number>, shared: ReadonlySet<T>, grouped: boolean): T {
  let chosen = order[0]!;
  for (const id of order) {
    const count = counts.get(id)!;
    const best = counts.get(chosen)!;
    if (count < best || (count === best && grouped && shared.has(chosen) && !shared.has(id))) chosen = id;
  }
  return chosen;
}

/**
 * The look for a new agent (the plan of record, §5.3): the first shape in the team shape order that nobody in `held`
 * has, in that shape's own colour if nobody wears it; otherwise the first free colour in team order that the shape
 * allows. When every shape is held, the least-held shape; when every allowed colour is held, the least-held allowed
 * colour; among those, with `options.group`, one whose holders all sit in other groups (a holder without a group is
 * never counted as another group); ties by the order. Pass the looks of every agent in the same scope as
 * `{ shape, color, group? }` holders. Unknown values, never pairs and malformed holders are refused rather than ignored.
 */
export function nextOneLook(held: Iterable<OneLookHolder>, options?: { readonly group?: string }): OneLook {
  if (held === null || typeof held !== 'object' || typeof (held as Iterable<unknown>)[Symbol.iterator] !== 'function') {
    throw new TypeError('Held One looks must be iterable');
  }
  if (options !== undefined && (options === null || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => key !== 'group'))) throw new TypeError('Invalid One look options');
  const group = options?.group === undefined ? undefined : parseGroup(options.group);
  const shapeCounts = new Map<OneShape, number>(shapeIds.map(id => [id, 0]));
  const colorCounts = new Map<OneColor, number>(colorIds.map(id => [id, 0]));
  const sharedShapes = new Set<OneShape>(), sharedColors = new Set<OneColor>();
  for (const entry of held as Iterable<unknown>) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry) ||
        Object.keys(entry).some(key => key !== 'shape' && key !== 'color' && key !== 'group')) throw new TypeError('Invalid One look holder');
    const holder = entry as Record<string, unknown>;
    if (!isOneShape(holder.shape)) throw new TypeError('Unsupported One shape');
    if (!isOneColor(holder.color)) throw new TypeError('Unsupported One colour');
    if (!isOneColorAllowed(holder.shape, holder.color)) throw new TypeError(`A ${holder.shape} is never ${holder.color}`);
    const holderGroup = holder.group === undefined ? undefined : parseGroup(holder.group);
    shapeCounts.set(holder.shape, shapeCounts.get(holder.shape)! + 1);
    colorCounts.set(holder.color, colorCounts.get(holder.color)! + 1);
    if (holderGroup === undefined || holderGroup === group) { sharedShapes.add(holder.shape); sharedColors.add(holder.color); }
  }
  const shape = shapeOf(leastHeld(ONE_SHAPE_ORDER, shapeCounts, sharedShapes, group !== undefined));
  const allowed = colorIds.filter(id => !shape.never.includes(id));
  const color = colorCounts.get(shape.color) === 0 ? shape.color : leastHeld(allowed, colorCounts, sharedColors, group !== undefined);
  return Object.freeze({ shape: shape.id, color });
}

export interface OnePaint {
  readonly disc: string;
  /** Below 1 only for a blank head, whose disc is a tint of the surface's ink. */
  readonly discOpacity: number;
  /** Null for Digital One on a light surface, whose eye is knocked out of the disc to show the surface. */
  readonly eye: string | null;
  /** The colour's keyline on light surfaces; null on dark surfaces, on the deep colours, on blank heads and on Digital One. */
  readonly keyline: string | null;
  /** Digital One's chalk rim on dark surfaces; null everywhere else. */
  readonly rim: { readonly color: string; readonly opacity: number } | null;
}

/** The paint for a head colour on a surface. Agents have one disc on both themes; Digital One is black on both. */
export function onePaint(color: OneHeadColor, theme: OneTheme): OnePaint {
  if (color === 'charcoal') {
    return theme === 'dark'
      ? { disc: ONE_DIGITAL.disc, discOpacity: 1, eye: ONE_DIGITAL.eye.dark, keyline: null, rim: { color: ONE_DIGITAL.rim.color, opacity: ONE_DIGITAL.rim.opacity } }
      : { disc: ONE_DIGITAL.disc, discOpacity: 1, eye: ONE_DIGITAL.eye.light, keyline: null, rim: null };
  }
  if (color === 'blank') {
    const blank = ONE_BLANK[theme];
    return { disc: blank.disc, discOpacity: blank.discOpacity, eye: blank.eye, keyline: null, rim: null };
  }
  const entry = colorById.get(color);
  if (!entry) throw new TypeError('Unsupported One colour');
  return { disc: entry.disc, discOpacity: 1, eye: entry.eye, keyline: theme === 'light' ? entry.keyline : null, rim: null };
}

// ── Faces ────────────────────────────────────────────────────────────────────────────────────────

/** Faces for runtime activities; an expression override shows that expression's face instead. */
export type OneActivityFace = 'idle' | 'listening' | 'thinking' | 'working' | 'typing' | 'speaking' |
  'done' | 'attention' | 'waiting' | 'paused' | 'offline' | 'error';
export type OneFace = OneActivityFace | AvatarExpression;

const activityFaces: Readonly<Record<string, OneActivityFace>> = Object.freeze({
  idle: 'idle', listening: 'listening', reasoning: 'thinking', working: 'working', typing: 'typing',
  speaking: 'speaking', success: 'done', attention: 'attention', blocked: 'waiting', paused: 'paused',
  offline: 'offline', error: 'error',
});

/**
 * The face for a resolved runtime state. An activity status shows its own face unless an explicit
 * expression override differs from that status's mapped expression; expression statuses and overrides
 * show the expression's face.
 */
export function oneFaceFor(state: { readonly status: AvatarStatus; readonly expression: AvatarExpression }): OneFace {
  const activity = Object.hasOwn(activityFaces, state.status) ? activityFaces[state.status] : undefined;
  if (activity && state.expression === expressionForStatus(state.status)) return activity;
  return state.expression;
}

/** Pose channels: agent-eye's face channels plus a body squash (%), rotation (degrees) and hop (fraction of the size, negative is up). */
export interface OnePose {
  readonly look: number;
  readonly lift: number;
  readonly open: number;
  readonly tilt: number;
  readonly smile: number;
  readonly mouth: number;
  readonly squash: number;
  readonly rotate: number;
  readonly hop: number;
}
export type OneChannel = keyof OnePose;
/** agent-eye's REST pose: the mark itself. Property order is the channel order. */
export const ONE_NEUTRAL: OnePose = Object.freeze({ look: 0, lift: 0, open: 1, tilt: 0, smile: 0, mouth: 0, squash: 0, rotate: 0, hop: 0 });
// Derive internal property keys rather than repeating string literals. The standalone
// browser build can then shorten pose properties without changing public state fields.
export const ONE_CHANNELS: readonly OneChannel[] = Object.freeze(Object.keys(ONE_NEUTRAL) as OneChannel[]);
export const ONE_FACE_CHANNELS: readonly OneChannel[] = Object.freeze(ONE_CHANNELS.slice(0, 6));
export const ONE_BODY_CHANNELS: readonly OneChannel[] = Object.freeze(ONE_CHANNELS.slice(6));

export type OneTier = 'XS' | 'S' | 'M' | 'L';
/** Size tiers: XS 16–20 px holds faces only; S 24–36 moves the face; M 40–52 adds a little body; L 64+ is fully expressive. */
export function oneTier(px: number): OneTier {
  return px <= 20 ? 'XS' : px <= 36 ? 'S' : px <= 52 ? 'M' : 'L';
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function heldPose(look = 0, lift = 0, open = 1, tilt = 0, squash = 0, rotate = 0): OnePose {
  return Object.freeze({ look: clamp(look, -1, 1), lift: clamp(lift, -1, 1), open, tilt,
    smile: 0, mouth: 0, squash, rotate, hop: 0 });
}

/**
 * The held face. `gaze` is where the head's content is: a One at rest looks there, so a row passes
 * the direction of its name (for example `{ x: 0.4, y: 0.1 }`) and a centred header looks down at
 * its thread (`{ x: 0, y: 0.3 }`). With no content direction (`{ x: 0, y: 0 }`, a hero) idle and
 * neutral show the warm face at the viewer, so the centred, slightly wide needs-you face stays the only
 * one that looks straight out. A negative gaze.x mirrors every face for right-to-left content.
 */

export function oneHeldPose(face: OneFace, gaze: { readonly x: number; readonly y: number }, px: number): OnePose {
  const d = gaze.x < 0 ? -1 : 1;
  const gx = gaze.x, gy = gaze.y;
  switch (face) {
    case 'idle': case 'neutral': return gx === 0 && gy === 0 ? heldPose(0, 0, 0.92, 5) : heldPose(gx, gy);
    case 'listening': return heldPose(0, -0.05, 1.04);
    case 'thinking': case 'thoughtful': return heldPose(0.25 * d, -0.45, 0.58, -8 * d);
    case 'working': return heldPose(0.3 * d, 0.3, 0.72);
    case 'typing': return heldPose(0.15 * d, 0.55, 0.8);
    case 'speaking': return heldPose(0.08 * d, 0, 0.92, 5 * d);
    case 'done': case 'happy': return heldPose(Math.abs(gx) < 0.08 ? 0.08 * d : gx, gy, 0.92, 5 * d);
    case 'attention': return heldPose(0, 0, 1.06);
    case 'waiting': return heldPose(0.2 * d, -0.4);
    case 'paused': case 'sleepy':
      // Below 64 px a closed lid is under a pixel, so smaller heads doze with a visible eye.
      return px >= 64 ? heldPose(0, 0.35, 0, 10 * d, -4, 6 * d) : heldPose(-0.1 * d, 0.4, 0.42, 12 * d);
    case 'offline': return heldPose(-0.5 * d, 0.15, 0.9);
    case 'error': case 'sad': return heldPose(-0.35 * d, 0.4, 0.85, -5 * d);
    case 'attentive': return heldPose(gx, gy, 1.06);
    case 'surprised': return heldPose(gx * 0.5, gy - 0.1, 1.15);
    case 'excited': return heldPose(gx, gy - 0.15, 1.1, 6 * d);
    case 'laughing': return heldPose(gx, gy - 0.1, 0.6, 8 * d);
    // One never shows anger or fear: a narrowed eye and a startled glance away.
    case 'angry': return heldPose(gx, gy, 0.62);
    case 'scared': return heldPose(-0.3 * d, 0.1, 1.12);
    case 'suspicious': return heldPose(0.55 * d, 0, 0.55);
    case 'confused': return heldPose(-0.2 * d, -0.2, 0.9, -12 * d);
    case 'curious': return heldPose(0.32 * d, -0.2, 0.8, -10 * d);
    case 'proud': return heldPose(gx, -0.25, 0.85, 6 * d);
    case 'shy': return heldPose(-0.45 * d, 0.45, 0.8, 8 * d);
    case 'unimpressed': return heldPose(gx, gy, 0.45);
    case 'concerned': return heldPose(gx * 0.5, 0.2, 0.9, -7 * d);
    default: throw new TypeError('Unsupported One face');
  }
}


// ── Geometry ─────────────────────────────────────────────────────────────────────────────────────

export interface OneGeometry {
  /** Eye group transform: the shape's eye placement (translate and scale, absent for the circle), then agent-eye's translate to the bar's centre and tilt. */
  readonly eye: string;
  /** Bar outline path, stroked with round joins at `strokeWidth` so its corners match the mark. */
  readonly bar: string;
  readonly strokeWidth: number;
  /** The smile line, present only while it is visible and the head is 40 px or more. */
  readonly mouth: { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly rx: number; readonly opacity: number } | null;
  /** Body transform around the shape's pivot, or empty at rest. */
  readonly body: string;
}

const temperamentSquash: Readonly<Record<OneTemperament, number>> = Object.freeze({ quick: 16, bouncy: 12, neat: 8, slow: 7, dry: 8 });

/**
 * A pose with a shape's limits applied, as agent-eye is asked for it: look × lookGain, lift × liftGain, open capped at
 * openMax then × openScale (the bar's length in this shape; a blink still reaches 0), mouth × mouthMax.
 */
export function limitPose<P extends { readonly look?: number; readonly lift?: number; readonly open?: number; readonly mouth?: number }>(pose: P, eye: OneShapeEye): P & { readonly open: number } {
  const limited = { ...pose } as { -readonly [K in keyof P]: P[K] } & { open: number };
  if (limited.look !== undefined) limited.look = (limited.look as number) * eye.lookGain as P['look'];
  if (limited.lift !== undefined) limited.lift = (limited.lift as number) * eye.liftGain as P['lift'];
  limited.open = Math.min(pose.open ?? 1, eye.openMax) * eye.openScale;
  if (limited.mouth !== undefined) limited.mouth = (limited.mouth as number) * eye.mouthMax as P['mouth'];
  return limited;
}

/** agent-eye's blink overshoot: the widest eye the library measured tilted. Wider eyes were measured level. */
const WIDE = 1.04;

/**
 * The tilt an agent shape keeps at `open` (before the bar's scale): every tilt up to the blink's overshoot, fading to
 * level at `openMax`, because the library measured wide eyes level (its `wide` frames) and tilts only up to 1.04 (its
 * `base` frames). Digital One's circle is agent-eye's own mark and keeps every tilt.
 */
export function levelTilt(tilt: number, open: number, eye: OneShapeEye, kind: OneKind): number {
  if (kind === 'charcoal' || open <= WIDE || eye.openMax <= WIDE) return tilt;
  return tilt * Math.max(0, 1 - (Math.min(open, eye.openMax) - WIDE) / (eye.openMax - WIDE));
}

/** agent-eye's frame for a pose in a kind's shape: the shape's limits and its level wide eye applied, then `blink` (1 is open). */
export function oneFrame(pose: OnePose, blink: number, kind: OneKind): AgentEyeFrame {
  const eye = oneShapeGeometry(kind).eye;
  const limited = limitPose(pose, eye);
  const tilt = levelTilt(pose.tilt, Math.min(pose.open, eye.openMax) * blink, eye, kind);
  return poseToFrame({ look: limited.look, lift: limited.lift, open: limited.open * blink, tilt, smile: pose.smile, mouth: limited.mouth });
}

/** The eye group's placement in a shape: translate then scale, or nothing for the circle's identity placement. */
function placement(eye: OneShapeEye): string {
  return eye.x === 0 && eye.y === 0 && eye.scale === 1 ? '' : `translate(${r2(eye.x)} ${r2(eye.y)}) scale(${r2(eye.scale)}) `;
}

/** Drawn geometry for a pose at a size tier, in a kind's shape; body motion is capped per tier and paced by the shape's temperament. */
export function oneGeometry(pose: OnePose, tier: OneTier, kind: OneKind, blink = 1): OneGeometry {
  const geometry = oneShapeGeometry(kind);
  const frame = oneFrame(pose, blink, kind);
  const shape = barShape(frame);
  // No smile or mouth line below 40 px: at 24 px and smaller the line under the bar reads as "!" (R8).
  const visible = frame.mo > 0.001 && (tier === 'M' || tier === 'L');
  const cap = tier === 'XS' ? 0 : tier === 'S' ? 3 : tier === 'M' ? 8 : temperamentSquash[oneTemperament(kind)];
  const squash = clamp(pose.squash, -cap, cap);
  const sy = 1 + squash / 100;
  const sx = Math.pow(sy, -0.5);
  const rotate = tier === 'XS' || tier === 'S' ? 0 : tier === 'M' ? clamp(pose.rotate, -8, 8) : pose.rotate;
  const hop = tier === 'XS' || tier === 'S' ? 0 : (tier === 'M' ? clamp(pose.hop, -0.08, 0.08) : clamp(pose.hop, -0.2, 0.2)) * 2 * GEOMETRY.radius;
  const pivot = geometry.pivot;
  const body = hop || rotate || squash
    ? `translate(${r2(pivot.x)} ${r2(pivot.y + hop)}) rotate(${r2(rotate)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(${r2(-pivot.x)} ${r2(-pivot.y)})`
    : '';
  return {
    eye: `${placement(geometry.eye)}translate(${r2(frame.x)} ${r2(frame.y)}) rotate(${r2(frame.tilt)})`,
    bar: barPath(shape.n),
    strokeWidth: r2(2 * shape.r),
    mouth: visible ? { x: r2(frame.mx - frame.ma), y: r2(frame.my + geometry.mouthDy - frame.mt / 2), width: r2(2 * frame.ma),
      height: r2(frame.mt), rx: r2(GEOMETRY.cornerRadius), opacity: r2(frame.mo) } : null,
    body,
  };
}

/**
 * The eye as drawn (agent-eye's bar path stroked at twice its corner radius with round joins) as one closed
 * outline in disc coordinates. The stroked bar is every point within the corner radius of the bar's filled
 * outline, whose rows run from `-a - c·y²` to `a - c·y²` for |y| ≤ b; the outline is that set sampled row by
 * row (finely around the rounded ends), then turned and moved as the eye group is and placed in the shape's eye
 * box. A still Digital One cuts it out of its disc with the even-odd rule, so it needs no mask and no element
 * identifier.
 */
export function oneEyeOutline(frame: AgentEyeFrame, eye: OneShapeEye = ONE_CIRCLE.eye): string {
  const { r, a, b } = barShape(frame);
  const k = frame.k;
  const flat = b < 1e-6;
  const c = flat ? 0 : k / (b * b);
  // A bar with no straight sides is a segment at y = 0 whose quadratic ends reach out to ±a.
  const left = (y: number): number => flat ? Math.min(-a - k, -a) : -a - c * y * y;
  const right = (y: number): number => flat ? Math.max(a - k, a) : a - c * y * y;
  const rows: number[] = [];
  const caps = 10, middle = Math.max(2, Math.ceil(2 * b / 3));
  for (let i = 0; i < caps; i++) rows.push(-b - r * Math.cos(i / caps * Math.PI / 2));
  for (let i = 0; i <= middle; i++) rows.push(-b + 2 * b * i / middle);
  for (let i = caps - 1; i >= 0; i--) rows.push(b + r * Math.cos(i / caps * Math.PI / 2));
  const extent = (row: number, side: 1 | -1): number => {
    const lo = Math.max(-b, row - r), hi = Math.min(b, row + r);
    let best = side * -Infinity;
    for (let i = 0; i <= 48; i++) {
      const y = lo + (hi - lo) * i / 48;
      const reach = Math.sqrt(Math.max(0, r * r - (y - row) * (y - row)));
      const x = side === 1 ? right(y) + reach : left(y) - reach;
      best = side === 1 ? Math.max(best, x) : Math.min(best, x);
    }
    return best;
  };
  const local: [number, number][] = [];
  for (const row of rows) local.push([extent(row, 1), row]);
  for (let i = rows.length - 1; i >= 0; i--) local.push([extent(rows[i]!, -1), rows[i]!]);
  const cos = Math.cos(frame.tilt * Math.PI / 180), sin = Math.sin(frame.tilt * Math.PI / 180);
  const points = local.map(([x, y]) => `${r2(eye.x + eye.scale * (frame.x + x * cos - y * sin))} ${r2(eye.y + eye.scale * (frame.y + x * sin + y * cos))}`);
  return `M${points.join('L')}Z`;
}


/** Keyline width in viewBox units: one CSS pixel, two at 96 px and above, one device pixel below 24 px. */
export function oneKeylineWidth(px: number, devicePixelRatio = 1): number {
  const width = px < 24 ? 1 / Math.max(1, devicePixelRatio) : px >= 96 ? 2 : 1;
  return width * 2 * GEOMETRY.radius / px;
}

/** Digital One's rim width in viewBox units: one CSS pixel, two at 96 px and above, never reduced to a device pixel (R2). */
export function oneRimWidth(px: number): number {
  return (px >= 96 ? 2 : 1) * 2 * GEOMETRY.radius / px;
}

// ── The outline, inset ───────────────────────────────────────────────────────────────────────────

type Point = readonly [number, number];
type Segment =
  | { readonly type: 'L'; readonly from: Point; readonly to: Point }
  | { readonly type: 'A'; readonly from: Point; readonly to: Point; readonly r: number; readonly large: 0 | 1; readonly sweep: 0 | 1; readonly centre: Point };

const number = /-?(?:\d+\.?\d*|\.\d+)/g;

/** The centre of a circular SVG arc from its endpoints and flags (SVG 1.1 F.6.5, with equal radii and no rotation). */
function arcCentre(from: Point, to: Point, r: number, large: 0 | 1, sweep: 0 | 1): Point {
  const hx = (from[0] - to[0]) / 2, hy = (from[1] - to[1]) / 2;
  const d2 = hx * hx + hy * hy;
  if (d2 > r * r * (1 + 1e-6)) throw new TypeError('One shape arc radius is smaller than its chord');
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, r * r - d2) / d2);
  return [k * hy + (from[0] + to[0]) / 2, -k * hx + (from[1] + to[1]) / 2];
}

/** The segments of a library path: one closed subpath of M, H, V, L, A and Z, clockwise, as absolute lines and circular arcs. */
export function oneOutlineSegments(path: string): readonly Segment[] {
  const segments: Segment[] = [];
  let start: Point | null = null, current: Point | null = null, closed = false;
  for (const match of path.matchAll(/([MLHVAZ])([^MLHVAZ]*)/g)) {
    const command = match[1]!;
    const values = (match[2]!.match(number) ?? []).map(Number);
    if (closed) throw new TypeError('One shape paths have one subpath');
    if (command === 'M') {
      if (start !== null || values.length !== 2) throw new TypeError('One shape paths start with one M');
      start = current = [values[0]!, values[1]!];
      continue;
    }
    if (current === null || start === null) throw new TypeError('One shape paths start with M');
    if (command === 'Z') {
      if (values.length) throw new TypeError('Z takes no values');
      if (Math.hypot(current[0] - start[0], current[1] - start[1]) > 1e-9) segments.push({ type: 'L', from: current, to: start });
      closed = true;
      continue;
    }
    if (command === 'A') {
      if (values.length !== 7) throw new TypeError('One shape arcs take seven values');
      const [rx, ry, rotation, large, sweep, x, y] = values as [number, number, number, number, number, number, number];
      if (rx !== ry || rx <= 0 || rotation !== 0 || (large !== 0 && large !== 1) || (sweep !== 0 && sweep !== 1)) throw new TypeError('One shape arcs are circular');
      const to: Point = [x, y];
      if (Math.hypot(to[0] - current[0], to[1] - current[1]) > 1e-9) {
        segments.push({ type: 'A', from: current, to, r: rx, large: large as 0 | 1, sweep: sweep as 0 | 1, centre: arcCentre(current, to, rx, large as 0 | 1, sweep as 0 | 1) });
      }
      current = to;
      continue;
    }
    const to: Point = command === 'L' ? [values[0]!, values[1]!] : command === 'H' ? [values[0]!, current[1]] : [current[0], values[0]!];
    if (values.length !== (command === 'L' ? 2 : 1) || values.some(value => !Number.isFinite(value))) throw new TypeError('One shape lines take finite values');
    if (Math.hypot(to[0] - current[0], to[1] - current[1]) > 1e-9) segments.push({ type: 'L', from: current, to });
    current = to;
  }
  if (!closed || segments.length === 0) throw new TypeError('One shape paths are closed');
  return segments;
}

/**
 * The outline moved `delta` units inside the edge: every convex arc keeps its centre and loses `delta` of radius, every
 * concave fillet gains it, and every line moves inward along its normal. A belt of tangent arcs and lines stays a belt,
 * so the pieces still meet. Stroked at `2 × delta`, this is a keyline or a rim that never grows the silhouette.
 */
export function oneInsetPath(path: string, delta: number): string {
  return insetSegments(oneOutlineSegments(path), delta);
}

const catalogSegments = new Map<OneKind, readonly Segment[]>();

/** Inset a validated catalog kind without loading the general SVG path grammar. */
export function oneShapeInsetPath(kind: OneKind, delta: number): string {
  let segments = catalogSegments.get(kind);
  if (!segments) {
    const shape = oneShapeGeometry(kind);
    const values = shape.path.match(number)!.map(Number);
    const commands = ONE_PATH_COMMANDS[kind === 'charcoal' ? shapeIds.length : shapeIds.indexOf(kind)]!;
    let current: Point = [values[0]!, values[1]!], offset = 2;
    const built: Segment[] = [];
    for (const command of commands) {
      if (command === 'A') {
        const r = values[offset]!, large = values[offset + 3]! as 0 | 1, sweep = values[offset + 4]! as 0 | 1;
        const to: Point = [values[offset + 5]!, values[offset + 6]!];
        offset += 7;
        if (Math.hypot(to[0] - current[0], to[1] - current[1]) > 1e-9) built.push({ type: 'A', from: current, to, r, large, sweep, centre: arcCentre(current, to, r, large, sweep) });
        current = to;
      } else {
        const to: Point = command === 'L' ? [values[offset++]!, values[offset++]!] : command === 'H' ? [values[offset++]!, current[1]] : [current[0], values[offset++]!];
        if (Math.hypot(to[0] - current[0], to[1] - current[1]) > 1e-9) built.push({ type: 'L', from: current, to });
        current = to;
      }
    }
    segments = built;
    catalogSegments.set(kind, segments);
  }
  return insetSegments(segments, delta);
}

function insetSegments(segments: readonly Segment[], delta: number): string {
  if (!(delta >= 0) || !Number.isFinite(delta)) throw new RangeError('One inset must be a finite, non-negative number');
  const moved = (segment: Segment, point: Point): Point => {
    if (segment.type === 'L') {
      const dx = segment.to[0] - segment.from[0], dy = segment.to[1] - segment.from[1], length = Math.hypot(dx, dy);
      return [point[0] - dy / length * delta, point[1] + dx / length * delta];
    }
    const radius = segment.sweep === 1 ? segment.r - delta : segment.r + delta;
    if (radius <= 0) throw new RangeError('One inset is wider than the shape\'s smallest round');
    const ux = point[0] - segment.centre[0], uy = point[1] - segment.centre[1], length = Math.hypot(ux, uy);
    return [segment.centre[0] + ux / length * radius, segment.centre[1] + uy / length * radius];
  };
  const first = segments[0]!;
  const startPoint = moved(first, first.from);
  let d = `M${r2(startPoint[0])} ${r2(startPoint[1])}`;
  for (const segment of segments) {
    const end = moved(segment, segment.to);
    d += segment.type === 'L'
      ? `L${r2(end[0])} ${r2(end[1])}`
      : `A${r2(segment.sweep === 1 ? segment.r - delta : segment.r + delta)} ${r2(segment.sweep === 1 ? segment.r - delta : segment.r + delta)} 0 ${segment.large} ${segment.sweep} ${r2(end[0])} ${r2(end[1])}`;
  }
  return d + 'Z';
}


// ── The still glyph ──────────────────────────────────────────────────────────────────────────────

export interface OneSvgInput {
  /** The shape drawn: an agent shape, or 'charcoal' for Digital One's circle. A blank head takes the shape the agent will get. */
  readonly kind: OneKind;
  readonly color: OneHeadColor;
  readonly theme: OneTheme;
  readonly face: OneFace;
  readonly pose: OnePose;
  readonly size: number;
  /** Openness multiplier from the state's blink: 1 open, 0 shut. */
  readonly blink: number;
  readonly label?: string;
  /** Escaped root attributes, already formatted as ` name="value"` pairs. */
  readonly attributes: string;
}

export function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/**
 * The One head as a still, self-contained SVG: no script, style, animation, font, external reference or
 * element identifier. Decorative (aria-hidden) unless a label names it. A still glyph is a held face, which
 * never shows a mouth; the slumped body of a paused head at 64 px and up is drawn as the live head holds it.
 * The body is the shape's path; the eye sits in the shape's eye group with the shape's limits; a keyline or
 * Digital One's rim is the outline inset by half its width, stroked, never a clip.
 */
export function renderOneSvg(input: OneSvgInput): string {
  if (input.color === 'charcoal' ? input.kind !== 'charcoal' : input.kind === 'charcoal') throw new TypeError('Digital One is charcoal in shape and colour alike');
  const paint = onePaint(input.color, input.theme);
  const tier = oneTier(input.size);
  const geometry = oneGeometry(input.pose, tier, input.kind, input.blink);
  if (geometry.mouth !== null) throw new TypeError('A still One shows a held face, which has no mouth');
  const shape = oneShapeGeometry(input.kind);
  const name = input.label === undefined ? undefined : escapeXml(input.label);
  const access = name === undefined ? ' aria-hidden="true" focusable="false"' : ` role="img" aria-label="${name}"`;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -100 200 200" width="${input.size}" height="${input.size}" overflow="visible"${access}${input.attributes} data-one-shape="${oneShapeId(input.kind)}" data-one-color="${input.color}" data-one-face="${input.face}" data-one-tier="${tier}">`];
  if (name !== undefined) parts.push(`<title>${name}</title>`);
  parts.push(`<g data-character-body="true"${geometry.body ? ` transform="${geometry.body}"` : ''}>`);
  if (paint.eye === null) {
    const outline = oneEyeOutline(oneFrame(input.pose, input.blink, input.kind), shape.eye);
    parts.push(`<path data-one-disc="true" fill-rule="evenodd" d="${shape.path}${outline}" fill="${paint.disc}"/>`);
  } else {
    parts.push(`<path data-one-disc="true" d="${shape.path}" fill="${paint.disc}"${paint.discOpacity === 1 ? '' : ` fill-opacity="${paint.discOpacity}"`}/>`);
    if (paint.keyline !== null) {
      const width = oneKeylineWidth(input.size);
      parts.push(`<path data-one-keyline="true" d="${oneInsetPath(shape.path, width / 2)}" fill="none" stroke="${paint.keyline}" stroke-width="${r2(width)}"/>`);
    }
    if (paint.rim !== null) {
      const width = oneRimWidth(input.size);
      parts.push(`<path data-one-rim="true" d="${oneInsetPath(shape.path, width / 2)}" fill="none" stroke="${paint.rim.color}" stroke-opacity="${paint.rim.opacity}" stroke-width="${r2(width)}"/>`);
    }
    parts.push(`<g data-character-eyes="agent-eye-v1" transform="${geometry.eye}"><path data-one-eye="true" d="${geometry.bar}" fill="${paint.eye}" stroke="${paint.eye}" stroke-width="${geometry.strokeWidth}" stroke-linejoin="round"/></g>`);
  }
  return parts.join('') + '</g></svg>';
}

/** A still head's options once validated: the shared rendering choices the descriptor reports. */
export interface OneStillInput {
  /** A validated agent DID, or undefined for a blank head, which nobody holds yet. */
  readonly did?: string;
  readonly kind: OneKind;
  readonly color: OneHeadColor;
  readonly theme: OneTheme;
  readonly size: number;
  readonly label?: string;
  readonly status: AvatarStatus;
  readonly expression: AvatarExpression;
  /** The state's blink: 0 open, 1 shut. */
  readonly blink: number;
  readonly gaze: { readonly x: number; readonly y: number };
  readonly view: 'avatar' | 'full';
  readonly finish: 'plush' | 'flat';
  readonly eyePlacement: 'face' | 'raised';
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The still glyph with the root attributes every character carries; shared by `generateCharacter` and `renderOne`. */
export function oneStillSvg(input: OneStillInput): string {
  const face = oneFaceFor({ status: input.status, expression: input.expression });
  const pose = oneHeldPose(face, input.gaze, input.size);
  const seed = input.did === undefined ? '' : ` data-character-seed="${hex(oneSeed(input.did))}"`;
  const attributes = ` data-character-skin="one" data-character-version="1" data-character-shape="${input.kind}" data-character-view="${input.view}" data-character-finish="${input.finish}" data-character-eye-placement="${input.eyePlacement}" data-character-expression="${input.expression}" data-character-theme="${input.theme}"${seed}`;
  return renderOneSvg({ kind: input.kind, color: input.color, theme: input.theme, face, pose, size: input.size, blink: 1 - input.blink, attributes,
    ...(input.label === undefined ? {} : { label: input.label }) });
}
