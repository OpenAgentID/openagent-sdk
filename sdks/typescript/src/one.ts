/**
 * The One family on its own, for hosts that draw only One heads: the still glyph, the shape and colour helpers
 * and the live head, without the other families' art or a schema library. `@openagentid/sdk/one` serves
 * bundlers; `@openagentid/sdk/browser/one` is the same entry built self-contained for a browser. Importing it
 * does not touch a DOM. Heads are identical to `generateCharacter` and `mountCharacter` with `skin: 'one'`.
 */
import { isAgentAvatarDid } from './avatar-did.js';
import { parseCharacterLabel } from './character-label.js';
import { ONE_BLANK_SHAPE, getOneShapes, isOneColorAllowed, isOneHeadColor, isOneShape, oneFaceFor, oneLookForDid, oneStillSvg,
  type OneHeadColor, type OneKind, type OneLook, type OneShape, type OneTheme } from './character-one.js';
import { ONE_GESTURES, parseOneLiveOptions, seededRandom, type OneCadence, type OneGesture } from './character-one-motion.js';
import { OneHead } from './character-one-player.js';
import { parseAvatarExpression, parseCharacterState, updateCharacterState, type AvatarExpression,
  type CharacterRuntimeState, type CharacterStateUpdate, type LiveEyeState } from './character-state.js';

export { getOneShapes, getOneColors, ONE_SHAPE_ORDER, ONE_DIGITAL, ONE_KINDS, isOneShape, isOneColor, isOneKind, isOneColorAllowed,
  oneShapeForDid, oneColorForDid, oneLookForDid, nextOneLook } from './character-one.js';
export type { OneShape, OneColor, OneKind, OneHeadColor, OneLook, OneLookHolder, OneShapeDescription, OneShapeEye, OneColorDescription,
  OneTemperament, OneTheme } from './character-one.js';
export type { OneCadence, OneGesture } from './character-one-motion.js';
export type { AvatarExpression, AvatarStatus, LiveEyeState, CharacterRuntimeState, CharacterStateUpdate } from './character-state.js';

export interface OneOptions {
  /** The agent's DID. Without `shape` and `color` it selects the agent's default look. A blank head needs none. */
  readonly did?: string;
  /** The agent's shape. With a shape and no colour, the shape's own colour applies. Digital One takes no shape. */
  readonly shape?: OneShape;
  /**
   * An agent colour, 'charcoal' for Digital One, or 'blank' for a ready-made agent that has not been added, drawn in
   * the shape it will get (the Square when none is given). A never pair is refused.
   */
  readonly color?: OneHeadColor;
  /** Square pixel size, 16–2048; default 512. Pass the displayed size: it selects the tier and the keyline. */
  readonly size?: number;
  /** Light (default) or dark surface tones. */
  readonly theme?: OneTheme;
  /** Accessible name, normally the agent's own name, never a shape or colour word. Without it the head is decorative. */
  readonly label?: string;
  /** Preferred expression, used when the state names no status. */
  readonly expression?: AvatarExpression;
  readonly state?: LiveEyeState;
}

export interface OneMountOptions extends Omit<OneOptions, 'did'> {
  /** False holds the face still, like reduced motion. Default true. */
  readonly animated?: boolean;
  /** Defaults to the operating system's reduced-motion preference. */
  readonly reducedMotion?: boolean | 'system';
  /** Ongoing-work pacing: 'brief' (default) for lists and cards, 'repeat' for headers and heroes. */
  readonly cadence?: OneCadence;
  /** Calm grouping: one moving head per group. Defaults to the nearest list container, else the head alone. */
  readonly group?: string;
  /** The voice output level (0–1), read every frame while speaking at 64 px and up. */
  readonly voiceLevel?: () => number;
  /** Let the eye follow a fine pointer near the head: headers and heroes at 40 px and up. Default false. */
  readonly follow?: boolean;
}

export interface OneAppearanceUpdate {
  /** A new shape; with no colour in the same update, the head keeps its colour, which the new shape must allow. */
  readonly shape?: OneShape;
  /** A new colour, 'charcoal' for Digital One (which drops the shape), or 'blank'. */
  readonly color?: OneHeadColor;
  readonly theme?: OneTheme;
  readonly size?: number;
  /** null removes the accessible name; the head is then decorative. */
  readonly label?: string | null;
}

export interface OnePlayOptions {
  /** The viewer started it (a tap): it starts at once. Otherwise it waits for a motion slot like a state change. */
  readonly viewer?: boolean;
}

export interface OnePlayer {
  update(state: CharacterStateUpdate): CharacterRuntimeState;
  /** Change the look (a wave at 40 px and up; First blink when a blank head gets its colour), surface, size or name. */
  setAppearance(input: OneAppearanceUpdate): void;
  /**
   * Play a gesture the host chooses, then return to the held face: an arrival (`popIn` on a first screen, `lookAtYou`
   * once after a page loads, `wave` the first time an empty thread shows) or, with `{ viewer: true }`, the viewer's
   * tap on a hero (a tap ladder). `lookAtYou` and `nod` play from 24 px, the others from 40 px. Nothing plays under
   * reduced motion, in a hidden document or out of view (an arrival waits up to 1.5 s for its head to come into
   * view); a head whose status is `attention`, or that is speaking, only looks at you or nods. Returns whether the
   * gesture was accepted. Never use it on approval or money surfaces.
   */
  play(gesture: OneGesture, options?: OnePlayOptions): boolean;
  setReducedMotion(value: boolean | 'system'): void;
  getState(): CharacterRuntimeState;
  dispose(): void;
}

/** A head's resolved look: the shape drawn (Digital One's circle for 'charcoal') and its paint. */
interface Look { readonly kind: OneKind; readonly color: OneHeadColor }
interface Paint extends Look { readonly theme: OneTheme; readonly size: number; readonly label?: string }

const stillKeys = ['did', 'shape', 'color', 'size', 'theme', 'label', 'expression', 'state'];
const mountKeys = ['shape', 'color', 'size', 'theme', 'label', 'expression', 'state', 'animated', 'reducedMotion', 'cadence', 'group', 'voiceLevel', 'follow'];

function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) {
    throw new TypeError(`Invalid One ${label}`);
  }
  return value as Record<string, unknown>;
}

function parseSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 16 || value > 2048) throw new RangeError('One size must be an integer from 16 to 2048');
  return value;
}

function parseTheme(value: unknown): OneTheme {
  if (value !== 'light' && value !== 'dark') throw new TypeError('Unsupported character theme');
  return value;
}

function parseShape(value: unknown): OneShape {
  if (value === 'charcoal') throw new TypeError("Digital One is color: 'charcoal' and takes no shape");
  if (!isOneShape(value)) throw new TypeError('Unsupported One shape');
  return value;
}

function parseColor(value: unknown): OneHeadColor {
  if (!isOneHeadColor(value)) throw new TypeError('Unsupported One colour');
  return value;
}

/**
 * The look from a shape and a colour, either optional: Digital One takes no shape; a blank head takes the shape it
 * will get, or the Square; a colour needs a shape (or a DID to default one); a shape alone wears its own colour; with
 * neither, the DID's default look. A never pair is refused.
 */
function resolveLook(shape: OneShape | undefined, color: OneHeadColor | undefined, fallback: (() => OneLook) | undefined): Look {
  if (color === 'charcoal') {
    if (shape !== undefined) throw new TypeError('Digital One is always the circle: give it no shape');
    return { kind: 'charcoal', color };
  }
  if (color === 'blank') return { kind: shape ?? ONE_BLANK_SHAPE, color };
  if (shape === undefined && color === undefined) {
    if (fallback === undefined) throw new TypeError('A One head needs a shape, a colour or an agent DID');
    const look = fallback();
    return { kind: look.shape, color: look.color };
  }
  if (shape === undefined && fallback === undefined) throw new TypeError('A coloured One head needs a shape or an agent DID');
  const kind = shape ?? fallback!().shape;
  const resolved = color ?? getOneShapes().find(entry => entry.id === kind)!.color;
  if (!isOneColorAllowed(kind, resolved)) throw new TypeError(`A ${kind} is never ${resolved}`);
  return { kind, color: resolved };
}

function parsePaint(value: Record<string, unknown>, look: Look, previous?: Paint): Paint {
  const label = value.label === undefined ? previous?.label : value.label === null && previous
    ? undefined : parseCharacterLabel(value.label);
  return {
    ...look,
    theme: value.theme === undefined ? previous?.theme ?? 'light' : parseTheme(value.theme),
    size: value.size === undefined ? previous?.size ?? 512 : parseSize(value.size),
    ...(label === undefined ? {} : { label }),
  };
}

function initialState(value: Record<string, unknown>): { state: CharacterRuntimeState; override: AvatarExpression | undefined } {
  const preferred = value.expression === undefined ? 'neutral' : parseAvatarExpression(value.expression);
  const state = parseCharacterState(value.state ?? {}, preferred);
  const supplied = value.state as { expression?: unknown } | undefined;
  return { state, override: supplied?.expression === undefined ? undefined : state.expression };
}

/** The still glyph: identical to `generateCharacter(did, { skin: 'one', shape, color, ... }).svg`. */
export function renderOne(options: OneOptions): string {
  const value = record(options, stillKeys, 'options');
  if (value.did !== undefined && !isAgentAvatarDid(value.did)) throw new TypeError('One heads require an agent or agent instance DID');
  const did = value.did as string | undefined;
  const shape = value.shape === undefined ? undefined : parseShape(value.shape);
  const color = value.color === undefined ? undefined : parseColor(value.color);
  // The DID is hashed only here, on the server or in a bundle: the live entry never hashes one in the browser.
  const look = parsePaint(value, resolveLook(shape, color, did === undefined ? undefined : () => oneLookForDid(did)));
  const { state } = initialState(value);
  return oneStillSvg({ ...(did === undefined ? {} : { did }), ...look, status: state.status, expression: state.expression, blink: state.blink, gaze: state.gaze,
    view: 'avatar', finish: 'plush', eyePlacement: 'face' });
}

/**
 * A live One head in `element`. It replaces a still One already rendered there (for example on the server);
 * otherwise mount into an empty element. Hosts deliver authorized state updates; the head writes no profile.
 * A live head needs no DID, so the light entry never hashes one in the browser: pass the agent's stored look
 * (or `oneLookForDid(did)` from the server), 'charcoal' for Digital One, or 'blank' for a ready-made agent.
 */
export function mountOne(element: Element, options: OneMountOptions): OnePlayer {
  if (!element || element.nodeType !== 1 || !element.ownerDocument?.defaultView) throw new TypeError('One head requires a browser element');
  const value = record(options, mountKeys, 'options');
  const shape = value.shape === undefined ? undefined : parseShape(value.shape);
  const color = value.color === undefined ? undefined : parseColor(value.color);
  if (shape === undefined && color === undefined) throw new TypeError('A live One head needs a shape or a colour');
  let look = parsePaint(value, resolveLook(shape, color, undefined));
  let { state, override } = initialState(value);
  const live = parseOneLiveOptions(value.cadence, value.voiceLevel);
  if (value.group !== undefined && (typeof value.group !== 'string' || !value.group || value.group.length > 200)) throw new TypeError('Character group must be 1–200 characters');
  if (value.animated !== undefined && typeof value.animated !== 'boolean') throw new TypeError('Character animated must be boolean');
  if (value.follow !== undefined && typeof value.follow !== 'boolean') throw new TypeError('One follow must be boolean');
  const preference = (input: unknown): boolean | 'system' => {
    if (input !== true && input !== false && input !== 'system') throw new TypeError('Invalid character motion preference');
    return input;
  };
  let selected = preference(value.reducedMotion ?? 'system');
  const win = element.ownerDocument.defaultView!;
  const media = win.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = (): boolean => selected === 'system' ? media.matches : selected;
  const head = new OneHead(element, {
    kind: look.kind, color: look.color, theme: look.theme, size: look.size, ...(look.label === undefined ? {} : { label: look.label }),
    face: oneFaceFor(state), gaze: state.gaze, blink: state.blink, status: state.status, expression: state.expression,
    speaking: state.status === 'speaking', cadence: live.cadence, ...(live.voiceLevel ? { voiceLevel: live.voiceLevel } : {}),
    ...(value.group === undefined ? {} : { group: value.group as string }), follow: value.follow === true,
    reduced: reduced(), animated: value.animated !== false, random: seededRandom(win.crypto.getRandomValues(new Uint8Array(4))),
  });
  let disposed = false;
  const motionChanged = (): void => { if (!disposed) head.setReduced(reduced()); };
  media.addEventListener('change', motionChanged);
  const active = (): void => { if (disposed) throw new Error('One head is disposed'); };
  return Object.freeze({
    update(input: CharacterStateUpdate) {
      active();
      const next = updateCharacterState(state, override, input);
      state = next.state;
      override = next.override;
      head.setState(oneFaceFor(state), state.gaze, state.blink, state.status, state.expression);
      return state;
    },
    setAppearance(input: OneAppearanceUpdate) {
      active();
      const update = record(input, ['shape', 'color', 'theme', 'size', 'label'], 'appearance update');
      const nextShape = update.shape === undefined ? undefined : parseShape(update.shape);
      const nextColor = update.color === undefined ? undefined : parseColor(update.color);
      // The head keeps whatever the update leaves out: its shape and its colour. Digital One has neither to keep:
      // a shape given to him wears that shape's own colour, and `color: 'charcoal'` makes any head Digital One.
      let resolved: Look;
      if (nextShape === undefined && nextColor === undefined) resolved = { kind: look.kind, color: look.color };
      else if (nextColor === 'charcoal') resolved = resolveLook(nextShape, 'charcoal', undefined);
      else resolved = resolveLook(nextShape ?? (look.kind === 'charcoal' ? undefined : look.kind), nextColor ?? (look.color === 'charcoal' ? undefined : look.color), undefined);
      const next = parsePaint(update, resolved, look);
      look = next;
      head.setPaint(next.kind, next.color, next.theme, next.size, next.label);
    },
    setReducedMotion(input: boolean | 'system') {
      active();
      selected = preference(input);
      motionChanged();
    },
    play(gesture: OneGesture, options: OnePlayOptions = {}) {
      active();
      if (!ONE_GESTURES.includes(gesture)) throw new TypeError('Unsupported One gesture');
      const value = record(options, ['viewer'], 'play options');
      if (value.viewer !== undefined && typeof value.viewer !== 'boolean') throw new TypeError('One play viewer must be boolean');
      return head.play(gesture, value.viewer === true);
    },
    getState() { return state; },
    dispose() {
      if (disposed) return;
      disposed = true;
      head.dispose();
      media.removeEventListener('change', motionChanged);
    },
  });
}
