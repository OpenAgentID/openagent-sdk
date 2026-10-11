import { describe, expect, it } from 'vitest';
import { createCharacterAnimator } from '../src/character-animation.js';
import { getCharacterExpressions, getCharacterStatuses } from '../src/character-state.js';
import { generateCharacter } from '../src/characters.js';

const did = 'did:oas:openagent:agent:character-vector';
const iamDid = 'did:oas:agent-instance:01ARZ3NDEKTSV4RRFFQ69G5FAV';
const manual = { blink: 0, gaze: { x: 0, y: 0 } } as const;
type Animator = ReturnType<typeof createCharacterAnimator>;
type Frame = ReturnType<Animator['sample']>;

function geometry(frame: Frame): number[] {
  return frame.eyes.flatMap((eye) => [eye.x, eye.y, eye.width, eye.height, eye.rx,
    eye.rotation, eye.centerX, eye.centerY]);
}

function closeGeometry(actual: Frame, expected: Frame, precision = 8) {
  expect(actual.eyes).toHaveLength(2);
  const values = geometry(expected);
  for (const [index, value] of geometry(actual).entries()) expect(value).toBeCloseTo(values[index]!, precision);
  expect(actual.blink).toBeCloseTo(expected.blink, precision);
  expect(actual.gaze.x).toBeCloseTo(expected.gaze.x, precision);
  expect(actual.gaze.y).toBeCloseTo(expected.gaze.y, precision);
}

function manualAnimator() {
  return createCharacterAnimator(did, { now: () => 0, transitionMs: 420, state: manual });
}

describe('continuous character animator used by the browser player', () => {
  it('moves between poses instead of snapping to the requested expression', () => {
    const animator = manualAnimator();
    const initial = animator.sample(0);
    animator.update({ expression: 'surprised' }, 0);
    closeGeometry(animator.sample(0), initial);
    const middle = animator.sample(140);
    expect(middle.eyes[0]!.width).toBeGreaterThan(initial.eyes[0]!.width);
    expect(middle.eyes[0]!.width).toBeLessThan(40);
    const movingSettled = animator.sample(5000);
    expect(movingSettled.eyes[0]!.width).toBeCloseTo(40, 8);
    expect(movingSettled.eyes[0]!.height).toBeCloseTo(56 - 54 * movingSettled.blink, 8);
    // Ambient blinking is layered on manual blink; freeze it before checking
    // the exact settled pose instead of mistaking a blink for a morph.
    animator.setReducedMotion(true, 5000);
    const settled = animator.sample(5000);
    expect(settled.eyes[0]).toMatchObject({ width: 40, height: 56, centerX: 222, centerY: 264, rotation: 0 });
    expect(settled.eyes[1]).toMatchObject({ width: 40, height: 56, centerX: 290, centerY: 264, rotation: 0 });
  });

  it('preserves both position and velocity when another update interrupts a transition', () => {
    const animator = manualAnimator();
    animator.update({ expression: 'surprised', gaze: { x: 1, y: 0 } }, 0);
    const previous = animator.sample(149);
    const before = animator.sample(150);
    const widthVelocity = before.eyes[0]!.width - previous.eyes[0]!.width;
    const gazeVelocity = before.gaze.x - previous.gaze.x;
    expect(widthVelocity).toBeGreaterThan(0.001);
    expect(gazeVelocity).toBeGreaterThan(0.0001);
    animator.update({ expression: 'angry', gaze: { x: -1, y: 0 } }, 150);
    closeGeometry(animator.sample(150), before);
    const next = animator.sample(151);
    const nextWidthVelocity = next.eyes[0]!.width - before.eyes[0]!.width;
    const nextGazeVelocity = next.gaze.x - before.gaze.x;
    expect(Math.abs(nextWidthVelocity - widthVelocity)).toBeLessThan(Math.abs(widthVelocity) * 0.2 + 0.001);
    expect(Math.abs(nextGazeVelocity - gazeVelocity)).toBeLessThan(Math.abs(gazeVelocity) * 0.2 + 0.0001);
    expect(nextWidthVelocity).toBeGreaterThan(0);
    expect(nextGazeVelocity).toBeGreaterThan(0);
  });

  it('keeps its original spring and ambient clocks across repeated equal statuses', () => {
    const repeated = createCharacterAnimator(did, { now: () => 0 });
    const control = createCharacterAnimator(did, { now: () => 0 });
    repeated.update({ status: 'listening' }, 0); control.update({ status: 'listening' }, 0);
    let sawBlink = false; let sawGaze = false;
    for (let time = 0; time <= 12_000; time += 37) {
      repeated.update({ status: 'listening' }, time);
      const expected = control.sample(time); const actual = repeated.sample(time);
      closeGeometry(actual, expected);
      expect(actual.eyes[0]!.height).toBeCloseTo(actual.eyes[1]!.height, 8);
      expect(actual.eyes[0]!.centerY).toBeCloseTo(actual.eyes[1]!.centerY, 8);
      if (time > 1000) expect(actual.eyes[0]!.width).toBeCloseTo(26, 3);
      sawBlink ||= expected.blink > 0.01;
      sawGaze ||= Math.abs(expected.gaze.x) + Math.abs(expected.gaze.y) > 0.01;
    }
    expect(sawBlink).toBe(true); expect(sawGaze).toBe(true);
  });

  it('clears a selected expression on a new status while retaining it for blink/gaze-only patches', () => {
    const animator = manualAnimator();
    animator.update({ status: 'reasoning', expression: 'happy' }, 0);
    expect(animator.getState()).toMatchObject({ status: 'reasoning', expression: 'happy' });
    animator.update({ blink: 0.25, gaze: { x: 0.2, y: -0.2 } }, 10);
    expect(animator.getState().expression).toBe('happy');
    animator.update({ expression: null }, 20);
    expect(animator.getState()).toMatchObject({ status: 'reasoning', expression: 'thoughtful' });
    animator.update({ expression: 'proud' }, 30);
    animator.update({ status: 'error' }, 40);
    expect(animator.getState()).toMatchObject({ status: 'error', expression: 'concerned' });
    animator.update({ status: 'blocked', expression: 'curious' }, 50);
    expect(animator.getState()).toMatchObject({ status: 'blocked', expression: 'curious' });
  });

  it('applies reduced motion immediately and then holds the exact manual target', () => {
    const animator = manualAnimator();
    animator.update({ expression: 'surprised', blink: 0.5, gaze: { x: 1, y: -1 } }, 0);
    const moving = animator.sample(140);
    animator.setReducedMotion(true, 140);
    const staticFrame = animator.sample(140);
    expect(staticFrame.eyes[0]!.width).toBe(40);
    expect(staticFrame.eyes[0]!.height).toBe(29);
    expect(staticFrame.blink).toBe(0.5);
    expect(staticFrame.gaze).toEqual({ x: 1, y: -1 });
    expect(geometry(staticFrame)).not.toEqual(geometry(moving));
    closeGeometry(animator.sample(10_000), staticFrame);
    animator.update({ expression: 'neutral', blink: 0, gaze: { x: 0, y: 0 } }, 10_000);
    expect(animator.sample(10_000).eyes[0]).toMatchObject({ width: 28, height: 72, rotation: 0 });
    animator.setReducedMotion(false, 10_000);
    const resumed = animator.sample(10_000);
    animator.update({ expression: 'surprised' }, 10_000);
    closeGeometry(animator.sample(10_000), resumed);
    expect(animator.sample(10_140).eyes[0]!.width).toBeGreaterThan(resumed.eyes[0]!.width);
  });

  it('does not reset ambient timing when reduced motion is toggled', () => {
    const toggled = createCharacterAnimator(did, { now: () => 0 });
    const uninterrupted = createCharacterAnimator(did, { now: () => 0 });
    toggled.sample(1000); toggled.setReducedMotion(true, 1000);
    const staticFrame = toggled.sample(6000);
    expect(staticFrame.blink).toBe(0); expect(staticFrame.gaze).toEqual({ x: 0, y: 0 });
    toggled.setReducedMotion(false, 6000);
    closeGeometry(toggled.sample(6000), uninterrupted.sample(6000));
  });

  it('normalizes runtime statuses and selected expressions identically for both skins and literal DID forms', () => {
    for (const identifier of [did, iamDid, 'did:l1fe:agent:character-vector']) {
      for (const skin of ['autos', 'spacex'] as const) {
        const appearance = generateCharacter(identifier, { skin, animated: false });
        const animator = createCharacterAnimator(identifier, { skin, reducedMotion: true, now: () => 0 });
        let time = 0;
        for (const entry of getCharacterStatuses()) {
          animator.update({ status: entry.status }, time++);
          expect(animator.getState().expression).toBe(entry.expression);
        }
        for (const expression of getCharacterExpressions()) {
          animator.update({ expression }, time++);
          const frame = animator.sample(time++);
          expect(frame.expression).toBe(expression); expect(frame.eyes).toHaveLength(2);
          for (const eye of frame.eyes) {
            expect(Object.values(eye).every(Number.isFinite)).toBe(true);
            expect(eye.width).toBeGreaterThan(0); expect(eye.height).toBeGreaterThanOrEqual(2);
            expect(eye.x + eye.width / 2).toBeCloseTo(eye.centerX, 8);
            expect(eye.y + eye.height / 2).toBeCloseTo(eye.centerY, 8);
          }
          const selected = generateCharacter(identifier, { skin, expression, animated: false });
          expect({ did: selected.did, shape: selected.shape, color: selected.color })
            .toEqual({ did: identifier, shape: appearance.shape, color: appearance.color });
        }
      }
    }
  });

  it('rejects malformed patches atomically without consuming their timestamp', () => {
    const animator = manualAnimator(); const control = manualAnimator();
    animator.update({ expression: 'surprised' }, 0); control.update({ expression: 'surprised' }, 0);
    animator.sample(100); control.sample(100);
    const state = animator.getState();
    for (const patch of [null, [], { status: 'invented' }, { expression: 'invented' },
      { status: 'happy', blink: 2 }, { expression: 'angry', gaze: { x: Infinity, y: 0 } },
      { gaze: { x: 0, y: 0, z: 0 } }, { status: 'idle', grant: true }]) {
      expect(() => animator.update(patch as Parameters<Animator['update']>[0], 200)).toThrow();
      expect(animator.getState()).toEqual(state);
    }
    closeGeometry(animator.sample(101), control.sample(101));
    expect(Object.isFrozen(animator.getState())).toBe(true);
    expect(Object.isFrozen(animator.getState().gaze)).toBe(true);
  });

  it('refuses nonfinite, negative and decreasing timestamps for every state-changing method', () => {
    const animator = manualAnimator(); const control = manualAnimator();
    animator.sample(100); control.sample(100);
    for (const at of [NaN, Infinity, -1, 99]) {
      expect(() => animator.sample(at)).toThrow();
      expect(() => animator.update({ status: 'error' }, at)).toThrow();
      expect(() => animator.setReducedMotion(true, at)).toThrow();
    }
    closeGeometry(animator.sample(101), control.sample(101));
    expect(animator.getState()).toMatchObject({ expression: 'neutral' });
  });

  it.each([
    { transitionMs: 79 }, { transitionMs: 2001 }, { transitionMs: NaN },
    { reducedMotion: 'system' }, { reducedMotion: null }, { unknown: 1 },
    { now: 0 }, { size: 31 }, { skin: 'pill' },
  ])('refuses malformed animator options %#', (options) => {
    expect(() => createCharacterAnimator(did, options as Parameters<typeof createCharacterAnimator>[1])).toThrow();
  });
});
