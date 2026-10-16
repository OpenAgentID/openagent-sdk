/**
 * The One family on its own, for hosts that draw only One heads: the still glyph, the colour helpers and the
 * live head, without the other families' art or a schema library. `@openagentid/sdk/one` serves bundlers;
 * `@openagentid/sdk/browser/one` is the same entry built self-contained for a browser. Importing it does not
 * touch a DOM. Heads are identical to `generateCharacter` and `mountCharacter` with `skin: 'one'`.
 */
import { isAgentAvatarDid } from './avatar-did.js';
import { parseCharacterLabel } from './character-label.js';
import { isOneHeadColor, oneColorForDid, oneFaceFor, oneStillSvg, type OneHeadColor, type OneTheme } from './character-one.js';
import { parseOneLiveOptions, seededRandom, type OneCadence } from './character-one-motion.js';
import { OneHead } from './character-one-player.js';
import { parseAvatarExpression, parseCharacterState, updateCharacterState, type AvatarExpression,
  type CharacterRuntimeState, type CharacterStateUpdate, type LiveEyeState } from './character-state.js';

export { getOneColors, oneColorForDid, nextOneColor, ONE_KINDS } from './character-one.js';
export type { OneColor, OneKind, OneHeadColor, OneColorHolder, OneColorDescription, OneTemperament, OneTheme } from './character-one.js';
export type { OneCadence } from './character-one-motion.js';
export type { AvatarExpression, AvatarStatus, LiveEyeState, CharacterRuntimeState, CharacterStateUpdate } from './character-state.js';

export interface OneOptions {
  /** The agent's DID. Without `color` it selects one of the twelve colours. A blank head needs none. */
  readonly did?: string;
  /** An agent colour, 'charcoal' for Digital One, or 'blank' for a ready-made agent that has not been added. */
  readonly color?: OneHeadColor;
  /** Square pixel size, 16–2048; default 512. Pass the displayed size: it selects the tier and keyline. */
  readonly size?: number;
  /** Light (default) or dark surface tones. */
  readonly theme?: OneTheme;
  /** Accessible name, normally the agent's own name, never a colour word. Without it the head is decorative. */
  readonly label?: string;
  /** Preferred expression, used when the state names no status. */
  readonly expression?: AvatarExpression;
  readonly state?: LiveEyeState;
}

export interface OneMountOptions extends Omit<OneOptions, 'did' | 'color'> {
  /**
   * The head's colour: the agent's stored colour (or `oneColorForDid(did)`), 'charcoal' for Digital One, or
   * 'blank' for a ready-made agent. A live head needs no DID, so the light entry never hashes one in the browser.
   */
  readonly color: OneHeadColor;
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
  readonly color?: OneHeadColor;
  readonly theme?: OneTheme;
  readonly size?: number;
  /** null removes the accessible name; the head is then decorative. */
  readonly label?: string | null;
}

export interface OnePlayer {
  update(state: CharacterStateUpdate): CharacterRuntimeState;
  /** Recolour (a wave at 40 px and up; First blink when a blank head gets its colour), change surface, size or name. */
  setAppearance(input: OneAppearanceUpdate): void;
  setReducedMotion(value: boolean | 'system'): void;
  getState(): CharacterRuntimeState;
  dispose(): void;
}

interface Paint { readonly kind: OneHeadColor; readonly theme: OneTheme; readonly size: number; readonly label?: string }

const stillKeys = ['did', 'color', 'size', 'theme', 'label', 'expression', 'state'];
const mountKeys = ['color', 'size', 'theme', 'label', 'expression', 'state', 'animated', 'reducedMotion', 'cadence', 'group', 'voiceLevel', 'follow'];

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

function parseColor(value: unknown): OneHeadColor {
  if (!isOneHeadColor(value)) throw new TypeError('Unsupported One colour');
  return value;
}

function parsePaint(value: Record<string, unknown>, kind: OneHeadColor): Paint {
  return {
    kind,
    theme: value.theme === undefined ? 'light' : parseTheme(value.theme),
    size: value.size === undefined ? 512 : parseSize(value.size),
    ...(value.label === undefined ? {} : { label: parseCharacterLabel(value.label) }),
  };
}

function initialState(value: Record<string, unknown>): { state: CharacterRuntimeState; override: AvatarExpression | undefined } {
  const preferred = value.expression === undefined ? 'neutral' : parseAvatarExpression(value.expression);
  const state = parseCharacterState(value.state ?? {}, preferred);
  const supplied = value.state as { expression?: unknown } | undefined;
  return { state, override: supplied?.expression === undefined ? undefined : state.expression };
}

/** The still glyph: identical to `generateCharacter(did, { skin: 'one', shape: color, ... }).svg`. */
export function renderOne(options: OneOptions): string {
  const value = record(options, stillKeys, 'options');
  if (value.did !== undefined && !isAgentAvatarDid(value.did)) throw new TypeError('One heads require an agent or agent instance DID');
  if (value.color === undefined && value.did === undefined) throw new TypeError('A One head needs a colour or an agent DID');
  const did = value.did as string | undefined;
  const look = parsePaint(value, value.color === undefined ? oneColorForDid(did!) : parseColor(value.color));
  const { state } = initialState(value);
  return oneStillSvg({ ...(did === undefined ? {} : { did }), ...look, status: state.status, expression: state.expression, blink: state.blink, gaze: state.gaze,
    view: 'avatar', finish: 'plush', eyePlacement: 'face' });
}

/**
 * A live One head in `element`. It replaces a still One already rendered there (for example on the server);
 * otherwise mount into an empty element. Hosts deliver authorized state updates; the head writes no profile.
 */
export function mountOne(element: Element, options: OneMountOptions): OnePlayer {
  if (!element || element.nodeType !== 1 || !element.ownerDocument?.defaultView) throw new TypeError('One head requires a browser element');
  const value = record(options, mountKeys, 'options');
  let look = parsePaint(value, parseColor(value.color));
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
    kind: look.kind, theme: look.theme, size: look.size, ...(look.label === undefined ? {} : { label: look.label }),
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
      const update = record(input, ['color', 'theme', 'size', 'label'], 'appearance update');
      const next: Paint = {
        kind: update.color === undefined ? look.kind : parseColor(update.color),
        theme: update.theme === undefined ? look.theme : parseTheme(update.theme),
        size: update.size === undefined ? look.size : parseSize(update.size),
        ...(update.label === null ? {} : update.label !== undefined ? { label: parseCharacterLabel(update.label) }
          : look.label === undefined ? {} : { label: look.label }),
      };
      look = next;
      head.setPaint(next.kind, next.theme, next.size, next.label);
    },
    setReducedMotion(input: boolean | 'system') {
      active();
      selected = preference(input);
      motionChanged();
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
