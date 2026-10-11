import { describe, expect, it } from 'vitest';
import {
  getCharacterExpressions,
  getCharacterStatuses,
  parseCharacterState,
} from '../src/character-state.js';

const expressions = ['neutral', 'attentive', 'surprised', 'excited', 'happy', 'laughing',
  'angry', 'sad', 'scared', 'suspicious', 'confused', 'curious', 'proud', 'shy',
  'unimpressed', 'sleepy', 'thoughtful', 'concerned'] as const;
const runtime = {
  idle: 'neutral', listening: 'attentive', reasoning: 'thoughtful', working: 'attentive',
  speaking: 'happy', success: 'happy', blocked: 'concerned', error: 'concerned',
} as const;

describe('public character runtime state', () => {
  it('lists immutable expression and status selections without deriving identity authority', () => {
    expect(getCharacterExpressions()).toEqual(expressions);
    expect(Object.isFrozen(getCharacterExpressions())).toBe(true);
    const statuses = getCharacterStatuses();
    expect(Object.isFrozen(statuses)).toBe(true);
    expect(new Set(statuses.map(({ status }) => status)).size).toBe(statuses.length);
    for (const entry of statuses) expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.fromEntries(statuses.map(({ status, expression }) => [status, expression])))
      .toEqual({ ...Object.fromEntries(expressions.map((expression) => [expression, expression])), ...runtime });
  });

  it.each(Object.entries(runtime))('maps runtime %s to %s', (status, expression) => {
    expect(parseCharacterState({ status })).toMatchObject({ status, expression, blink: 0, gaze: { x: 0, y: 0 } });
  });

  it.each(expressions)('accepts the selected %s expression as a status', (expression) => {
    expect(parseCharacterState({ status: expression })).toMatchObject({ status: expression, expression });
  });

  it('gives selected expression precedence over status, and status precedence over fallback', () => {
    expect(parseCharacterState({ status: 'reasoning', expression: 'happy' }, 'angry'))
      .toMatchObject({ status: 'reasoning', expression: 'happy' });
    expect(parseCharacterState({ status: 'reasoning' }, 'angry').expression).toBe('thoughtful');
    expect(parseCharacterState({}, 'curious').expression).toBe('curious');
    expect(parseCharacterState({}).expression).toBe('neutral');
  });

  it('copies and freezes caller-owned state without freezing the caller objects', () => {
    const input = { status: 'working', expression: 'proud', blink: 0.5, gaze: { x: -1, y: 1 } };
    const state = parseCharacterState(input);
    expect(state).toMatchObject(input);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.gaze)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.gaze)).toBe(false);
    input.status = 'error'; input.expression = 'sad'; input.blink = 1; input.gaze.x = 0;
    expect(state).toMatchObject({ status: 'working', expression: 'proud', blink: 0.5, gaze: { x: -1, y: 1 } });
  });

  it.each([
    null, [], 'reasoning', 1,
    { status: 'REASONING' }, { status: ' reasoning' }, { status: 'invented' }, { status: null },
    { expression: 'invented' }, { expression: null }, { expression: 'happy\n' },
    { blink: -0.001 }, { blink: 1.001 }, { blink: NaN }, { blink: Infinity }, { blink: '0' },
    { gaze: null }, { gaze: { x: 0 } }, { gaze: { y: 0 } },
    { gaze: { x: 1.001, y: 0 } }, { gaze: { x: 0, y: -1.001 } },
    { gaze: { x: NaN, y: 0 } }, { gaze: { x: 0, y: Infinity } },
    { gaze: { x: 0, y: 0, z: 0 } }, { status: 'idle', did: 'did:oas:agent-instance:01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    { expression: 'neutral', authorization: true }, { blink: 0, unknown: false },
  ])('refuses malformed or expanded state %#', (input) => {
    expect(() => parseCharacterState(input)).toThrow();
  });

  it('validates the fallback even when no input can supply an expression', () => {
    expect(() => parseCharacterState({}, 'invented' as 'neutral')).toThrow();
  });
});
