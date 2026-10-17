/**
 * The One family's live timeline: a held face per state, a short moment when the state changes,
 * a brief cadence for ongoing work, and nothing at rest. Pure and clock-driven (milliseconds on the
 * caller's clock); randomness comes from a seeded generator, so a given DID and clock replay exactly.
 *
 * Moments use agent-eye's curve format and eases, ported from the One app avatar prototype
 * (AVATARS.md §2.4), which in turn ports the website mascot's motion vocabulary.
 */
import { M_PI, clamp, freeze, mAbs, mCos, mExp, mFloor, mImul, mMax, mMin, mSin, mSqrt, objectEntries, objectFromEntries, objectKeys } from './character-intrinsics.js';
import { oneError } from './one-error.js';
import { BLINK, ONE_EASE as EASE, SMILE, cubicBezier, type AgentEyeKey } from './agent-eye.js';
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
export const ONE_GESTURES: readonly OneGesture[] = freeze(['lookAtYou', 'nod', 'smile', 'wave', 'shrug', 'popIn']);

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

type Ease = Exclude<AgentEyeKey[2], undefined> | 'wind' | 'pop' | 'rise' | 'fall' | 'ui' |
  '~firm' | '~bounce' | '~soft';
type Key = [number, number, Ease?];
type Curves = Partial<Record<OneChannel, Key[]>>;

const F = 1000 / 24; // one frame on the 24 fps grid
/** A smile line is withdrawn over this long before any moment moves the eye (agent-eye's minimum gap of 6 units). */
export const ONE_MOUTH_RETRACT_MS = 120;
/** How many uniform draws a moment may use; no moment uses more. */
export const ONE_MOMENT_DRAWS = 16;
const bodyEases: Readonly<Record<string, readonly [number, number, number, number]>> = {
  wind: [0.45, 0, 0.55, 1], pop: [0.34, 1.56, 0.64, 1],
  rise: [0.5, 1, 0.89, 1], fall: [0.11, 0, 0.5, 0], ui: [0.16, 1, 0.3, 1],
};
const easeFns = new Map<string, (x: number) => number>(
  [...objectEntries(EASE), ...objectEntries(bodyEases)].map(([name, v]) => [name, cubicBezier(v[0], v[1], v[2], v[3])]));
const springs: Readonly<Record<string, readonly [number, number]>> = {
  firm: [0.26, 0.7], bounce: [0.36, 0.45], soft: [0.6, 0.85],
};
function springAt(name: string, sec: number): number {
  const [period, zeta] = springs[name] ?? springs.firm!;
  const w0 = 2 * M_PI / period, wd = w0 * mSqrt(1 - zeta * zeta);
  return 1 - mExp(-zeta * w0 * sec) * (mCos(wd * sec) + zeta * w0 / wd * mSin(wd * sec));
}
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
interface Builder {
  readonly curves: Curves;
  cur(k: OneChannel): number;
  mv(t0: number, t1: number, values: Partial<OnePose>, ease?: Ease): void;
  cut(t: number, values: Partial<OnePose>): void;
  raw(k: OneChannel, curve: readonly AgentEyeKey[], at: number): void;
}
function createBuilder(live: OnePose): Builder {
  const curves: Curves = {};
  const channel = (k: OneChannel): Key[] => curves[k] ??= [[0, live[k]]];
  return {
    curves,
    cur(k) { const c = curves[k]; return c ? c[c.length - 1]![1] : live[k]; },
    mv(t0, t1, values, ease = 'linear') {
      for (const k of objectKeys(values) as OneChannel[]) {
        const c = channel(k);
        const [lt, lv] = c[c.length - 1]!;
        if (t0 > lt) c.push([t0, lv]);
        c.push([mMax(t1, c[c.length - 1]![0]), values[k]!, ease]);
      }
    },
    cut(t, values) {
      for (const k of objectKeys(values) as OneChannel[]) {
        const c = channel(k);
        const [lt, lv] = c[c.length - 1]!;
        const t0 = mMax(lt, t - 0.5);
        if (t0 > lt) c.push([t0, lv]);
        c.push([mMax(t, t0), values[k]!, 'linear']);
      }
    },
    raw(k, curve, at) {
      const c = channel(k);
      c.push([mMax(at, c[c.length - 1]![0]), curve[0]![1]]);
      for (const [t, v, e] of curve.slice(1)) c.push([at + t * 1000, v, e]);
    },
  };
}

/** agent-eye's saccade: 110 ms + 110 per unit of look, 7 % overshoot, 160 ms settle. */
function saccade(b: Builder, t: number, to: number, extra: Partial<OnePose> = {}): number {
  const from = b.cur(ONE_CHANNELS[0]!), d = 110 + 110 * mAbs(to - from);
  b.mv(t, t + d, { look: to + (to - from) * 0.07, ...extra }, 'snap');
  b.mv(t + d, t + d + 160, { look: to }, 'settle');
  return t + d + 160;
}
/**
 * agent-eye's BLINK on an openness: 80 ms shut, held 50, opens to 1.04 by 300, settles by 420. A centred, level
 * eye shuts tilted by 7°, so for those frames a disc never shows a level bar that reads as a No Entry sign.
 */
function blinkAt(b: Builder, t: number, open: number, d: number): number {
  const tilt = b.cur(ONE_CHANNELS[3]!);
  const level = mAbs(tilt) < 4 && mAbs(b.cur(ONE_CHANNELS[0]!)) < 0.15;
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
  objectFromEntries(keys.map(k => [k, pose[k]])) as Partial<OnePose>;

const tempo: Readonly<Record<OneTemperament, number>> = freeze({ quick: 0.85, bouncy: 0.95, neat: 1, slow: 1.18, dry: 1.075 });
const tierTempo: Readonly<Record<OneTier, number>> = freeze({ XS: 1, S: 0.9, M: 1, L: 1.1 });
const ongoing: Readonly<Record<string, OneMomentName>> = freeze({ working: 'read', thinking: 'ponder', typing: 'keys' });
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
export interface OneMotion {
  face: OneFace;
  readonly tier: OneTier;
  readonly timelineEnd: number | null;
  setBlink(blink: number): void;
  readonly moving: boolean;
  readonly request: OneMomentRequest | null;
  readonly following: boolean;
  held(): OnePose;
  setFace(face: OneFace, gaze: { readonly x: number; readonly y: number }, at: number): OneMomentRequest | null;
  entrance(previous: OneFace, next: OneFace): OneMomentRequest;
  cadenceRequest(): OneMomentRequest | null;
  nextCadence(at: number): number | null;
  restartWindow(at: number): void;
  noteInput(at: number): void;
  setSize(px: number): void;
  setKind(kind: OneKind): void;
  readonly temperament: OneTemperament;
  setMotion(allowed: boolean): void;
  follow(target: { readonly x: number; readonly y: number } | null): boolean;
  start(request: OneMomentRequest, at: number): void;
  snap(): void;
  startTalk(at: number): boolean;
  peek(at: number): OneMotionFrame;
  sample(at: number): { frame: OneMotionFrame; finished: OneMomentRequest | null };
}

/** Per-head state is closed over by its operations; the constructable interface is preserved and instances retain their constructor prototype. */
export class OneMotion {
  constructor(options: OneMotionOptions) {
    let _stateface: OneFace;
    let _state_oneGaze: { x: number; y: number };
    let _state_onePx: number;
    let _state_oneKind: OneKind;
    let _state_oneRandom: () => number;
    let _state_oneCadenceMode: OneCadence;
    let _state_oneLevel: (() => number) | undefined;
    let _state_oneMotion: boolean;
    let _state_oneValue: { -readonly [K in OneChannel]: number };
    let _state_oneTimeline: Timeline | null = null;
    let _state_oneCurrent: OneMomentRequest | null = null;
    let _state_onePending: OneMomentRequest | null = null;
    let _state_oneTalk: { mouth: number; quiet: number; blinked: boolean } | null = null;
    let _state_oneTarget: { x: number; y: number } | null = null;
    let _state_oneBlinkStart: number | null = null;
    let _state_oneManualBlink = 0;
    let _state_oneLast: number;
    let _state_oneEntered: number;
    let _state_oneInput: number;
    function _gettier(): OneTier {
        return oneTier(_state_onePx);
    }

    function _gettimelineEnd(): number | null {
        return _state_oneTimeline ? _state_oneTimeline.start + _state_oneTimeline.duration : null;
    }

    function _callsetBlink(blink: number): void {
        _state_oneManualBlink = clamp(blink, 0, 1);
    }

    function _getmoving(): boolean {
        return _state_oneTimeline !== null || _state_oneTalk !== null || _state_oneBlinkStart !== null || _state_oneTarget !== null;
    }

    function _getrequest(): OneMomentRequest | null {
        return _state_oneCurrent;
    }

    function _getfollowing(): boolean {
        return _state_oneTarget !== null;
    }

    function _callheld(): OnePose {
        return oneHeldPose(_stateface, _state_oneGaze, _state_onePx);
    }

    function _callsetFace(face: OneFace, gaze: { readonly x: number; readonly y: number }, at: number): OneMomentRequest | null {
        const previous = _stateface;
        const aimed = gaze.x !== _state_oneGaze.x || gaze.y !== _state_oneGaze.y;
        if (face === previous && !aimed)
            return null;
        _stateface = face;
        _state_oneGaze = { ...gaze };
        _state_onePending = null;
        if (face !== previous)
            _state_oneEntered = at;
        _call_oneStopTalk();
        if (!followable.has(face))
            _state_oneTarget = null;
        if (!_state_oneMotion) {
            _callsnap();
            return null;
        }
        return face === previous ? { name: 'home', priority: 0 } : _callentrance(previous, face);
    }

    function _callentrance(previous: OneFace, next: OneFace): OneMomentRequest {
        if (_gettier() === 'XS')
            return { name: 'settle', priority: 0, uncounted: true };
        const big = _gettier() === 'M' || _gettier() === 'L';
        if (next === 'attention')
            return { name: 'psst', priority: 6 };
        if (next === 'error')
            return { name: 'dizzy', priority: 5 };
        if (next === 'done')
            return { name: big ? 'smile' : 'nod', priority: 4 };
        if (asleep.has(previous) && !asleep.has(next))
            return { name: 'wake', priority: 3 };
        if (next === 'paused')
            return { name: 'dozeOff', priority: 3 };
        if (pondering.has(previous) && !pondering.has(next))
            return { name: 'aha', priority: 3 };
        if (next === 'working')
            return { name: 'read', priority: 2 };
        if (next === 'thinking')
            return { name: 'ponder', priority: 1 };
        if (next === 'typing')
            return { name: 'keys', priority: 2 };
        return { name: 'home', priority: 0 };
    }

    function _callcadenceRequest(): OneMomentRequest | null {
        const name = ongoing[_stateface];
        if (!name || !_state_oneMotion || _gettier() === 'XS')
            return null;
        if (_state_onePending?.name === name)
            return _state_onePending;
        return { name, priority: _stateface === 'thinking' ? 1 : 2, cadence: true };
    }

    function _callnextCadence(at: number): number | null {
        _state_onePending = null;
        const request = _callcadenceRequest();
        if (!request)
            return null;
        if (_state_oneCadenceMode === 'brief') {
            const gap = 300 + _state_oneRandom() * 400;
            const measured = { ...request, draws: freeze(Array.from({ length: ONE_MOMENT_DRAWS }, () => _state_oneRandom())) };
            const length = _call_onePlan(measured, _callheld()).duration;
            if (_state_oneEntered + 5000 - at < gap + length)
                return null;
            _state_onePending = measured;
            return gap;
        }
        if (at - _state_oneInput > 60000)
            return null;
        // Every ongoing state, typing included, repeats one cluster every six to ten seconds (AVATARS.md §2.3 rule 6).
        return 6000 + _state_oneRandom() * 4000;
    }

    function _callrestartWindow(at: number): void {
        _state_oneEntered = at;
    }

    function _callnoteInput(at: number): void {
        _state_oneInput = at;
    }

    function _callsetSize(px: number): void {
        _state_onePx = px;
        if (!_getmoving())
            _state_oneValue = { ..._callheld() };
    }

    function _callsetKind(kind: OneKind): void {
        _state_oneKind = kind;
    }

    function _gettemperament(): OneTemperament {
        return oneTemperament(_state_oneKind);
    }

    function _callsetMotion(allowed: boolean): void {
        _state_oneMotion = allowed;
        if (!allowed)
            _callsnap();
    }

    function _callfollow(target: { readonly x: number; readonly y: number } | null): boolean {
        if (target === null || !_state_oneMotion || !followable.has(_stateface) || (_gettier() !== 'M' && _gettier() !== 'L')) {
            _state_oneTarget = null;
            return false;
        }
        _state_oneTarget = { x: clamp(target.x, -1, 1), y: clamp(target.y, -1, 1) };
        return true;
    }

    function _callstart(request: OneMomentRequest, at: number): void {
        if (!_state_oneMotion)
            return;
        // A visible smile line is withdrawn first, so no moment moves the eye toward it.
        const lead = _state_oneValue.mouth > 0 ? ONE_MOUTH_RETRACT_MS : 0;
        const planned = _call_onePlan(request, lead ? { ..._state_oneValue, mouth: 0 } : { ..._state_oneValue });
        const curves: Curves = {};
        for (const k of objectKeys(planned.curves) as OneChannel[])
            curves[k] = planned.curves[k]!.map(([t, v, e]) => [t + lead, v, e] as Key);
        if (lead)
            curves.mouth = [[0, _state_oneValue.mouth], [lead, 0, 'glide'], ...(curves.mouth ?? []).slice(1)];
        _state_oneTimeline = { curves, start: at, duration: planned.duration + lead, twos: planned.twos };
        _state_oneCurrent = request;
        _state_oneTarget = null;
        _state_oneLast = mMax(_state_oneLast, at);
    }

    function _call_onePlan(request: OneMomentRequest, live: OnePose): { curves: Curves; duration: number; twos: boolean } {
        const b = createBuilder(live);
        const P = _callheld();
        let index = 0;
        const draw = (): number => request.draws && index < request.draws.length ? request.draws[index++]! : _state_oneRandom();
        const scale = tempo[_gettemperament()] * tierTempo[_gettier()];
        const result = _call_oneCompose(request.name, b, P, scale, draw);
        const factor = result.noTempo || result.scaled ? 1 : scale;
        let duration = result.duration;
        if (result.tail !== false) {
            const t0 = duration, t1 = duration + 320 * (result.scaled ? scale : 1);
            let any = false;
            for (const k of ONE_CHANNELS) {
                if (mAbs(b.cur(k) - P[k]) > 1e-3) {
                    b.mv(t0, t1, { [k]: P[k] }, 'glide');
                    any = true;
                }
            }
            if (any)
                duration = t1;
        }
        const curves: Curves = {};
        for (const k of objectKeys(b.curves) as OneChannel[])
            curves[k] = b.curves[k]!.map(([t, v, e]) => [t * factor, v, e] as Key);
        return { curves, duration: duration * factor, twos: result.twos === true };
    }

    function _callsnap(): void {
        _state_oneTimeline = null;
        _state_oneCurrent = null;
        _state_oneTalk = null;
        _state_oneTarget = null;
        _state_oneBlinkStart = null;
        _state_oneValue = { ..._callheld() };
    }

    function _callstartTalk(at: number): boolean {
        if (!_state_oneMotion || _stateface !== 'speaking' || !_state_oneLevel || _gettier() !== 'L' || _state_oneTalk)
            return false;
        _state_oneTalk = { mouth: 0, quiet: 0, blinked: false };
        _state_oneTarget = null;
        _state_oneLast = mMax(_state_oneLast, at);
        return true;
    }

    function _call_oneStopTalk(): void {
        if (!_state_oneTalk)
            return;
        _state_oneTalk = null;
        _state_oneValue.mouth = 0;
    }

    function _call_onePose(at: number, value: { -readonly [K in OneChannel]: number }): void {
        const tl = _state_oneTimeline;
        if (!tl)
            return;
        const t = mMin(at - tl.start, tl.duration);
        const quantized = tl.twos ? mFloor(t / (2 * F) + 1e-6) * 2 * F : t;
        for (const k of objectKeys(tl.curves) as OneChannel[]) {
            value[k] = sampleCurve(tl.curves[k]!, ONE_BODY_CHANNELS.includes(k) ? quantized : t);
        }
    }

    function _call_oneBlinkFactor(at: number): number {
        let blink = 1 - _state_oneManualBlink;
        if (_state_oneBlinkStart !== null && at - _state_oneBlinkStart <= 420)
            blink *= sampleCurve(blinkCurve, at - _state_oneBlinkStart);
        return blink;
    }

    function _call_oneFrame(value: OnePose, blink: number): OneMotionFrame {
        const pose = freeze({ ...value });
        return freeze({ face: _stateface, tier: _gettier(), pose, geometry: oneGeometry(pose, _gettier(), _state_oneKind, blink), moving: _getmoving() });
    }

    function _callpeek(at: number): OneMotionFrame {
        const value = { ..._state_oneValue };
        _call_onePose(mMax(at, _state_oneLast), value);
        return _call_oneFrame(value, _call_oneBlinkFactor(mMax(at, _state_oneLast)));
    }

    function _callsample(at: number): { frame: OneMotionFrame; finished: OneMomentRequest | null } {
        const dt = clamp(at - _state_oneLast, 0, 100);
        _state_oneLast = mMax(_state_oneLast, at);
        let finished: OneMomentRequest | null = null;
        const tl = _state_oneTimeline;
        if (tl) {
            _call_onePose(at, _state_oneValue);
            if (at - tl.start >= tl.duration) {
                for (const k of objectKeys(tl.curves) as OneChannel[]) {
                    const c = tl.curves[k]!;
                    _state_oneValue[k] = c[c.length - 1]![1];
                }
                _state_oneTimeline = null;
                finished = _state_oneCurrent;
                _state_oneCurrent = null;
            }
        }
        if (_state_oneTalk)
            _call_oneTalkStep(dt);
        else if (_state_oneTarget && !_state_oneTimeline)
            _call_oneFollowStep(dt);
        const blink = _call_oneBlinkFactor(at);
        if (_state_oneBlinkStart !== null && at - _state_oneBlinkStart > 420)
            _state_oneBlinkStart = null;
        return { frame: _call_oneFrame(_state_oneValue, blink), finished };
    }

    function _call_oneFollowStep(dt: number): void {
        const target = _state_oneTarget!;
        const P = _callheld();
        const k = 1 - mExp(-dt / (mAbs(target.x - _state_oneValue.look) > 0.15 ? 40 : 80));
        _state_oneValue.look += (target.x - _state_oneValue.look) * k;
        _state_oneValue.lift += (target.y - _state_oneValue.lift) * k;
        _state_oneValue.open += (P.open - _state_oneValue.open) * k;
        _state_oneValue.tilt += (0 - _state_oneValue.tilt) * k;
    }

    function _call_oneTalkStep(dt: number): void {
        const talk = _state_oneTalk!;
        const level = clamp(Number(_state_oneLevel!()) || 0, 0, 1);
        const target = level < 0.08 ? 0 : clamp(level * 1.4, 0, 1);
        talk.mouth += (target - talk.mouth) * (1 - mExp(-dt / (target > talk.mouth ? 30 : 90)));
        if (!_state_oneTimeline) {
            const k = 1 - mExp(-dt / 80);
            _state_oneValue.smile += (1 - _state_oneValue.smile) * k;
            _state_oneValue.open += (0.6 - _state_oneValue.open) * k;
            _state_oneValue.look += (0 - _state_oneValue.look) * k;
            _state_oneValue.lift += (0 - _state_oneValue.lift) * k;
            _state_oneValue.tilt += (0 - _state_oneValue.tilt) * k;
            _state_oneValue.mouth = talk.mouth < 0.02 || _state_oneValue.smile < 0.5 ? 0 : 0.45 + 0.55 * talk.mouth;
        }
        talk.quiet = level < 0.08 ? talk.quiet + dt : 0;
        if (talk.quiet > 600 && !talk.blinked && _state_oneBlinkStart === null) {
            _state_oneBlinkStart = _state_oneLast;
            talk.blinked = true;
        }
        if (talk.quiet === 0)
            talk.blinked = false;
    }

    function _call_oneCompose(name: OneMomentName, b: Builder, P: OnePose, scale: number, draw: () => number): Composed {
        const tier = _gettier(), big = tier === 'M' || tier === 'L';
        const d = _state_oneGaze.x < 0 ? -1 : 1;
        const t2 = _gettemperament();
        switch (name) {
            case 'settle':
                b.mv(0, 160, pick(P, ONE_CHANNELS), 'ui');
                return { duration: 160, tail: false, noTempo: true };
            case 'home': {
                const t = saccade(b, 0, P.look, { lift: P.lift });
                b.mv(0, mMax(t, 300), pick(P, [ONE_CHANNELS[2]!, ONE_CHANNELS[3]!, ONE_CHANNELS[4]!, ONE_CHANNELS[5]!, ONE_CHANNELS[6]!, ONE_CHANNELS[7]!, ONE_CHANNELS[8]!]), 'glide');
                return { duration: mMax(t, 300) };
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
                const centred = mAbs(_state_oneGaze.x) < 0.15;
                b.mv(0, 300, { look: (centred ? 0.12 : 0.2) * d, lift: 0, tilt: 10 * d, open: tier === 'L' ? 0.6 : 0.42,
                    rotate: big ? 4 * d : 0 }, 'glide');
                b.raw(ONE_CHANNELS[4]!, SMILE.smile, 300);
                b.raw(ONE_CHANNELS[5]!, SMILE.mouth, 300);
                const pulse = 300 + 1460;
                if (t2 === 'bouncy')
                    pulses(b, pulse, 3, 4, -2);
                else {
                    b.cut(pulse, { squash: 3 });
                    b.mv(pulse, pulse + 300, { squash: 0 }, 'settle');
                }
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
                    const th = i / n * turns * 2 * M_PI, t = 80 + i * F;
                    b.cut(t, { look: 0.45 * mCos(th), lift: 0.8 * mSin(th), tilt: 16 * mSin(th), open: 0.82,
                        ...(big ? { rotate: 5 * mCos(th) } : {}) });
                }
                const t = 80 + n * F + 20;
                b.mv(t, t + 270, { ...pick(P, ONE_FACE_CHANNELS), rotate: 0 }, 'settle');
                return { duration: t + 270 };
            }
            case 'dozeOff':
                b.mv(0, 600, { open: P.open, smile: 0, mouth: 0 }, 'glide');
                b.mv(0, 700, { tilt: P.tilt, lift: P.lift, look: P.look }, 'glide');
                if (tier === 'L')
                    b.mv(0, 900, { squash: P.squash, rotate: P.rotate }, '~soft');
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
                const steps = 3 + mFloor(draw() * 3);
                for (let i = 1; i <= steps; i++) {
                    t += (160 + draw() * 180) * scale;
                    saccade(b, t, -0.55 + 1.1 * i / steps);
                    t += 150;
                }
                t += (200 + draw() * 250) * scale;
                if (draw() < 0.4)
                    t = blinkAt(b, t, 0.72, d);
                return { duration: t + 160, scaled: true };
            }
            case 'ponder': {
                // Thinking starts with a quick glance up (agent-eye's saccade), then the slow drift of the master loop.
                const up = { look: 0.32 * d, open: 0.55, lift: -0.45, tilt: -8 * d };
                let t = 0;
                const entering = mAbs(b.cur(ONE_CHANNELS[0]!) - up.look) > 0.1 || mAbs(b.cur(ONE_CHANNELS[1]!) - up.lift) > 0.1;
                if (entering)
                    t = saccade(b, 0, up.look, { lift: up.lift, open: up.open, tilt: up.tilt, smile: 0, mouth: 0 });
                const drift = [{ look: 0.22 * d, open: 0.58 }, { look: up.look, open: up.open }, { look: 0.22 * d, open: 0.58 }];
                if (!entering)
                    drift.unshift({ look: up.look, open: up.open });
                for (const step of drift) {
                    b.mv(t, t + 550 * scale, step, 'glide');
                    t += 550 * scale;
                }
                if (!entering)
                    b.mv(0, 550 * scale, { lift: up.lift, tilt: up.tilt, smile: 0, mouth: 0 }, 'glide');
                return { duration: t, scaled: true };
            }
            case 'keys': {
                let t = 0;
                const settled = pick(P, [ONE_CHANNELS[2]!, ONE_CHANNELS[3]!, ONE_CHANNELS[4]!, ONE_CHANNELS[5]!]);
                if (mAbs(b.cur(ONE_CHANNELS[1]!) - P.lift) > 0.1 || mAbs(b.cur(ONE_CHANNELS[0]!) - P.look) > 0.1) {
                    t = saccade(b, 0, P.look, { lift: P.lift, ...settled });
                }
                else if ((objectKeys(settled) as OneChannel[]).some(k => mAbs(b.cur(k) - P[k]) > 1e-3)) {
                    b.mv(0, 200, settled, 'glide');
                    t = 200;
                }
                // Keystrokes: about a pixel or two of eye travel on twos, with a 2 % squash where the body may move.
                for (let burst = 0; burst < 2; burst++) {
                    const n = 4 + mFloor(draw() * 4);
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
                if (!big) {
                    b.mv(600, 760, { look: P.look, lift: P.lift }, 'glide');
                    return { duration: 760 };
                }
                saccade(b, 600, 0, { lift: 0 });
                return { duration: saccade(b, 900, P.look, { lift: P.lift }) };
            }
            case 'lookAtYou': {
                // The website's look-at-you (DIGITAL-ONE move 4): square to the viewer, a blink at 60 % of the hold (shut
                // tilted, never a level bar), then back to the held face. Digital One holds deadpan and adds a dry chuckle at
                // 40 px and up; a bouncy One giggles twice.
                const dry = t2 === 'dry', open = dry ? 0.92 : 1.04, hold = 1100;
                b.mv(0, 250, { look: 0, lift: dry ? -0.05 : 0, open, tilt: 0, smile: 0, mouth: 0, rotate: 0 }, 'glide');
                if (big && dry)
                    pulses(b, 300, 3, 2, -2);
                else if (big && t2 === 'bouncy')
                    pulses(b, 250, 2, 4, -2);
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
                return { duration: mMax(saccade(b, 80 + 10 * F, P.look, { lift: P.lift }), 680), twos: true };
            }
        }
    }

    _stateface = options.face;
    _state_oneGaze = { ...options.gaze };
    _state_onePx = options.px;
    _state_oneKind = options.kind;
    _state_oneRandom = options.random;
    _state_oneCadenceMode = options.cadence;
    _state_oneLevel = options.level;
    _state_oneMotion = options.motion;
    _state_oneLast = _state_oneEntered = _state_oneInput = options.at;
    _state_oneValue = { ..._callheld() };

    const api: OneMotion = {
      get face() { return _stateface; }, set face(value: OneFace) { _stateface = value; },
      get tier() { return _gettier(); },
      get timelineEnd() { return _gettimelineEnd(); },
      setBlink: _callsetBlink,
      get moving() { return _getmoving(); },
      get request() { return _getrequest(); },
      get following() { return _getfollowing(); },
      held: _callheld,
      setFace: _callsetFace,
      entrance: _callentrance,
      cadenceRequest: _callcadenceRequest,
      nextCadence: _callnextCadence,
      restartWindow: _callrestartWindow,
      noteInput: _callnoteInput,
      setSize: _callsetSize,
      setKind: _callsetKind,
      get temperament() { return _gettemperament(); },
      setMotion: _callsetMotion,
      follow: _callfollow,
      start: _callstart,
      snap: _callsnap,
      startTalk: _callstartTalk,
      peek: _callpeek,
      sample: _callsample
    };
    return Object.setPrototypeOf(api, new.target.prototype);
  }
}

/** Validate One-family live options shared by the animator and the browser player. */
export function parseOneLiveOptions(cadence: unknown, voiceLevel: unknown): { cadence: OneCadence; voiceLevel?: () => number } {
  if (cadence !== undefined && cadence !== 'brief' && cadence !== 'repeat') throw new TypeError(oneError(33, () => ('Character cadence must be brief or repeat')));
  if (voiceLevel !== undefined && typeof voiceLevel !== 'function') throw new TypeError(oneError(34, () => ('Character voiceLevel must be a function')));
  return { cadence: cadence ?? 'brief', ...(voiceLevel === undefined ? {} : { voiceLevel: voiceLevel as () => number }) };
}

/** A small deterministic generator (mulberry32) seeded from four bytes. */
export function seededRandom(seed: Uint8Array, offset = 0): () => number {
  let state = (seed[offset]! | seed[offset + 1]! << 8 | seed[offset + 2]! << 16 | seed[offset + 3]! << 24) >>> 0;
  return () => {
    state = state + 0x6d2b79f5 >>> 0;
    let t = state;
    t = mImul(t ^ t >>> 15, t | 1);
    t ^= t + mImul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
