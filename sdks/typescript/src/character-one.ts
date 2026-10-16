/**
 * The One family: a round disc with one bar for an eye, drawn only from
 * agent-eye's geometry (see agent-eye.ts for provenance). Twelve agent colours
 * plus Digital One ('charcoal'), a blank head for ready-made agents that are not
 * anybody yet, a still glyph for static and reduced-motion rendering, and the
 * faces that the shared live status timeline maps to.
 *
 * Colour is identity, never status: a One keeps its colour whatever its state.
 * State is carried by the face.
 */
import { blake3 } from '@noble/hashes/blake3';
import { barPath, barShape, GEOMETRY, poseToFrame, r2, type AgentEyeFrame } from './agent-eye.js';
import { isAgentAvatarDid } from './avatar-did.js';
import { expressionForStatus, type AvatarExpression, type AvatarStatus } from './character-state.js';

/** The twelve agent colours, in default assignment order. */
export type OneColor = 'blue' | 'red' | 'sky' | 'green' | 'yellow' | 'pink' | 'plum' | 'teal' |
  'lime' | 'mint' | 'lilac' | 'coral';
/** A One kind: an agent colour, or 'charcoal' for Digital One (One itself). */
export type OneKind = OneColor | 'charcoal';
/**
 * What a head is painted as: a One kind, or 'blank' for a ready-made agent that has not been added yet.
 * A blank head is presentation only: it is never stored, never a DID default and never assigned.
 */
export type OneHeadColor = OneKind | 'blank';
export type OneTheme = 'light' | 'dark';
/** A temperament paces a One's moves; it is never shown as a name. */
export type OneTemperament = 'quick' | 'bouncy' | 'neat' | 'slow' | 'dry';

export interface OneColorDescription {
  readonly id: OneColor;
  /** Colour name for a colour picker. Never use it as an agent's name. */
  readonly label: string;
  /** Disc, eye and optional keyline on light surfaces. */
  readonly light: { readonly disc: string; readonly eye: string; readonly keyline: string | null };
  /** Disc and eye on dark surfaces. Keylines are a light-surface treatment only. */
  readonly dark: { readonly disc: string; readonly eye: string };
  readonly temperament: OneTemperament;
}

/** The eye colours: paper-raised where it reaches 3:1 on the disc, ink otherwise. */
export const ONE_EYE_LIGHT = '#fbfaf6';
export const ONE_EYE_INK = '#141b16';
/** Digital One: ink on light surfaces, chalk on dark ones, the eye knocked out to the surface. */
export const ONE_DIGITAL = Object.freeze({ light: '#141b16', dark: '#f2f1ea' });
/** A blank head: the surface's ink at 10 % for the disc and the muted text tone for the eye (AVATARS.md §1.1). */
export const ONE_BLANK = Object.freeze({
  light: Object.freeze({ disc: '#141b16', discOpacity: 0.1, eye: '#5a6256' }),
  dark: Object.freeze({ disc: '#f2f1ea', discOpacity: 0.1, eye: '#a9b2a2' }),
});

const color = (id: OneColor, label: string, disc: string, eye: string, keyline: string | null,
  night: string, temperament: OneTemperament): OneColorDescription => Object.freeze({
  id, label, temperament,
  light: Object.freeze({ disc, eye, keyline }),
  dark: Object.freeze({ disc: night, eye }),
});

// AVATARS.md §1.3 (One app avatars, 15 October 2026): contrast-gated, colour-vision-checked and
// ordered so that small teams receive the most distinct colours first. Red, Yellow, Blue and Green are
// the four Ones shared with the One website and the One app (final palette, 16 October 2026), each at
// least CIEDE2000 10 from Google's logo, Material, 2014–15 and 2015 logo colours.
const colors: readonly OneColorDescription[] = Object.freeze([
  color('blue', 'Blue', '#3253e6', ONE_EYE_LIGHT, null, '#5366fd', 'neat'),
  color('red', 'Red', '#e51e59', ONE_EYE_LIGHT, null, '#e51e59', 'quick'),
  color('sky', 'Sky', '#6fc9fe', ONE_EYE_INK, '#3889b6', '#6fc9fe', 'neat'),
  color('green', 'Green', '#0e9076', ONE_EYE_LIGHT, null, '#0e9076', 'slow'),
  color('yellow', 'Yellow', '#ffe93f', ONE_EYE_INK, '#908207', '#ffe93f', 'bouncy'),
  color('pink', 'Pink', '#f85fa0', ONE_EYE_INK, '#cd4882', '#f85fa0', 'bouncy'),
  color('plum', 'Plum', '#890f8e', ONE_EYE_LIGHT, null, '#a94cac', 'neat'),
  color('teal', 'Teal', '#0aaead', ONE_EYE_INK, '#3b8f8e', '#0aaead', 'slow'),
  color('lime', 'Lime', '#a9c21a', ONE_EYE_INK, '#798a28', '#a9c21a', 'quick'),
  color('mint', 'Mint', '#3df0b0', ONE_EYE_INK, '#21946b', '#3df0b0', 'quick'),
  color('lilac', 'Lilac', '#b183f4', ONE_EYE_INK, '#9068ca', '#b183f4', 'slow'),
  color('coral', 'Coral', '#fa8f77', ONE_EYE_INK, '#bd624e', '#f29782', 'bouncy'),
]);
const colorIds: readonly OneColor[] = Object.freeze(colors.map(entry => entry.id));
/** Catalog kinds for the One family: the twelve colours, then Digital One. */
export const ONE_KINDS: readonly OneKind[] = Object.freeze([...colorIds, 'charcoal'] as const);

/** The twelve agent colours in default assignment order, with their light and dark tones. */
export function getOneColors(): readonly OneColorDescription[] {
  return colors;
}

export function isOneColor(value: unknown): value is OneColor {
  return typeof value === 'string' && (colorIds as readonly string[]).includes(value);
}

export function isOneKind(value: unknown): value is OneKind {
  return value === 'charcoal' || isOneColor(value);
}

export function isOneHeadColor(value: unknown): value is OneHeadColor {
  return value === 'blank' || isOneKind(value);
}

const encoder = new TextEncoder();

/** The character seed shared with every family: BLAKE3 over `oaid-character-v1\0one\0<did>`. */
export function oneSeed(did: string): Uint8Array {
  return blake3(encoder.encode(`oaid-character-v1\u0000one\u0000${did}`));
}

/**
 * The deterministic default colour for an agent DID: the seed's first four bytes as a little-endian
 * unsigned integer, modulo twelve, indexing the default order. Digital One is never a default.
 * Display only: the colour neither identifies nor authenticates the agent.
 */
export function oneColorForDid(did: string): OneColor {
  if (!isAgentAvatarDid(did)) throw new TypeError('One colours require an agent or agent instance DID');
  const seed = oneSeed(did);
  const value = (seed[0]! | seed[1]! << 8 | seed[2]! << 16 | seed[3]! << 24) >>> 0;
  return colorIds[value % colorIds.length]!;
}

/** An agent that already holds a colour, with the group it sits in (for example a team or a company). */
export interface OneColorHolder {
  readonly color: OneColor;
  readonly group?: string;
}

function parseGroup(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 200) throw new TypeError('One colour groups must be 1–200 characters');
  return value;
}

/**
 * The colour for a new agent (AVATARS.md §1.4): the first colour in the default order that nobody in `held`
 * has. When all twelve are held, the least-held colour; among those, with `options.group`, one whose holders
 * all sit in other groups (a holder without a group is never counted as another group); ties by the order.
 * Pass the colours of every agent in the same scope, as colours or `{ color, group }` holders. Unknown colours
 * and malformed holders are refused rather than ignored.
 */
export function nextOneColor(held: Iterable<OneColor | OneColorHolder>, options?: { readonly group?: string }): OneColor {
  if (held === null || typeof held !== 'object' || typeof (held as Iterable<unknown>)[Symbol.iterator] !== 'function') {
    throw new TypeError('Held One colours must be iterable');
  }
  if (options !== undefined && (options === null || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => key !== 'group'))) throw new TypeError('Invalid One colour options');
  const group = options?.group === undefined ? undefined : parseGroup(options.group);
  const counts = new Map<OneColor, number>(colorIds.map(id => [id, 0]));
  const shared = new Set<OneColor>();
  for (const entry of held as Iterable<unknown>) {
    let value: unknown = entry, holderGroup: string | undefined;
    if (entry !== null && typeof entry === 'object') {
      if (Array.isArray(entry) || Object.keys(entry).some(key => key !== 'color' && key !== 'group')) throw new TypeError('Invalid One colour holder');
      const holder = entry as Record<string, unknown>;
      value = holder.color;
      holderGroup = holder.group === undefined ? undefined : parseGroup(holder.group);
    }
    if (!isOneColor(value)) throw new TypeError('Unsupported One colour');
    counts.set(value, counts.get(value)! + 1);
    if (holderGroup === undefined || holderGroup === group) shared.add(value);
  }
  const least = Math.min(...counts.values());
  const candidates = colorIds.filter(id => counts.get(id) === least);
  if (least === 0 || group === undefined) return candidates[0]!;
  return candidates.find(id => !shared.has(id)) ?? candidates[0]!;
}

export interface OnePaint {
  readonly disc: string;
  /** Below 1 only for a blank head, whose disc is a tint of the surface's ink. */
  readonly discOpacity: number;
  /** Null for Digital One, whose eye is knocked out of the disc to show the surface. */
  readonly eye: string | null;
  readonly keyline: string | null;
  readonly temperament: OneTemperament;
}

export function onePaint(kind: OneHeadColor, theme: OneTheme): OnePaint {
  if (kind === 'charcoal') return { disc: ONE_DIGITAL[theme], discOpacity: 1, eye: null, keyline: null, temperament: 'dry' };
  if (kind === 'blank') {
    const blank = ONE_BLANK[theme];
    return { disc: blank.disc, discOpacity: blank.discOpacity, eye: blank.eye, keyline: null, temperament: 'neat' };
  }
  const entry = colors.find(value => value.id === kind);
  if (!entry) throw new TypeError('Unsupported One colour');
  return theme === 'dark'
    ? { disc: entry.dark.disc, discOpacity: 1, eye: entry.dark.eye, keyline: null, temperament: entry.temperament }
    : { disc: entry.light.disc, discOpacity: 1, eye: entry.light.eye, keyline: entry.light.keyline, temperament: entry.temperament };
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
export const ONE_FACE_CHANNELS: readonly OneChannel[] = Object.freeze(['look', 'lift', 'open', 'tilt', 'smile', 'mouth']);
export const ONE_BODY_CHANNELS: readonly OneChannel[] = Object.freeze(['squash', 'rotate', 'hop']);
export const ONE_CHANNELS: readonly OneChannel[] = Object.freeze([...ONE_FACE_CHANNELS, ...ONE_BODY_CHANNELS]);
/** agent-eye's REST pose: the mark itself. */
export const ONE_NEUTRAL: OnePose = Object.freeze({ look: 0, lift: 0, open: 1, tilt: 0, smile: 0, mouth: 0, squash: 0, rotate: 0, hop: 0 });

export type OneTier = 'XS' | 'S' | 'M' | 'L';
/** Size tiers: XS 16–20 px holds faces only; S 24–36 moves the face; M 40–52 adds a little body; L 64+ is fully expressive. */
export function oneTier(px: number): OneTier {
  return px <= 20 ? 'XS' : px <= 36 ? 'S' : px <= 52 ? 'M' : 'L';
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

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
  let pose: Partial<OnePose>;
  switch (face) {
    case 'idle': case 'neutral': pose = gx === 0 && gy === 0 ? { tilt: 5, open: 0.92 } : { look: gx, lift: gy }; break;
    case 'listening': pose = { lift: -0.05, open: 1.04 }; break;
    case 'thinking': case 'thoughtful': pose = { look: 0.25 * d, lift: -0.45, open: 0.58, tilt: -8 * d }; break;
    case 'working': pose = { look: 0.3 * d, lift: 0.3, open: 0.72 }; break;
    case 'typing': pose = { look: 0.15 * d, lift: 0.55, open: 0.8 }; break;
    case 'speaking': pose = { look: 0.08 * d, tilt: 5 * d, open: 0.92 }; break;
    case 'done': case 'happy': pose = { look: Math.abs(gx) < 0.08 ? 0.08 * d : gx, lift: gy, tilt: 5 * d, open: 0.92 }; break;
    case 'attention': pose = { look: 0, lift: 0, open: 1.06 }; break;
    case 'waiting': pose = { look: 0.2 * d, lift: -0.4 }; break;
    case 'paused': case 'sleepy':
      // Below 64 px a closed lid is under a pixel, so smaller heads doze with a visible eye.
      pose = px >= 64 ? { open: 0, lift: 0.35, tilt: 10 * d, squash: -4, rotate: 6 * d }
        : { open: 0.42, lift: 0.4, tilt: 12 * d, look: -0.1 * d };
      break;
    case 'offline': pose = { look: -0.5 * d, lift: 0.15, open: 0.9 }; break;
    case 'error': case 'sad': pose = { look: -0.35 * d, lift: 0.4, open: 0.85, tilt: -5 * d }; break;
    case 'attentive': pose = { look: gx, lift: gy, open: 1.06 }; break;
    case 'surprised': pose = { look: gx * 0.5, lift: gy - 0.1, open: 1.15 }; break;
    case 'excited': pose = { look: gx, lift: gy - 0.15, open: 1.1, tilt: 6 * d }; break;
    case 'laughing': pose = { look: gx, lift: gy - 0.1, open: 0.6, tilt: 8 * d }; break;
    // One never shows anger or fear: these read as a level, narrowed eye and a startled glance away.
    case 'angry': pose = { look: gx, lift: gy, open: 0.62 }; break;
    case 'scared': pose = { look: -0.3 * d, lift: 0.1, open: 1.12 }; break;
    case 'suspicious': pose = { look: 0.55 * d, open: 0.55 }; break;
    case 'confused': pose = { look: -0.2 * d, lift: -0.2, open: 0.9, tilt: -12 * d }; break;
    case 'curious': pose = { look: 0.32 * d, lift: -0.2, open: 0.8, tilt: -10 * d }; break;
    case 'proud': pose = { look: gx, lift: -0.25, open: 0.85, tilt: 6 * d }; break;
    case 'shy': pose = { look: -0.45 * d, lift: 0.45, open: 0.8, tilt: 8 * d }; break;
    case 'unimpressed': pose = { look: gx, lift: gy, open: 0.45 }; break;
    case 'concerned': pose = { look: gx * 0.5, lift: 0.2, open: 0.9, tilt: -7 * d }; break;
    default: throw new TypeError('Unsupported One face');
  }
  const result = { ...ONE_NEUTRAL, ...pose };
  return Object.freeze({ ...result, look: clamp(result.look, -1, 1), lift: clamp(result.lift, -1, 1) });
}

// ── Geometry ─────────────────────────────────────────────────────────────────────────────────────

export interface OneGeometry {
  /** Eye group transform: translate to the bar's centre, then tilt. */
  readonly eye: string;
  /** Bar outline path, stroked with round joins at `strokeWidth` so its corners match the mark. */
  readonly bar: string;
  readonly strokeWidth: number;
  /** The smile line, present only while it is visible. */
  readonly mouth: { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly rx: number; readonly opacity: number } | null;
  /** Body transform around the head's base, or empty at rest. */
  readonly body: string;
}

const temperamentSquash: Readonly<Record<OneTemperament, number>> = Object.freeze({ quick: 16, bouncy: 12, neat: 8, slow: 7, dry: 8 });

function frameFor(pose: OnePose, blink: number): AgentEyeFrame {
  return poseToFrame({ look: pose.look, lift: pose.lift, open: pose.open * blink, tilt: pose.tilt, smile: pose.smile, mouth: pose.mouth });
}

/** Drawn geometry for a pose at a size tier; body motion is capped per tier. */
export function oneGeometry(pose: OnePose, tier: OneTier, temperament: OneTemperament, blink = 1): OneGeometry {
  const frame = frameFor(pose, blink);
  const shape = barShape(frame);
  const visible = frame.mo > 0.001;
  const cap = tier === 'XS' ? 0 : tier === 'S' ? 3 : tier === 'M' ? 8 : temperamentSquash[temperament];
  const squash = clamp(pose.squash, -cap, cap);
  const sy = 1 + squash / 100;
  const sx = Math.pow(sy, -0.5);
  const rotate = tier === 'XS' || tier === 'S' ? 0 : tier === 'M' ? clamp(pose.rotate, -8, 8) : pose.rotate;
  const hop = tier === 'XS' || tier === 'S' ? 0 : (tier === 'M' ? clamp(pose.hop, -0.08, 0.08) : clamp(pose.hop, -0.2, 0.2)) * 2 * GEOMETRY.radius;
  const body = hop || rotate || squash
    ? `translate(0 ${r2(GEOMETRY.radius + hop)}) rotate(${r2(rotate)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(0 -${GEOMETRY.radius})`
    : '';
  return {
    eye: `translate(${r2(frame.x)} ${r2(frame.y)}) rotate(${r2(frame.tilt)})`,
    bar: barPath(shape.n),
    strokeWidth: r2(2 * shape.r),
    mouth: visible ? { x: r2(frame.mx - frame.ma), y: r2(frame.my - frame.mt / 2), width: r2(2 * frame.ma),
      height: r2(frame.mt), rx: r2(GEOMETRY.cornerRadius), opacity: r2(frame.mo) } : null,
    body,
  };
}

/**
 * The eye as drawn (agent-eye's bar path stroked at twice its corner radius with round joins) as one closed
 * outline in disc coordinates. The stroked bar is every point within the corner radius of the bar's filled
 * outline, whose rows run from `-a - c·y²` to `a - c·y²` for |y| ≤ b; the outline is that set sampled row by
 * row (finely around the rounded ends), then turned and moved as the eye group is. A still Digital One cuts it
 * out of its disc with the even-odd rule, so it needs no mask and no element identifier.
 */
export function oneEyeOutline(frame: AgentEyeFrame): string {
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
  const points = local.map(([x, y]) => `${r2(frame.x + x * cos - y * sin)} ${r2(frame.y + x * sin + y * cos)}`);
  return `M${points.join('L')}Z`;
}

/** Keyline width in viewBox units: one CSS pixel, two at 96 px and above, one device pixel below 24 px. */
export function oneKeylineWidth(px: number, devicePixelRatio = 1): number {
  const width = px < 24 ? 1 / Math.max(1, devicePixelRatio) : px >= 96 ? 2 : 1;
  return width * 2 * GEOMETRY.radius / px;
}

// ── The still glyph ──────────────────────────────────────────────────────────────────────────────

export interface OneSvgInput {
  readonly kind: OneHeadColor;
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

const DISC_PATH = `M${GEOMETRY.radius} 0A${GEOMETRY.radius} ${GEOMETRY.radius} 0 1 1 -${GEOMETRY.radius} 0A${GEOMETRY.radius} ${GEOMETRY.radius} 0 1 1 ${GEOMETRY.radius} 0Z`;

/**
 * The One head as a still, self-contained SVG: no script, style, animation, font, external reference or
 * element identifier. Decorative (aria-hidden) unless a label names it. A still glyph is a held face, which
 * never shows a mouth; the slumped body of a paused head at 64 px and up is drawn as the live head holds it.
 */
export function renderOneSvg(input: OneSvgInput): string {
  const paint = onePaint(input.kind, input.theme);
  const tier = oneTier(input.size);
  const geometry = oneGeometry(input.pose, tier, paint.temperament, input.blink);
  if (geometry.mouth !== null) throw new TypeError('A still One shows a held face, which has no mouth');
  const name = input.label === undefined ? undefined : escapeXml(input.label);
  const access = name === undefined ? ' aria-hidden="true" focusable="false"' : ` role="img" aria-label="${name}"`;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -100 200 200" width="${input.size}" height="${input.size}" overflow="visible"${access}${input.attributes} data-one-color="${input.kind}" data-one-face="${input.face}" data-one-tier="${tier}">`];
  if (name !== undefined) parts.push(`<title>${name}</title>`);
  parts.push(`<g data-character-body="true"${geometry.body ? ` transform="${geometry.body}"` : ''}>`);
  if (paint.eye === null) {
    const outline = oneEyeOutline(frameFor(input.pose, input.blink));
    parts.push(`<path data-one-disc="true" fill-rule="evenodd" d="${DISC_PATH}${outline}" fill="${paint.disc}"/>`);
  } else {
    parts.push(`<circle data-one-disc="true" r="${GEOMETRY.radius}" fill="${paint.disc}"${paint.discOpacity === 1 ? '' : ` fill-opacity="${paint.discOpacity}"`}/>`);
    if (paint.keyline !== null) {
      const width = oneKeylineWidth(input.size);
      parts.push(`<circle data-one-keyline="true" r="${r2(GEOMETRY.radius - width / 2)}" fill="none" stroke="${paint.keyline}" stroke-width="${r2(width)}"/>`);
    }
    parts.push(`<g data-character-eyes="agent-eye-v1" transform="${geometry.eye}"><path data-one-eye="true" d="${geometry.bar}" fill="${paint.eye}" stroke="${paint.eye}" stroke-width="${geometry.strokeWidth}" stroke-linejoin="round"/></g>`);
  }
  return parts.join('') + '</g></svg>';
}

/** A still head's options once validated: the shared rendering choices the descriptor reports. */
export interface OneStillInput {
  /** A validated agent DID, or undefined for a blank head, which nobody holds yet. */
  readonly did?: string;
  readonly kind: OneHeadColor;
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
  return renderOneSvg({ kind: input.kind, theme: input.theme, face, pose, size: input.size, blink: 1 - input.blink, attributes,
    ...(input.label === undefined ? {} : { label: input.label }) });
}
