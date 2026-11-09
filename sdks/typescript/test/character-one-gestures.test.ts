import { describe, expect, it } from 'vitest';
import { ONE_CHANNELS, ONE_NEUTRAL, oneGeometry, oneHeldPose, type OneFace, type OnePose } from '../src/character-one.js';
import { OneMotion, seededRandom } from '../src/character-one-motion.js';
import { renderOneFrame } from '../src/one.js';
import { ONE_IDLE_GESTURES, createOneIdleDirector, oneGesturePersonality, oneGestureTimeline, type OneIdleGesture, type OneIdleRow } from '../src/one-gestures.js';

const did = (n: number): string => `did:oas:one:agent:test-${n}`;
const poseOf = (values: readonly number[]): OnePose => Object.fromEntries(ONE_CHANNELS.map((k, i) => [k, values[i]!])) as unknown as OnePose;

describe('One gesture timelines', () => {
  const size = 44;
  it('every gesture starts and ends on the held idle face', () => {
    const held = oneHeldPose('idle', { x: 0.4, y: 0 }, size);
    for (const name of ONE_IDLE_GESTURES) {
      const timeline = oneGestureTimeline(name, { kind: 'star', size });
      const first = poseOf(timeline.sample(0));
      const last = poseOf(timeline.sample(timeline.duration));
      for (const k of ['look', 'lift', 'open', 'tilt', 'smile', 'mouth', 'squash', 'rotate', 'hop', 'smear', 'shift', 'rise', 'stretch'] as const) {
        expect(first[k], `${name} start ${k}`).toBeCloseTo(held[k], 3);
        expect(last[k], `${name} end ${k}`).toBeCloseTo(held[k], 3);
      }
      expect(Math.abs(Math.cos(last.turn * Math.PI / 180)), `${name} end turn`).toBeCloseTo(1, 3);
    }
  });

  it('the spin turns all the way round, past the mark, and smears on the way', () => {
    const timeline = oneGestureTimeline('spin', { kind: 'heart', size });
    let top = -Infinity;
    let streak = 0;
    for (let t = 0; t <= timeline.duration; t += 1000 / 120) {
      const pose = poseOf(timeline.sample(t));
      top = Math.max(top, pose.turn);
      streak = Math.max(streak, Math.abs(pose.smear));
    }
    expect(top).toBeGreaterThan(360);
    expect(streak).toBeGreaterThan(0.9);
    expect(timeline.duration).toBeLessThan(1000);
  });

  it('no gesture holds still on a live state\'s face', () => {
    const live: OneFace[] = ['thinking', 'working', 'typing', 'waiting', 'error', 'speaking'];
    const gaze = { x: 0.4, y: 0 };
    const limit = 300;
    for (const name of ONE_IDLE_GESTURES) {
      const timeline = oneGestureTimeline(name, { kind: 'star', size });
      for (const face of live) {
        const target = oneHeldPose(face, gaze, size);
        let dwell = 0, worst = 0;
        for (let t = 0; t <= timeline.duration; t += 10) {
          const pose = poseOf(timeline.sample(t));
          const on = Math.abs(pose.look - target.look) < 0.12 && Math.abs(pose.lift - target.lift) < 0.12 &&
            Math.abs(pose.open - target.open) < 0.1 && Math.abs(pose.tilt - target.tilt) < 4 && Math.abs(pose.rise) < 0.01;
          dwell = on ? dwell + 10 : 0;
          worst = Math.max(worst, dwell);
        }
        expect(worst, `${name} sits on ${face}`).toBeLessThan(limit);
      }
    }
  });

  it('a composed timeline plays on the clock and hands the head back at rest; a live state cuts it clean', () => {
    const motion = new OneMotion({ face: 'idle', gaze: { x: 0.4, y: 0 }, px: 44, kind: 'star', random: seededRandom(new Uint8Array(4)), cadence: 'brief', motion: true, at: 0 });
    const timeline = oneGestureTimeline('spin', { kind: 'star', size: 44 });
    motion.start({ name: 'settle', priority: 0, sampler: timeline.sample, length: timeline.duration }, 0);
    expect(motion.sample(200).frame.pose.turn).not.toBe(0);
    const interrupted = motion.setFace('thinking', { x: 0.4, y: 0 }, 300);
    expect(interrupted?.name).toBe('ponder');
    motion.start(interrupted!, 300);
    motion.sample(600);
    const after = motion.sample(2000).frame;
    expect(after.pose.turn).toBe(0);
    expect(after.pose.smear).toBe(0);
    expect(after.face).toBe('thinking');
  });

  it('draws the same frame the live head would, away side included', () => {
    const timeline = oneGestureTimeline('spin', { kind: 'charcoal', size });
    const halfway = timeline.sample(timeline.duration * 0.28);
    const svg = renderOneFrame({ color: 'charcoal', size, theme: 'dark' }, halfway);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(oneGeometry(poseOf(halfway), 'M', 'charcoal').body).not.toBe('');
    expect(oneGeometry(ONE_NEUTRAL, 'M', 'charcoal').ghosts).toEqual([]);
  });
});

describe('One personalities', () => {
  it('a DID always gets the same personality, and DIDs spread across them', () => {
    const traits = new Set<string>();
    for (let n = 0; n < 200; n++) {
      expect(oneGesturePersonality(did(n)).trait).toBe(oneGesturePersonality(did(n)).trait);
      traits.add(oneGesturePersonality(did(n)).trait);
    }
    expect(traits.size).toBe(6);
  });

  it('the main One is calm: mostly blinks, rarely spins', () => {
    const calm = oneGesturePersonality(did(1), true);
    expect(calm.trait).toBe('calm');
    expect((calm.weights.spin ?? 0)).toBeLessThan(1);
    expect(calm.weights.hop).toBeUndefined();
    expect(calm.weights.shakeOff).toBeUndefined();
  });
});

describe('the idle director', () => {
  const rows = (count: number, patch: Partial<OneIdleRow>[] = []): OneIdleRow[] =>
    Array.from({ length: count }, (_, i) => ({ id: `r${i}`, did: did(i), index: i, ...(patch[i] ?? {}) }));

  it('waits 20 to 40 seconds between gestures', () => {
    const director = createOneIdleDirector(seededRandom(new Uint8Array([1, 2, 3, 4])));
    for (let i = 0; i < 500; i++) {
      const wait = director.nextDelay();
      expect(wait).toBeGreaterThanOrEqual(20000);
      expect(wait).toBeLessThanOrEqual(40000);
    }
  });

  it('never picks a busy row and never the same row twice running', () => {
    const director = createOneIdleDirector(seededRandom(new Uint8Array([5, 6, 7, 8])));
    let previous = '';
    for (let i = 0; i < 400; i++) {
      const plan = director.pick(rows(5, [{ busy: true }]))!;
      expect(plan.rowId).not.toBe('r0');
      expect(plan.rowId).not.toBe(previous);
      previous = plan.rowId;
    }
  });

  it('only side-eyes when One is above, and a mutual look never involves One', () => {
    const director = createOneIdleDirector(seededRandom(new Uint8Array([9, 10, 11, 12])));
    let mutual = 0;
    for (let i = 0; i < 2000; i++) {
      const plan = director.pick(rows(6, [{ main: true }]))!;
      if (plan.partnerId) { mutual++; expect(plan.partnerId).not.toBe('r0'); }
    }
    expect(mutual).toBeGreaterThan(0);
    const noOne = createOneIdleDirector(seededRandom(new Uint8Array([13, 14, 15, 16])));
    for (let i = 0; i < 400; i++) expect((noOne.pick(rows(4))?.gesture as OneIdleGesture | undefined)).not.toBe('sideEye');
  });

  it('with every row busy there is nothing to do', () => {
    expect(createOneIdleDirector().pick(rows(3, [{ busy: true }, { busy: true }, { busy: true }]))).toBeNull();
  });
});
