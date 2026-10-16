/**
 * The One family's live timeline: a held face per state, a short moment when the state changes,
 * a brief cadence for ongoing work, and nothing at rest. Pure and clock-driven (milliseconds on the
 * caller's clock); randomness comes from a seeded generator, so a given DID and clock replay exactly.
 *
 * Moments use agent-eye's curve format and eases, ported from the One app avatar prototype
 * (AVATARS.md §2.4), which in turn ports the website mascot's motion vocabulary.
 */
import { BLINK, EASE, SMILE, cubicBezier, type AgentEyeKey } from './agent-eye.js';
import {
  ONE_BODY_CHANNELS, ONE_CHANNELS, ONE_FACE_CHANNELS, oneGeometry, oneHeldPose, oneTemperament, oneTier,
  type OneChannel, type OneFace, type OneGeometry, type OneKind, type OnePose, type OneTemperament, type OneTier,
} from './character-one.js';

/** Ongoing-state pacing: brief (lists: at most five seconds of motion on entering a state) or repeat (headers and heroes). */
export type OneCadence = 'brief' | 'repeat';
export type OneMomentName = 'settle' | 'home' | 'psst' | 'aha' | 'smile' | 'nod' | 'dizzy' |
  'dozeOff' | 'wake' | 'read' | 'ponder' | 'keys' | 'wave' | 'firstBlink' | 'lookAtYou' | 'shrug' | 'popIn';
/**
 * The moments a host may play itself (`OnePlayer.play`): an arrival or a viewer's tap on a hero. Look-at-you and nod
 * play from 24 px; the others need a body, from 40 px.
 */
export type OneGesture = 'lookAtYou' | 'nod' | 'smile' | 'wave' | 'shrug' | 'popIn';
export const ONE_GESTURES: readonly OneGesture[] = Object.freeze(['lookAtYou', 'nod', 'smile', 'wave', 'shrug', 'popIn']);

export interface OneMomentRequest {
  readonly name: OneMomentName;
  /** Priority for a director that limits how many heads move at once. */
  readonly priority: number;
  /** An uncounted request (a 160 ms settle) never waits for a motion slot. */
  readonly uncounted?: boolean;
  /** An ongoing-state cadence, which a higher-priority entrance may cut short. */
  readonly cadence?: boolean;
  /** Started by the viewer (a colour change), not by agent state. */
  readonly user?: boolean;
  /** Uniform draws the moment uses in place of the head's generator, so its length can be known before it starts. */
  readonly draws?: readonly number[];
}

export interface OneMotionFrame {
  readonly face: OneFace;
  readonly tier: OneTier;
  readonly pose: OnePose;
  readonly geometry: OneGeometry;
  /** True while a moment, talk, blink or pointer follow is in progress. */
  readonly moving: boolean;
}

type Ease = keyof typeof EASE | 'wind' | 'pop' | 'brake' | 'rise' | 'fall' | 'ui' |
  '~firm' | '~bounce' | '~boing' | '~jelly' | '~soft';
type Key = [number, number, Ease?];
type Curves = Partial<Record<OneChannel, Key[]>>;

const F = 1000 / 24; // one frame on the 24 fps grid
/** A smile line is withdrawn over this long before any moment moves the eye (agent-eye's minimum gap of 6 units). */
export const ONE_MOUTH_RETRACT_MS = 120;
/** How many uniform draws a moment may use; no moment uses more. */
export const ONE_MOMENT_DRAWS = 16;
const bodyEases: Readonly<Record<string, readonly [number, number, number, number]>> = {
  wind: [0.45, 0, 0.55, 1], pop: [0.34, 1.56, 0.64, 1], brake: [0.16, 1, 0.3, 1],
  rise: [0.5, 1, 0.89, 1], fall: [0.11, 0, 0.5, 0], ui: [0.16, 1, 0.3, 1],
};
const easeFns = new Map<string, (x: number) => number>(
  [...Object.entries(EASE), ...Object.entries(bodyEases)].map(([name, v]) => [name, cubicBezier(v[0], v[1], v[2], v[3])]));
const springs: Readonly<Record<string, readonly [number, number]>> = {
  firm: [0.26, 0.7], bounce: [0.36, 0.45], boing: [0.42, 0.32], jelly: [0.5, 0.25], soft: [0.6, 0.85],
};
function springAt(name: string, sec: number): number {
  const [period, zeta] = springs[name] ?? springs.firm!;
  const w0 = 2 * Math.PI / period, wd = w0 * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * w0 * sec) * (Math.cos(wd * sec) + zeta * w0 / wd * Math.sin(wd * sec));
}
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const smooth = (a: number, b: number, v: number): number => { const k = clamp((v - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
function easeAt(ease: Ease, u: number, segment: number): number {
  if (ease.startsWith('~')) { const k = springAt(ease.slice(1), u * segment / 1000); return k + (1 - k) * smooth(0.8, 1, u); }
  return (easeFns.get(ease) ?? easeFns.get('linear')!)(u);
}
function sampleCurve(curve: readonly Key[], t: number): number {
  if (t <= curve[0]![0]) return curve[0]![1];
  for (let i = 1; i < curve.length; i++) {
    const [t1, v1, ease = 'linear'] = curve[i]!;
    if (t < t1) {
      const [t0, v0] = curve[i - 1]!;
      const segment = t1 - t0;
      return v0 + (v1 - v0) * easeAt(ease, (t - t0) / segment, segment);
    }
  }
  return curve[curve.length - 1]![1];
}
const ms = (curve: readonly AgentEyeKey[]): Key[] => curve.map(([t, v, e]) => [t * 1000, v, e]);
const blinkCurve = ms(BLINK);

/** Moment builder, against the head's live values. */
class Builder {
  readonly curves: Curves = {};
  constructor(private readonly live: OnePose) {}
  private chan(k: OneChannel): Key[] { return this.curves[k] ??= [[0, this.live[k]]]; }
  cur(k: OneChannel): number { const c = this.curves[k]; return c ? c[c.length - 1]![1] : this.live[k]; }
  mv(t0: number, t1: number, values: Partial<OnePose>, ease: Ease = 'linear'): void {
    for (const k of Object.keys(values) as OneChannel[]) {
      const c = this.chan(k);
      const [lt, lv] = c[c.length - 1]!;
      if (t0 > lt) c.push([t0, lv]);
      c.push([Math.max(t1, c[c.length - 1]![0]), values[k]!, ease]);
    }
  }
  cut(t: number, values: Partial<OnePose>): void {
    for (const k of Object.keys(values) as OneChannel[]) {
      const c = this.chan(k);
      const [lt, lv] = c[c.length - 1]!;
      const t0 = Math.max(lt, t - 0.5);
      if (t0 > lt) c.push([t0, lv]);
      c.push([Math.max(t, t0), values[k]!, 'linear']);
    }
  }
  raw(k: OneChannel, curve: readonly AgentEyeKey[], at: number): void {
    const c = this.chan(k);
    c.push([Math.max(at, c[c.length - 1]![0]), curve[0]![1]]);
    for (const [t, v, e] of curve.slice(1)) c.push([at + t * 1000, v, e]);
  }
}

/** agent-eye's saccade: 110 ms + 110 per unit of look, 7 % overshoot, 160 ms settle. */
function saccade(b: Builder, t: number, to: number, extra: Partial<OnePose> = {}): number {
  const from = b.cur('look'), d = 110 + 110 * Math.abs(to - from);
  b.mv(t, t + d, { look: to + (to - from) * 0.07, ...extra }, 'snap');
  b.mv(t + d, t + d + 160, { look: to }, 'settle');
  return t + d + 160;
}
/**
 * agent-eye's BLINK on an openness: 80 ms shut, held 50, opens to 1.04 by 300, settles by 420. A centred, level
 * eye shuts tilted by 7°, so for those frames a disc never shows a level bar that reads as a No Entry sign.
 */
function blinkAt(b: Builder, t: number, open: number, d: number): number {
  const tilt = b.cur('tilt');
  const level = Math.abs(tilt) < 4 && Math.abs(b.cur('look')) < 0.15;
  b.mv(t, t + 80, { open: 0, ...(level ? { tilt: tilt + 7 * d } : {}) }, 'shut');
  b.mv(t + 130, t + 300, { open: open * 1.04, ...(level ? { tilt } : {}) }, 'snap');
  b.mv(t + 300, t + 420, { open }, 'settle');
  return t + 420;
}
function pulses(b: Builder, t: number, n: number, up: number, down: number): number {
  for (let i = 0; i < n; i++) { const t0 = t + i * 4 * F; b.cut(t0, { squash: up }); b.cut(t0 + 2 * F, { squash: down }); }
  const e = t + n * 4 * F;
  b.mv(e, e + 160, { squash: 0 }, 'settle');
  return e + 160;
}
const pick = (pose: OnePose, keys: readonly OneChannel[]): Partial<OnePose> =>
  Object.fromEntries(keys.map(k => [k, pose[k]])) as Partial<OnePose>;

const tempo: Readonly<Record<OneTemperament, number>> = Object.freeze({ quick: 0.85, bouncy: 0.95, neat: 1, slow: 1.18, dry: 1.075 });
const tierTempo: Readonly<Record<OneTier, number>> = Object.freeze({ XS: 1, S: 0.9, M: 1, L: 1.1 });
const ongoing: Readonly<Record<string, OneMomentName>> = Object.freeze({ working: 'read', thinking: 'ponder', typing: 'keys' });
const asleep = new Set<OneFace>(['paused', 'offline', 'sleepy']);
const pondering = new Set<OneFace>(['thinking', 'thoughtful']);
/** Faces whose eye may follow a fine pointer: at rest, warm or listening. */
const followable = new Set<OneFace>(['idle', 'neutral', 'done', 'happy', 'listening']);

export interface OneMotionOptions {
  readonly face: OneFace;
  readonly gaze: { readonly x: number; readonly y: number };
  /** Rendered size in CSS pixels; selects the tier. */
  readonly px: number;
  /** The shape drawn (or 'charcoal' for Digital One): it places and limits the eye and paces the moves by its temperament. */
  readonly kind: OneKind;
  /** Seeded uniform generator in [0, 1). */
  readonly random: () => number;
  readonly cadence: OneCadence;
  /** Optional voice output level, 0–1, read every frame while speaking at the largest tier. */
  readonly level?: () => number;
  /** False holds every face still; true allows moments. */
  readonly motion: boolean;
  readonly at: number;
}

interface Timeline { readonly curves: Curves; readonly start: number; readonly duration: number; readonly twos: boolean }
interface Composed { duration: number; tail?: false; noTempo?: true; scaled?: true; twos?: true }

/** One head's live state. Hosts decide when a requested moment may start. */
export class OneMotion {
  face: OneFace;
  private gaze: { x: number; y: number };
  private px: number;
  private kind: OneKind;
  private readonly random: () => number;
  private readonly cadenceMode: OneCadence;
  private readonly level: (() => number) | undefined;
  private motion: boolean;
  private value: { -readonly [K in OneChannel]: number };
  private timeline: Timeline | null = null;
  private current: OneMomentRequest | null = null;
  private pending: OneMomentRequest | null = null;
  private talk: { mouth: number; quiet: number; blinked: boolean } | null = null;
  private target: { x: number; y: number } | null = null;
  private blinkStart: number | null = null;
  private manualBlink = 0;
  private last: number;
  private entered: number;
  private input: number;

  constructor(options: OneMotionOptions) {
    this.face = options.face;
    this.gaze = { ...options.gaze };
    this.px = options.px;
    this.kind = options.kind;
    this.random = options.random;
    this.cadenceMode = options.cadence;
    this.level = options.level;
    this.motion = options.motion;
    this.last = this.entered = this.input = options.at;
    this.value = { ...this.held() };
  }

  get tier(): OneTier { return oneTier(this.px); }
  /** When the current moment ends on this clock, or null when none is playing. */
  get timelineEnd(): number | null { return this.timeline ? this.timeline.start + this.timeline.duration : null; }
  /** An explicit runtime blink, 0 open … 1 shut, multiplies the drawn openness. */
  setBlink(blink: number): void { this.manualBlink = clamp(blink, 0, 1); }
  get moving(): boolean { return this.timeline !== null || this.talk !== null || this.blinkStart !== null || this.target !== null; }
  get request(): OneMomentRequest | null { return this.current; }
  get following(): boolean { return this.target !== null; }
  held(): OnePose { return oneHeldPose(this.face, this.gaze, this.px); }

  /** Change the face or the content direction; returns the entrance moment to request, if any. */
  setFace(face: OneFace, gaze: { readonly x: number; readonly y: number }, at: number): OneMomentRequest | null {
    const previous = this.face;
    const aimed = gaze.x !== this.gaze.x || gaze.y !== this.gaze.y;
    if (face === previous && !aimed) return null;
    this.face = face;
    this.gaze = { ...gaze };
    this.pending = null;
    if (face !== previous) this.entered = at;
    this.stopTalk();
    if (!followable.has(face)) this.target = null;
    if (!this.motion) { this.snap(); return null; }
    return face === previous ? { name: 'home', priority: 0 } : this.entrance(previous, face);
  }

  /** The entrance for a change of face (AVATARS.md §2.2). */
  entrance(previous: OneFace, next: OneFace): OneMomentRequest {
    if (this.tier === 'XS') return { name: 'settle', priority: 0, uncounted: true };
    const big = this.tier === 'M' || this.tier === 'L';
    if (next === 'attention') return { name: 'psst', priority: 6 };
    if (next === 'error') return { name: 'dizzy', priority: 5 };
    if (next === 'done') return { name: big ? 'smile' : 'nod', priority: 4 };
    if (asleep.has(previous) && !asleep.has(next)) return { name: 'wake', priority: 3 };
    if (next === 'paused') return { name: 'dozeOff', priority: 3 };
    if (pondering.has(previous) && !pondering.has(next)) return { name: 'aha', priority: 3 };
    if (next === 'working') return { name: 'read', priority: 2 };
    if (next === 'thinking') return { name: 'ponder', priority: 1 };
    if (next === 'typing') return { name: 'keys', priority: 2 };
    return { name: 'home', priority: 0 };
  }

  /** The moment for an ongoing state, if its cadence allows one now (the one measured by `nextCadence`, when there is one). */
  cadenceRequest(): OneMomentRequest | null {
    const name = ongoing[this.face];
    if (!name || !this.motion || this.tier === 'XS') return null;
    if (this.pending?.name === name) return this.pending;
    return { name, priority: this.face === 'thinking' ? 1 : 2, cadence: true };
  }

  /**
   * Milliseconds until the next cadence moment, or null when the head should hold still. A brief cadence draws
   * the next cluster now and measures it, so the cluster ends within five seconds of the state starting.
   */
  nextCadence(at: number): number | null {
    this.pending = null;
    const request = this.cadenceRequest();
    if (!request) return null;
    if (this.cadenceMode === 'brief') {
      const gap = 300 + this.random() * 400;
      const measured = { ...request, draws: Object.freeze(Array.from({ length: ONE_MOMENT_DRAWS }, () => this.random())) };
      const length = this.plan(measured, this.held()).duration;
      if (this.entered + 5000 - at < gap + length) return null;
      this.pending = measured;
      return gap;
    }
    if (at - this.input > 60_000) return null;
    // Every ongoing state, typing included, repeats one cluster every six to ten seconds (AVATARS.md §2.3 rule 6).
    return 6000 + this.random() * 4000;
  }

  /** Restart the brief cadence window, as when a head comes back into view. */
  restartWindow(at: number): void { this.entered = at; }
  /** User input keeps repeating cadences alive; they stop after a minute without it. */
  noteInput(at: number): void { this.input = at; }

  /** A new rendered size can change the tier, and so the held face (a lid at 64 px and up). */
  setSize(px: number): void { this.px = px; if (!this.moving) this.value = { ...this.held() }; }
  /** A new shape places and limits the eye differently and may change the pace. */
  setKind(kind: OneKind): void { this.kind = kind; }
  get temperament(): OneTemperament { return oneTemperament(this.kind); }
  setMotion(allowed: boolean): void {
    this.motion = allowed;
    if (!allowed) this.snap();
  }

  /**
   * Point the eye at a fine pointer: `look` and `lift` in -1…1, or null to stop. Eye only: it never starts a
   * moment, and it applies only at rest in a face that may follow (idle, warm or listening) at 40 px and up.
   * Returns whether the head now follows.
   */
  follow(target: { readonly x: number; readonly y: number } | null): boolean {
    if (target === null || !this.motion || !followable.has(this.face) || (this.tier !== 'M' && this.tier !== 'L')) {
      this.target = null;
      return false;
    }
    this.target = { x: clamp(target.x, -1, 1), y: clamp(target.y, -1, 1) };
    return true;
  }

  /** Start a moment now. */
  start(request: OneMomentRequest, at: number): void {
    if (!this.motion) return;
    // A visible smile line is withdrawn first, so no moment moves the eye toward it.
    const lead = this.value.mouth > 0 ? ONE_MOUTH_RETRACT_MS : 0;
    const planned = this.plan(request, lead ? { ...this.value, mouth: 0 } : { ...this.value });
    const curves: Curves = {};
    for (const k of Object.keys(planned.curves) as OneChannel[]) curves[k] = planned.curves[k]!.map(([t, v, e]) => [t + lead, v, e] as Key);
    if (lead) curves.mouth = [[0, this.value.mouth], [lead, 0, 'glide'], ...(curves.mouth ?? []).slice(1)];
    this.timeline = { curves, start: at, duration: planned.duration + lead, twos: planned.twos };
    this.current = request;
    this.target = null;
    this.last = Math.max(this.last, at);
  }

  /** Compose a moment against live values, scaled by temperament and tier. Uses the request's draws first. */
  private plan(request: OneMomentRequest, live: OnePose): { curves: Curves; duration: number; twos: boolean } {
    const b = new Builder(live);
    const P = this.held();
    let index = 0;
    const draw = (): number => request.draws && index < request.draws.length ? request.draws[index++]! : this.random();
    const scale = tempo[this.temperament] * tierTempo[this.tier];
    const result = this.compose(request.name, b, P, scale, draw);
    const factor = result.noTempo || result.scaled ? 1 : scale;
    let duration = result.duration;
    if (result.tail !== false) {
      const t0 = duration, t1 = duration + 320 * (result.scaled ? scale : 1);
      let any = false;
      for (const k of ONE_CHANNELS) {
        if (Math.abs(b.cur(k) - P[k]) > 1e-3) { b.mv(t0, t1, { [k]: P[k] }, 'glide'); any = true; }
      }
      if (any) duration = t1;
    }
    const curves: Curves = {};
    for (const k of Object.keys(b.curves) as OneChannel[]) curves[k] = b.curves[k]!.map(([t, v, e]) => [t * factor, v, e] as Key);
    return { curves, duration: duration * factor, twos: result.twos === true };
  }

  /** Jump to the held face, ending any moment, talk, blink or follow. */
  snap(): void {
    this.timeline = null;
    this.current = null;
    this.talk = null;
    this.target = null;
    this.blinkStart = null;
    this.value = { ...this.held() };
  }

  /** Begin following the voice level while speaking (largest tier, motion allowed). */
  startTalk(at: number): boolean {
    if (!this.motion || this.face !== 'speaking' || !this.level || this.tier !== 'L' || this.talk) return false;
    this.talk = { mouth: 0, quiet: 0, blinked: false };
    this.target = null;
    this.last = Math.max(this.last, at);
    return true;
  }
  private stopTalk(): void {
    if (!this.talk) return;
    this.talk = null;
    this.value.mouth = 0;
  }

  private pose(at: number, value: { -readonly [K in OneChannel]: number }): void {
    const tl = this.timeline;
    if (!tl) return;
    const t = Math.min(at - tl.start, tl.duration);
    const quantized = tl.twos ? Math.floor(t / (2 * F) + 1e-6) * 2 * F : t;
    for (const k of Object.keys(tl.curves) as OneChannel[]) {
      value[k] = sampleCurve(tl.curves[k]!, ONE_BODY_CHANNELS.includes(k) ? quantized : t);
    }
  }

  private blinkFactor(at: number): number {
    let blink = 1 - this.manualBlink;
    if (this.blinkStart !== null && at - this.blinkStart <= 420) blink *= sampleCurve(blinkCurve, at - this.blinkStart);
    return blink;
  }

  private frame(value: OnePose, blink: number): OneMotionFrame {
    const pose = Object.freeze({ ...value });
    return Object.freeze({ face: this.face, tier: this.tier, pose, geometry: oneGeometry(pose, this.tier, this.kind, blink), moving: this.moving });
  }

  /** The frame at `at` without advancing: nothing finishes, eases or blinks. Safe for repainting mid-moment. */
  peek(at: number): OneMotionFrame {
    const value = { ...this.value };
    this.pose(Math.max(at, this.last), value);
    return this.frame(value, this.blinkFactor(Math.max(at, this.last)));
  }

  /**
   * Advance to `at`. Returns the frame and whether the current moment finished during this call.
   * Times must not decrease.
   */
  sample(at: number): { frame: OneMotionFrame; finished: OneMomentRequest | null } {
    const dt = clamp(at - this.last, 0, 100);
    this.last = Math.max(this.last, at);
    let finished: OneMomentRequest | null = null;
    const tl = this.timeline;
    if (tl) {
      this.pose(at, this.value);
      if (at - tl.start >= tl.duration) {
        for (const k of Object.keys(tl.curves) as OneChannel[]) { const c = tl.curves[k]!; this.value[k] = c[c.length - 1]![1]; }
        this.timeline = null;
        finished = this.current;
        this.current = null;
      }
    }
    if (this.talk) this.talkStep(dt);
    else if (this.target && !this.timeline) this.followStep(dt);
    const blink = this.blinkFactor(at);
    if (this.blinkStart !== null && at - this.blinkStart > 420) this.blinkStart = null;
    return { frame: this.frame(this.value, blink), finished };
  }

  /** The eye eases toward the pointer, at the face's own openness and level. */
  private followStep(dt: number): void {
    const target = this.target!;
    const P = this.held();
    const k = 1 - Math.exp(-dt / (Math.abs(target.x - this.value.look) > 0.15 ? 40 : 80));
    this.value.look += (target.x - this.value.look) * k;
    this.value.lift += (target.y - this.value.lift) * k;
    this.value.open += (P.open - this.value.open) * k;
    this.value.tilt += (0 - this.value.tilt) * k;
  }

  /**
   * Talk: the eye narrows to 0.6 under a full smile and faces the viewer; the mouth line is drawn only while
   * there is voice, fully opaque (0.45–1 of agent-eye's mouth), so a quiet syllable never flickers like a status
   * light. The mouth waits until the smile is half up, which keeps it at least 6 units from the eye.
   */
  private talkStep(dt: number): void {
    const talk = this.talk!;
    const level = clamp(Number(this.level!()) || 0, 0, 1);
    const target = level < 0.08 ? 0 : clamp(level * 1.4, 0, 1);
    talk.mouth += (target - talk.mouth) * (1 - Math.exp(-dt / (target > talk.mouth ? 30 : 90)));
    if (!this.timeline) {
      const k = 1 - Math.exp(-dt / 80);
      this.value.smile += (1 - this.value.smile) * k;
      this.value.open += (0.6 - this.value.open) * k;
      this.value.look += (0 - this.value.look) * k;
      this.value.lift += (0 - this.value.lift) * k;
      this.value.tilt += (0 - this.value.tilt) * k;
      this.value.mouth = talk.mouth < 0.02 || this.value.smile < 0.5 ? 0 : 0.45 + 0.55 * talk.mouth;
    }
    talk.quiet = level < 0.08 ? talk.quiet + dt : 0;
    if (talk.quiet > 600 && !talk.blinked && this.blinkStart === null) { this.blinkStart = this.last; talk.blinked = true; }
    if (talk.quiet === 0) talk.blinked = false;
  }

  private compose(name: OneMomentName, b: Builder, P: OnePose, scale: number, draw: () => number): Composed {
    const tier = this.tier, big = tier === 'M' || tier === 'L';
    const d = this.gaze.x < 0 ? -1 : 1;
    const t2 = this.temperament;
    switch (name) {
      case 'settle':
        b.mv(0, 160, pick(P, ONE_CHANNELS), 'ui');
        return { duration: 160, tail: false, noTempo: true };
      case 'home': {
        const t = saccade(b, 0, P.look, { lift: P.lift });
        b.mv(0, Math.max(t, 300), pick(P, ['open', 'tilt', 'smile', 'mouth', 'squash', 'rotate', 'hop']), 'glide');
        return { duration: Math.max(t, 300) };
      }
      case 'psst': {
        if (!big) {
          const t = saccade(b, 0, 0, { lift: 0, tilt: 0 });
          b.mv(0, t, { open: 1.12 }, 'snap');
          b.mv(t, t + 150, { open: 1.06 }, 'settle');
          return { duration: blinkAt(b, t + 200, 1.06, d) };
        }
        const hop = tier === 'L' ? 0.15 : 0.08;
        b.mv(0, 120, { squash: -6, open: 0.9, look: 0, lift: 0, tilt: 0, rotate: 0 }, 'wind');
        b.mv(120, 250, { hop: -hop, squash: 8, open: 1.18 }, 'snap');
        b.mv(250, 420, { hop: 0 }, 'fall');
        b.cut(420, { squash: -6 });
        b.mv(420, 700, { squash: 0 }, 'settle');
        b.mv(420, 520, { open: 1.06 }, 'settle');
        return { duration: blinkAt(b, 520, 1.06, d), twos: true };
      }
      case 'aha':
        b.mv(0, 180, { open: 1.1, look: 0, lift: 0, tilt: 0 }, 'snap');
        b.mv(180, 360, { open: 1 }, 'settle');
        return { duration: 360 };
      case 'smile': {
        // agent-eye's SMILE plays exactly while the eye narrows into a happy squint, turned toward its content
        // and tilted warm: a tall bar over the smile line would read as "!" on a coloured disc.
        const centred = Math.abs(this.gaze.x) < 0.15;
        b.mv(0, 300, { look: (centred ? 0.12 : 0.2) * d, lift: 0, tilt: 10 * d, open: tier === 'L' ? 0.6 : 0.42,
          rotate: big ? 4 * d : 0 }, 'glide');
        b.raw('smile', SMILE.smile, 300);
        b.raw('mouth', SMILE.mouth, 300);
        const pulse = 300 + 1460;
        if (t2 === 'bouncy') pulses(b, pulse, 3, 4, -2);
        else { b.cut(pulse, { squash: 3 }); b.mv(pulse, pulse + 300, { squash: 0 }, 'settle'); }
        return { duration: 300 + 2900 };
      }
      case 'nod':
        b.mv(0, 125, { squash: -6, lift: 0.4 }, 'snap');
        b.mv(125, 250, { squash: 3, lift: -0.1 });
        b.mv(250, 375, { squash: -4, lift: 0.3 });
        b.mv(375, 583, { squash: 0, lift: 0 }, 'settle');
        return { duration: 600 };
      case 'dizzy': {
        b.mv(0, 80, { open: 1.15, tilt: 0 }, 'snap');
        const n = big ? 18 : 10, turns = big ? 2 : 1;
        for (let i = 0; i <= n; i++) {
          const th = i / n * turns * 2 * Math.PI, t = 80 + i * F;
          b.cut(t, { look: 0.45 * Math.cos(th), lift: 0.8 * Math.sin(th), tilt: 16 * Math.sin(th), open: 0.82,
            ...(big ? { rotate: 5 * Math.cos(th) } : {}) });
        }
        const t = 80 + n * F + 20;
        b.mv(t, t + 270, { ...pick(P, ONE_FACE_CHANNELS), rotate: 0 }, 'settle');
        return { duration: t + 270 };
      }
      case 'dozeOff':
        b.mv(0, 600, { open: P.open, smile: 0, mouth: 0 }, 'glide');
        b.mv(0, 700, { tilt: P.tilt, lift: P.lift, look: P.look }, 'glide');
        if (tier === 'L') b.mv(0, 900, { squash: P.squash, rotate: P.rotate }, '~soft');
        return { duration: 900 };
      case 'wake':
        b.mv(0, 120, { open: 1.15, tilt: 0 }, 'snap');
        b.mv(0, 240, { squash: 0, rotate: 0 }, 'settle');
        saccade(b, 120, 0, { lift: 0 });
        return { duration: blinkAt(b, 300, 1, d) + 40 };
      case 'read': {
        // Tempo paces the gaps between jumps; the jumps themselves stay agent-eye's saccades.
        b.mv(0, 400 * scale, { open: 0.72, tilt: 0, smile: 0, mouth: 0 }, 'glide');
        let t = saccade(b, 0, -0.55, { lift: P.lift });
        const steps = 3 + Math.floor(draw() * 3);
        for (let i = 1; i <= steps; i++) { t += (160 + draw() * 180) * scale; saccade(b, t, -0.55 + 1.1 * i / steps); t += 150; }
        t += (200 + draw() * 250) * scale;
        if (draw() < 0.4) t = blinkAt(b, t, 0.72, d);
        return { duration: t + 160, scaled: true };
      }
      case 'ponder': {
        // Thinking starts with a quick glance up (agent-eye's saccade), then the slow drift of the master loop.
        const up = { look: 0.32 * d, open: 0.55, lift: -0.45, tilt: -8 * d };
        let t = 0;
        const entering = Math.abs(b.cur('look') - up.look) > 0.1 || Math.abs(b.cur('lift') - up.lift) > 0.1;
        if (entering) t = saccade(b, 0, up.look, { lift: up.lift, open: up.open, tilt: up.tilt, smile: 0, mouth: 0 });
        const drift = [{ look: 0.22 * d, open: 0.58 }, { look: up.look, open: up.open }, { look: 0.22 * d, open: 0.58 }];
        if (!entering) drift.unshift({ look: up.look, open: up.open });
        for (const step of drift) { b.mv(t, t + 550 * scale, step, 'glide'); t += 550 * scale; }
        if (!entering) b.mv(0, 550 * scale, { lift: up.lift, tilt: up.tilt, smile: 0, mouth: 0 }, 'glide');
        return { duration: t, scaled: true };
      }
      case 'keys': {
        let t = 0;
        const settled = pick(P, ['open', 'tilt', 'smile', 'mouth']);
        if (Math.abs(b.cur('lift') - P.lift) > 0.1 || Math.abs(b.cur('look') - P.look) > 0.1) {
          t = saccade(b, 0, P.look, { lift: P.lift, ...settled });
        } else if ((Object.keys(settled) as OneChannel[]).some(k => Math.abs(b.cur(k) - P[k]) > 1e-3)) {
          b.mv(0, 200, settled, 'glide');
          t = 200;
        }
        // Keystrokes: about a pixel or two of eye travel on twos, with a 2 % squash where the body may move.
        for (let burst = 0; burst < 2; burst++) {
          const n = 4 + Math.floor(draw() * 4);
          for (let i = 0; i < n; i++) {
            b.cut(t, { lift: P.lift + 0.25, ...(big ? { squash: P.squash - 2 } : {}) });
            b.cut(t + 2 * F, { lift: P.lift, squash: P.squash });
            t += 4 * F;
          }
          t += 200 + draw() * 250;
        }
        return { duration: t, tail: false };
      }
      case 'wave': {
        ([[-12, 4], [12, -3], [-8, 2], [6, -1]] as const).forEach(([tilt, rotate], i) => b.cut(i * 2 * F, { tilt, rotate }));
        b.mv(8 * F, 12 * F, { tilt: P.tilt, rotate: 0 }, 'settle');
        let duration = 12 * F;
        if (big && (t2 === 'quick' || t2 === 'bouncy')) {
          b.mv(12 * F, 15 * F, { hop: -0.06 }, 'rise');
          b.mv(15 * F, 19 * F, { hop: 0 }, 'fall');
          duration = 19 * F;
        }
        return { duration, twos: true };
      }
      case 'firstBlink': {
        // A new agent: the eye, shut (tilted, never a level bar), opens for the first time at the viewer; at 40 px
        // and up it glances at you, then looks toward its name.
        b.cut(0, { open: 0, look: 0, lift: 0, tilt: 7 * d, smile: 0, mouth: 0 });
        b.mv(300, 420, { open: 1.04, tilt: 0 }, 'snap');
        b.mv(420, 540, { open: 1 }, 'settle');
        if (!big) { b.mv(600, 760, { look: P.look, lift: P.lift }, 'glide'); return { duration: 760 }; }
        saccade(b, 600, 0, { lift: 0 });
        return { duration: saccade(b, 900, P.look, { lift: P.lift }) };
      }
      case 'lookAtYou': {
        // The website's look-at-you (DIGITAL-ONE move 4): square to the viewer, a blink at 60 % of the hold (shut
        // tilted, never a level bar), then back to the held face. Digital One holds deadpan and adds a dry chuckle at
        // 40 px and up; a bouncy One giggles twice.
        const dry = t2 === 'dry', open = dry ? 0.92 : 1.04, hold = 1100;
        b.mv(0, 250, { look: 0, lift: dry ? -0.05 : 0, open, tilt: 0, smile: 0, mouth: 0, rotate: 0 }, 'glide');
        if (big && dry) pulses(b, 300, 3, 2, -2);
        else if (big && t2 === 'bouncy') pulses(b, 250, 2, 4, -2);
        blinkAt(b, 250 + hold * 0.6, open, d);
        return { duration: 250 + hold };
      }
      case 'shrug': {
        // DIGITAL-ONE move 19: a wind, up and tipped about its base into "who knows?" (up and aside), a dead hold,
        // down on the bounce spring, then a look at the viewer. No mouth: a line under a raised eye reads as a sign.
        b.mv(0, 4 * F, { squash: -5 }, 'wind');
        b.mv(4 * F, 9 * F, { squash: 7, rotate: 10 * d, hop: -0.015 }, 'pop');
        b.mv(4 * F, 9 * F, { look: 0.3 * d, lift: -0.4, open: 0.9, tilt: 0, smile: 0, mouth: 0 }, 'snap');
        b.cut(875, { squash: -4 });
        b.mv(875, 1125, { squash: 0, rotate: 0, hop: 0 }, '~bounce');
        b.mv(1100, 1350, { look: 0, lift: 0, open: 1.04 }, 'glide');
        blinkAt(b, 1750, 1.04, d);
        return { duration: 2350, twos: true };
      }
      case 'popIn': {
        // An arrival (the website's pop-in, move 7). The host already shows the still head, so it does not grow from
        // nothing: the eye shuts (tilted), the head pops up with a stretch and lands squashed as the eye opens wide,
        // settles, then glances toward its content.
        const stretch = t2 === 'dry' ? 10 : 18, land = t2 === 'dry' ? -6 : -10;
        b.mv(0, 80, { open: 0, look: 0, lift: 0, tilt: 7 * d, smile: 0, mouth: 0, rotate: 0 }, 'shut');
        b.mv(80, 80 + 3 * F, { hop: -0.08, squash: stretch }, 'pop');
        b.mv(80 + 3 * F, 80 + 5 * F, { hop: 0 }, 'fall');
        b.mv(80 + 3 * F, 80 + 5 * F, { squash: land, open: 1.06, tilt: 0 }, 'snap');
        b.mv(80 + 5 * F, 80 + 7 * F, { squash: 4, open: 1 });
        b.mv(80 + 7 * F, 80 + 10 * F, { squash: 0 }, 'settle');
        return { duration: Math.max(saccade(b, 80 + 10 * F, P.look, { lift: P.lift }), 680), twos: true };
      }
    }
  }
}

/** Validate One-family live options shared by the animator and the browser player. */
export function parseOneLiveOptions(cadence: unknown, voiceLevel: unknown): { cadence: OneCadence; voiceLevel?: () => number } {
  if (cadence !== undefined && cadence !== 'brief' && cadence !== 'repeat') throw new TypeError('Character cadence must be brief or repeat');
  if (voiceLevel !== undefined && typeof voiceLevel !== 'function') throw new TypeError('Character voiceLevel must be a function');
  return { cadence: cadence ?? 'brief', ...(voiceLevel === undefined ? {} : { voiceLevel: voiceLevel as () => number }) };
}

/** A small deterministic generator (mulberry32) seeded from four bytes. */
export function seededRandom(seed: Uint8Array, offset = 0): () => number {
  let state = (seed[offset]! | seed[offset + 1]! << 8 | seed[offset + 2]! << 16 | seed[offset + 3]! << 24) >>> 0;
  return () => {
    state = state + 0x6d2b79f5 >>> 0;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
