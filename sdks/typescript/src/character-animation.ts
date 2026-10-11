/** Clock-driven live eyes for browser, native, and harness clients. No DOM required. */
import { blake3 } from '@noble/hashes/blake3';
import { generateCharacter, expressionEyes, type CharacterOptions } from './characters.js';
import { characterStateRecord, parseCharacterState, type AvatarExpression,
  type CharacterRuntimeState, type CharacterStateUpdate } from './character-state.js';

export interface CharacterAnimatorOptions extends CharacterOptions {
  /** Approximate settling time. Valid range: 80–2000 ms; default: 420 ms. */
  readonly transitionMs?: number;
  readonly reducedMotion?: boolean;
  readonly now?: () => number;
}
export interface CharacterEyeFrame {
  readonly x: number; readonly y: number; readonly width: number; readonly height: number;
  readonly rx: number; readonly rotation: number; readonly centerX: number; readonly centerY: number;
}
export interface CharacterFrame extends CharacterRuntimeState {
  readonly eyes: readonly [CharacterEyeFrame, CharacterEyeFrame];
}
export interface CharacterAnimator {
  sample(atMs?: number): CharacterFrame;
  update(state: CharacterStateUpdate, atMs?: number): CharacterRuntimeState;
  getState(): CharacterRuntimeState;
  setReducedMotion(value: boolean, atMs?: number): void;
}

interface Spring { value: number; velocity: number; target: number }
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const ease = (value: number): number => { const t = clamp(value, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };

function pose(state: CharacterRuntimeState): number[] {
  return [...expressionEyes[state.expression][0], ...expressionEyes[state.expression][1], state.gaze.x, state.gaze.y, state.blink];
}

/** A single timeline: interruptions preserve both eye position and velocity. */
export function createCharacterAnimator(did: string, options: CharacterAnimatorOptions = {}): CharacterAnimator {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Invalid animator options');
  const { transitionMs = 420, reducedMotion = false, now = () => globalThis.performance?.now() ?? Date.now(), ...characterOptions } = options;
  if (typeof transitionMs !== 'number' || !Number.isFinite(transitionMs) || transitionMs < 80 || transitionMs > 2000) {
    throw new RangeError('Character transitionMs must be from 80 to 2000');
  }
  if (typeof reducedMotion !== 'boolean' || typeof now !== 'function') throw new TypeError('Invalid animator clock or motion preference');
  const descriptor = generateCharacter(did, characterOptions);
  let state = parseCharacterState(characterOptions.state ?? {}, characterOptions.expression ?? 'neutral');
  let override: AvatarExpression | undefined = characterOptions.state?.expression;
  let reduced = reducedMotion;
  const seed = blake3(new TextEncoder().encode(`oaid-live-eyes-v1\u0000${did}`));
  const period = 3800 + seed[0]! / 255 * 2500;
  const phase = seed[1]! / 255 * (period - 300);
  const gazePeriod = 2400 + seed[2]! / 255 * 700;
  const gazePhase = seed[3]! / 255 * gazePeriod;
  const omega = 6 / (transitionMs / 1000);
  let last = -Infinity;
  last = time(now());
  const start = last;
  const springs: Spring[] = pose(state).map(value => ({ value, target: value, velocity: 0 }));
  function time(value: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (last !== undefined && value < last)) {
      throw new RangeError('Character timestamps must be finite, nonnegative, and nondecreasing');
    }
    return value;
  }
  function instant(): boolean { return reduced || !descriptor.animated; }
  function advance(at: number): void {
    const dt = (at - last) / 1000;
    for (const spring of springs) {
      if (instant()) { spring.value = spring.target; spring.velocity = 0; continue; }
      // Exp(-x) is effectively zero here. Avoid Infinity * 0 after very long suspensions.
      if (omega * dt > 100) { spring.value = spring.target; spring.velocity = 0; continue; }
      const offset = spring.value - spring.target;
      const b = spring.velocity + omega * offset;
      const decay = Math.exp(-omega * dt);
      spring.value = spring.target + (offset + b * dt) * decay;
      spring.velocity = (spring.velocity - omega * b * dt) * decay;
    }
    last = at;
  }
  function fixation(index: number, axis: number): number {
    // Stable pseudo-random fixations, with no randomness or timers outside this identity.
    let n = (index | 0) ^ (seed[4 + axis]! * 0x01010101);
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    return (((n ^ (n >>> 16)) >>> 0) / 0xffffffff * 2 - 1) * (axis === 0 ? 0.3 : 0.22);
  }
  function ambient(at: number): { blink: number; x: number; y: number } {
    if (instant()) return { blink: 0, x: 0, y: 0 };
    const elapsed = at - start;
    const blinkTime = (elapsed + phase) % period;
    const blink = blinkTime < 80 ? ease(blinkTime / 80) : blinkTime < 230 ? 1 - ease((blinkTime - 80) / 150) : 0;
    const gazeTime = (elapsed + gazePhase) / gazePeriod;
    const index = Math.floor(gazeTime);
    // Hold a fixation, then make a short eased movement; eyes do not swim continuously.
    const mix = ease(((gazeTime - index) - 0.76) / 0.24);
    const axis = (axis: number) => fixation(index, axis) * (1 - mix) + fixation(index + 1, axis) * mix;
    return { blink, x: axis(0), y: axis(1) };
  }
  const api: CharacterAnimator = {
    sample(atMs = now()) {
      const at = time(atMs);
      advance(at);
      const motion = ambient(at);
      const manualBlink = clamp(springs[10]!.value, 0, 1);
      const blink = 1 - (1 - manualBlink) * (1 - motion.blink);
      const x = clamp(springs[8]!.value, -1, 1);
      const y = clamp(springs[9]!.value, -1, 1);
      const gaze = Object.freeze({ x: x + (1 - Math.abs(x)) * motion.x, y: y + (1 - Math.abs(y)) * motion.y });
      const eyes = [222, 290].map((centerX, index): CharacterEyeFrame => {
        const offset = index * 4;
        const width = clamp(springs[offset]!.value, 8, 64);
        const openHeight = clamp(springs[offset + 1]!.value, 2, 100);
        const centerY = clamp(springs[offset + 2]!.value, 230, 300);
        const rotation = clamp(springs[offset + 3]!.value, -35, 35);
        const height = openHeight - blink * (openHeight - 2);
        return Object.freeze({ x: centerX - width / 2, y: centerY - height / 2, width, height, rx: width / 2, rotation, centerX, centerY });
      }) as [CharacterEyeFrame, CharacterEyeFrame];
      return Object.freeze({ status: state.status, expression: state.expression, blink, gaze, eyes: Object.freeze(eyes) });
    },
    update(input, atMs = now()) {
      const patch = characterStateRecord(input);
      const nextOverride = patch.expression === null ? undefined : patch.expression !== undefined
        ? patch.expression as AvatarExpression : patch.status !== undefined ? undefined : override;
      const next = parseCharacterState({ status: patch.status ?? state.status,
        ...(nextOverride === undefined ? {} : { expression: nextOverride }),
        blink: patch.blink === undefined ? state.blink : patch.blink,
        gaze: patch.gaze === undefined ? state.gaze : patch.gaze });
      // Validate the entire patch and timestamp before modifying the clock or springs.
      if (patch.status === null) throw new TypeError('Unsupported avatar status');
      const at = time(atMs);
      advance(at);
      state = next;
      override = nextOverride;
      pose(state).forEach((target, index) => {
        const spring = springs[index]!;
        spring.target = target;
        if (instant()) { spring.value = target; spring.velocity = 0; }
      });
      return state;
    },
    getState() { return state; },
    setReducedMotion(value, atMs = now()) {
      if (typeof value !== 'boolean') throw new TypeError('Character reducedMotion must be boolean');
      const at = time(atMs);
      advance(at);
      reduced = value;
      if (instant()) for (const spring of springs) { spring.value = spring.target; spring.velocity = 0; }
    },
  };
  return Object.freeze(api);
}
