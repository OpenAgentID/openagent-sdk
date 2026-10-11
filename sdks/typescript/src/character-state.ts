/** Portable presentation state. Status never grants identity or application authority. */
export const CHARACTER_EXPRESSIONS = Object.freeze(['neutral', 'attentive', 'surprised', 'excited',
  'happy', 'laughing', 'angry', 'sad', 'scared', 'suspicious', 'confused', 'curious',
  'proud', 'shy', 'unimpressed', 'sleepy', 'thoughtful', 'concerned'] as const);

export type AvatarExpression = typeof CHARACTER_EXPRESSIONS[number];
export type AgentActivity = 'idle' | 'listening' | 'reasoning' | 'working' | 'speaking' | 'success' | 'blocked' | 'error';
export type AvatarStatus = AvatarExpression | AgentActivity;

export interface LiveEyeState {
  readonly status?: AvatarStatus;
  /** Explicit expression takes precedence over status in a supplied snapshot. */
  readonly expression?: AvatarExpression;
  /** Zero is open; one is closed. Blinking changes height, never width. */
  readonly blink?: number;
  /** Both eyes move together. Coordinates are normalized to [-1, 1]. */
  readonly gaze?: { readonly x: number; readonly y: number };
}

export interface CharacterRuntimeState {
  readonly status: AvatarStatus;
  readonly expression: AvatarExpression;
  readonly blink: number;
  readonly gaze: { readonly x: number; readonly y: number };
}

/** A status update clears the previous override; null restores the status expression. */
export interface CharacterStateUpdate extends Omit<LiveEyeState, 'expression'> {
  readonly expression?: AvatarExpression | null;
}

const activityExpressions: Readonly<Record<AgentActivity, AvatarExpression>> = Object.freeze({
  idle: 'neutral', listening: 'attentive', reasoning: 'thoughtful', working: 'attentive',
  speaking: 'happy', success: 'happy', blocked: 'concerned', error: 'concerned',
});
const statuses = Object.freeze([
  ...CHARACTER_EXPRESSIONS.map(expression => Object.freeze({ status: expression as AvatarStatus, expression })),
  ...Object.entries(activityExpressions).map(([status, expression]) => Object.freeze({ status: status as AvatarStatus, expression })),
]);

export function getCharacterExpressions(): readonly AvatarExpression[] { return CHARACTER_EXPRESSIONS; }
export function getCharacterStatuses(): readonly { readonly status: AvatarStatus; readonly expression: AvatarExpression }[] { return statuses; }

export function parseAvatarExpression(value: unknown): AvatarExpression {
  if (typeof value !== 'string' || !CHARACTER_EXPRESSIONS.includes(value as AvatarExpression)) {
    throw new TypeError('Unsupported avatar expression');
  }
  return value as AvatarExpression;
}

export function expressionForStatus(value: unknown): AvatarExpression {
  if (typeof value !== 'string') throw new TypeError('Unsupported avatar status');
  const entry = statuses.find(entry => entry.status === value);
  if (!entry) throw new TypeError('Unsupported avatar status');
  return entry.expression;
}

export function characterStateRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['status', 'expression', 'blink', 'gaze'].includes(key))) {
    throw new TypeError('Invalid character state');
  }
  return value as Record<string, unknown>;
}

function bounded(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError('Character state coordinates must be finite and in range');
  }
  return value === 0 ? 0 : value;
}

/** Validate an untrusted status snapshot without changing any identity/profile state. */
export function parseCharacterState(input: unknown, fallbackExpression: AvatarExpression = 'neutral'): CharacterRuntimeState {
  const value = characterStateRecord(input);
  const fallback = parseAvatarExpression(fallbackExpression);
  const status = value.status === undefined ? fallback : value.status;
  const statusExpression = expressionForStatus(status);
  const expression = value.expression === undefined ? statusExpression : parseAvatarExpression(value.expression);
  const blink = value.blink === undefined ? 0 : bounded(value.blink, 0, 1);
  let x = 0;
  let y = 0;
  if (value.gaze !== undefined) {
    if (!value.gaze || typeof value.gaze !== 'object' || Array.isArray(value.gaze) ||
        Object.keys(value.gaze).some(key => key !== 'x' && key !== 'y')) throw new TypeError('Invalid character gaze');
    const gaze = value.gaze as Record<string, unknown>;
    x = bounded(gaze.x, -1, 1);
    y = bounded(gaze.y, -1, 1);
  }
  return Object.freeze({ status: status as AvatarStatus, expression, blink, gaze: Object.freeze({ x, y }) });
}
