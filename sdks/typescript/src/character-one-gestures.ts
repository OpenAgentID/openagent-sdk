/**
 * The idle and event gestures, and the director that chooses them: pure and clock-driven, so every platform shows the same
 * timing. `@openagentid/sdk/one-gestures` is a separate entry: a host that never plays gestures never loads this file.
 *
 * Rules (JR, 9 Nov 2026): one head in a list acts at a time, every 20 to 40 seconds; a personality is fixed by the DID, so
 * the same agent feels the same on every device; the person's main One stays calm (blinks, glances, a rare spin); a live
 * state always wins over an idle gesture, and no idle gesture may read as one.
 */
import { clamp, freeze, mImul, mMax } from './character-intrinsics.js';
import { oneError } from './one-error.js';
import { ONE_CHANNELS, oneHeldPose, type OneChannel, type OneKind } from './character-one.js';
import { F, blinkAt, createBuilder, sampleCurve, saccade, type Key } from './character-one-motion.js';

export type OneIdleGesture = 'spin' | 'doubleTake' | 'peek' | 'hop' | 'shakeOff' | 'stretch' | 'doze' | 'glanceUp' | 'glanceDown' | 'sideEye' | 'blink' | 'startle';
export const ONE_IDLE_GESTURES: readonly OneIdleGesture[] = freeze(['spin', 'doubleTake', 'peek', 'hop', 'shakeOff', 'stretch', 'doze', 'glanceUp', 'glanceDown', 'sideEye', 'blink', 'startle']);

/** A composed gesture, ready for `OnePlayer.perform` or `renderOneFrame`. */
export interface OneGestureTimeline {
  readonly duration: number;
  /** Channel values in `ONE_CHANNELS` order at `ms` since the start. */
  sample(ms: number): number[];
}

export interface OneGestureOptions {
  /** The head's shape, or 'charcoal' for Digital One. */
  readonly kind: OneKind;
  /** The displayed size in pixels. */
  readonly size: number;
  /** Where the head's content is, as its held gaze; default a row: `{ x: 0.4, y: 0 }`. */
  readonly gaze?: { readonly x: number; readonly y: number };
  /** The personality's pace, from `oneGesturePersonality`; 1 by default. */
  readonly tempo?: number;
  /** Uniform draw in [0, 1) for a spin's direction; default a coin toss on the clockwise side. */
  readonly random?: () => number;
}

/** Each gesture's length before a personality's tempo, for planning. */
export function oneGestureLengthMs(name: OneIdleGesture, options: OneGestureOptions): number {
  return oneGestureTimeline(name, options).duration;
}

/** Compose one gesture into a timeline, from the head's held idle face. */
export function oneGestureTimeline(name: OneIdleGesture, options: OneGestureOptions): OneGestureTimeline {
  if (!ONE_IDLE_GESTURES.includes(name)) throw new TypeError(oneError(58, () => ('Unsupported One gesture')));
  const tempo = clamp(options.tempo ?? 1, 0.6, 1.6);
  const gaze = options.gaze ?? { x: 0.4, y: 0 };
  const held = oneHeldPose('idle', gaze, options.size);
  const b = createBuilder(held);
  const d = gaze.x < 0 ? -1 : 1;
  const way = (options.random ?? (() => 0.75))() < 0.5 ? -1 : 1;
  let duration: number;
  switch (name) {
    case 'spin': {
      // A small squash and a wind against the turn; a whip so fast it smears; past the mark, back, and a wobble to settle.
      const wind = 3 * F, whip = wind + 5 * F, over = whip + 3 * F, back = over + 4 * F;
      b.mv(0, wind, { squash: -9, turn: -14 * way, look: -0.25 * way * d }, 'wind');
      b.mv(wind, whip, { turn: 366 * way, squash: 7 }, 'glide');
      b.mv(wind, wind + 2.5 * F, { smear: way }, 'snap');
      b.mv(wind + 2.5 * F, whip, { smear: 0 }, 'fall');
      b.mv(whip, over, { turn: 374 * way, squash: -3 }, 'settle');
      b.mv(over, back, { turn: 360 * way, look: held.look, squash: 0 }, 'settle');
      b.mv(over, over + 2 * F, { rotate: 4 * way }, 'snap');
      b.mv(over + 2 * F, over + 5 * F, { rotate: -2.2 * way }, 'glide');
      b.mv(over + 5 * F, over + 8 * F, { rotate: 0.8 * way }, 'glide');
      b.mv(over + 8 * F, over + 11 * F, { rotate: 0 }, 'settle');
      duration = over + 11 * F;
      break;
    }
    case 'doubleTake': {
      // The eye drifts off the content, stays a beat, then snaps back wide: a one-way trip, never reading's sweep.
      b.mv(0, 480, { look: -0.72 * d, lift: 0.1 }, 'glide');
      const snap = 480 + 260;
      b.mv(snap, snap + 90, { look: held.look, lift: held.lift, open: 1.2 }, 'snap');
      b.cut(snap + 90, { stretch: 6 });
      b.mv(snap + 90, snap + 300, { open: 1, stretch: 0 }, 'settle');
      duration = snap + 300;
      break;
    }
    case 'peek': {
      // Sinks out of its frame, then the eye rises back over the edge, looks around, and it pops up again.
      b.mv(0, 3 * F, { squash: -5 }, 'wind');
      b.mv(3 * F, 10 * F, { rise: 1.08, squash: 0 }, 'fall');
      const down = 10 * F + 200;
      b.mv(down, down + 7 * F, { rise: 0.38, lift: -0.95, open: 0.82 }, 'rise');
      b.mv(down + 9 * F, down + 12 * F, { look: 0.45 * d }, 'snap');
      b.mv(down + 15 * F, down + 18 * F, { look: -0.4 * d }, 'snap');
      const up = down + 22 * F;
      b.mv(up, up + 5 * F, { rise: -0.02, stretch: 6, lift: held.lift, look: held.look, open: 1 }, 'rise');
      b.mv(up + 5 * F, up + 8 * F, { rise: 0, stretch: -5 }, 'settle');
      b.mv(up + 8 * F, up + 12 * F, { stretch: 0 }, 'settle');
      duration = up + 12 * F;
      break;
    }
    case 'hop': {
      b.mv(0, 3 * F, { squash: -10, rise: 0.02 }, 'wind');
      b.mv(3 * F, 7 * F, { rise: -0.2, squash: 0, stretch: 10 }, 'rise');
      b.mv(7 * F, 11 * F, { rise: 0, stretch: 0 }, 'fall');
      b.cut(11 * F, { squash: -12 });
      b.mv(11 * F, 15 * F, { squash: 4 }, 'pop');
      b.mv(15 * F, 19 * F, { squash: 0 }, 'settle');
      duration = 19 * F;
      break;
    }
    case 'shakeOff': {
      // A dog's shake: fast, side to side, the amplitude falling away; the eye squeezed against it.
      b.mv(0, 2 * F, { open: 0.45, tilt: 0 }, 'snap');
      const n = 9;
      for (let i = 0; i < n; i++) {
        const amp = 0.05 * (1 - i / (n + 2));
        const t = 2 * F + i * 1.6 * F;
        b.cut(t, { shift: (i % 2 ? -1 : 1) * amp, rotate: (i % 2 ? -1 : 1) * 2.5 });
      }
      const end = 2 * F + n * 1.6 * F;
      b.mv(end, end + 4 * F, { shift: 0, rotate: 0, open: 1 }, 'settle');
      duration = end + 4 * F;
      break;
    }
    case 'stretch': {
      // Tall and thin, held, then back with a little sigh: down past the mark, the eye easing open.
      b.mv(0, 11 * F, { stretch: 22, open: 0.5, lift: -0.25 }, 'glide');
      b.mv(11 * F + 280, 11 * F + 280 + 6 * F, { stretch: -7, open: 0.72, lift: 0.18 }, 'fall');
      b.mv(11 * F + 280 + 6 * F, 11 * F + 280 + 13 * F, { stretch: 0, open: 1, lift: held.lift }, 'settle');
      duration = 11 * F + 280 + 13 * F;
      break;
    }
    case 'doze': {
      // The eye narrows to a sliver and drifts down, then a jolt: wide awake.
      b.mv(0, 900, { open: 0.06, lift: 0.7, look: held.look * 0.3, tilt: 6 * d }, 'glide');
      b.mv(0, 900, { squash: -3, rotate: 2 * d }, 'glide');
      const jolt = 900 + 320;
      b.cut(jolt, { open: 1.28, lift: -0.2, stretch: 12, squash: 0, rotate: 0, tilt: 0, look: held.look });
      b.mv(jolt, jolt + 5 * F, { stretch: -3, open: 1.06 }, 'settle');
      b.mv(jolt + 5 * F, jolt + 10 * F, { stretch: 0, open: 1, lift: held.lift }, 'settle');
      duration = jolt + 10 * F;
      break;
    }
    case 'glanceUp':
    case 'glanceDown': {
      // A look at the row above or below, up and down only, never along a line of text.
      const to = name === 'glanceUp' ? -0.95 : 0.85;
      const t = saccade(b, 0, held.look * 0.4, { lift: to });
      // The body leans a little with the eye: at 44 px an eye move alone is two pixels.
      b.mv(0, t, { open: 1.06, rise: name === 'glanceUp' ? -0.035 : 0.03, stretch: name === 'glanceUp' ? 5 : -4 }, 'snap');
      const back = t + 560;
      blinkAt(b, t + 200, 1.06, d);
      b.mv(back, back + 200, { rise: 0, stretch: 0, open: 1 }, 'glide');
      duration = mMax(saccade(b, back, held.look, { lift: held.lift }), back + 200);
      break;
    }
    case 'sideEye': {
      // A long, unimpressed look toward the top of the list; the lid half down, the only gesture that holds narrow.
      saccade(b, 0, 0.18 * d, { lift: -0.9 });
      b.mv(0, 200, { open: 0.5, tilt: -6 * d, rise: -0.03 }, 'glide');
      const back = 200 + 720;
      b.mv(back, back + 240, { open: 1, tilt: 0, rise: 0 }, 'glide');
      duration = mMax(saccade(b, back, held.look, { lift: held.lift }), back + 240);
      break;
    }
    case 'blink': {
      duration = blinkAt(b, 0, 1, d);
      break;
    }
    case 'startle': {
      // Something landed on this row: up a little, wide, down.
      b.cut(0, { open: 1.3, stretch: 8, rise: -0.05, lift: -0.3 });
      b.mv(2 * F, 7 * F, { open: 1, stretch: 0, rise: 0, lift: held.lift }, 'settle');
      duration = 7 * F;
      break;
    }
  }
  const curves = b.curves as Partial<Record<OneChannel, Key[]>>;
  return freeze({
    duration: duration * tempo,
    sample(ms: number): number[] {
      const at = clamp(ms / tempo, 0, duration);
      const value = ONE_CHANNELS.map(k => {
        const curve = curves[k];
        return curve ? sampleCurve(curve, at) : (held as unknown as Record<string, number>)[k]!;
      });
      return value;
    },
  });
}

// ── Personalities ─────────────────────────────────────────────────────────────────────────────

export type OnePersonalityTrait = 'twitchy' | 'sleepy' | 'bouncy' | 'curious' | 'shy' | 'cool' | 'calm';
export interface OnePersonality {
  readonly trait: OnePersonalityTrait;
  /** Scales every gesture's length: below 1 is quicker. */
  readonly tempo: number;
  /** Relative chance of this row being the one that acts. */
  readonly liveliness: number;
  readonly weights: Readonly<Partial<Record<OneIdleGesture, number>>>;
}

const personalities: readonly OnePersonality[] = freeze([
  freeze({ trait: 'twitchy', tempo: 0.82, liveliness: 1.5, weights: freeze({ shakeOff: 5, doubleTake: 4, startle: 2, hop: 2, spin: 2, glanceUp: 2, glanceDown: 2, sideEye: 1 }) }),
  freeze({ trait: 'sleepy', tempo: 1.3, liveliness: 0.7, weights: freeze({ doze: 6, stretch: 4, blink: 2, peek: 1, glanceDown: 1, sideEye: 1 }) }),
  freeze({ trait: 'bouncy', tempo: 0.92, liveliness: 1.3, weights: freeze({ hop: 5, spin: 4, stretch: 2, peek: 2, shakeOff: 2, glanceUp: 1 }) }),
  freeze({ trait: 'curious', tempo: 1, liveliness: 1.1, weights: freeze({ glanceUp: 4, glanceDown: 4, peek: 3, doubleTake: 3, spin: 1 }) }),
  freeze({ trait: 'shy', tempo: 1.1, liveliness: 0.8, weights: freeze({ peek: 5, glanceDown: 3, blink: 2, doubleTake: 1 }) }),
  freeze({ trait: 'cool', tempo: 1.05, liveliness: 0.9, weights: freeze({ sideEye: 5, stretch: 2, spin: 2, glanceUp: 2, blink: 2 }) }),
]);
/** The person's main One: blinks, glances, only a rare spin. */
const calm: OnePersonality = freeze({ trait: 'calm', tempo: 1.15, liveliness: 0.6, weights: freeze({ blink: 8, glanceUp: 2, glanceDown: 3, sideEye: 0, spin: 0.35 }) });

/** FNV-1a of the DID string: small, stable and the same on every device; display only, never identity. */
function didHash(did: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < did.length; i++) {
    hash ^= did.charCodeAt(i);
    hash = mImul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The agent's personality, fixed by its DID. Pass `main: true` for the person's main One. */
export function oneGesturePersonality(did: string, main = false): OnePersonality {
  return main ? calm : personalities[didHash(did) % personalities.length]!;
}

// ── The director ──────────────────────────────────────────────────────────────────────────────

export interface OneIdleRow {
  /** The host's id for the row. */
  readonly id: string;
  /** The agent's DID, or any stable id for a person's One. */
  readonly did: string;
  /** The person's main One (black disc). */
  readonly main?: boolean;
  /** A live state (reasoning, browsing, writing, waiting, error, speaking) is on this head: it is never chosen. */
  readonly busy?: boolean;
  /** Pixels from the top of the list, so a glance has a neighbour. */
  readonly index: number;
}

export interface OneIdlePlan {
  readonly rowId: string;
  readonly gesture: OneIdleGesture;
  /** For a mutual look: the neighbour's row, which plays `partnerGesture` alongside. */
  readonly partnerId?: string;
  readonly partnerGesture?: OneIdleGesture;
  readonly tempo: number;
}

export interface OneIdleDirector {
  /** The next wait, 20 to 40 seconds; the host arms one timer and asks `pick` when it fires. */
  nextDelay(): number;
  /** Which row acts now, or null when no row is free. */
  pick(rows: readonly OneIdleRow[]): OneIdlePlan | null;
}

/** The director's random draws are per device; only personality and what a gesture is are fixed by the DID. */
export function createOneIdleDirector(random: () => number = Math.random): OneIdleDirector {
  let last: string | null = null;
  const chooseWeighted = <T>(entries: readonly (readonly [T, number])[]): T | null => {
    const total = entries.reduce((sum, [, weight]) => sum + (weight > 0 ? weight : 0), 0);
    if (total <= 0) return null;
    let roll = random() * total;
    for (const [value, weight] of entries) {
      if (weight <= 0) continue;
      roll -= weight;
      if (roll <= 0) return value;
    }
    return entries[entries.length - 1]![0];
  };
  return freeze({
    nextDelay: () => 20000 + random() * 20000,
    pick(rows: readonly OneIdleRow[]): OneIdlePlan | null {
      const sorted = [...rows].sort((a, b) => a.index - b.index);
      const free = sorted.filter(row => !row.busy && row.id !== last);
      const row = chooseWeighted(free.map(entry => [entry, oneGesturePersonality(entry.did, entry.main).liveliness] as const));
      if (!row) return null;
      const personality = oneGesturePersonality(row.did, row.main);
      const position = sorted.indexOf(row);
      const above = sorted[position - 1];
      const below = sorted[position + 1];
      const hasOneAbove = sorted.slice(0, position).some(entry => entry.main);
      const gesture = chooseWeighted((Object.entries(personality.weights) as [OneIdleGesture, number][]).filter(([name]) => {
        if (name === 'glanceUp') return above !== undefined;
        if (name === 'glanceDown') return below !== undefined;
        if (name === 'sideEye') return hasOneAbove || row.main === true;
        return true;
      }));
      if (!gesture) return null;
      last = row.id;
      if ((gesture === 'glanceUp' || gesture === 'glanceDown') && random() < 0.35) {
        const partner = gesture === 'glanceUp' ? above : below;
        if (partner && !partner.busy && !partner.main) {
          return freeze({ rowId: row.id, gesture, partnerId: partner.id, partnerGesture: gesture === 'glanceUp' ? 'glanceDown' : 'glanceUp', tempo: personality.tempo });
        }
      }
      return freeze({ rowId: row.id, gesture, tempo: personality.tempo });
    },
  });
}

/** The smallest head that plays a gesture; below it a head only holds its face. */
export const ONE_GESTURE_MIN_PX = 24;
