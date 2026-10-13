/**
 * @openagentid/oidc/button -- the branded "Continue as Agent" browser control.
 *
 * Framework-neutral and browser-only. It renders one canonical button: the
 * exact label beside a dark 32px window holding a pair of bright eyes, an
 * agent in the dark, never a face. Nothing else decorates it. The eyes are the real `@openagentid/sdk`
 * live-eye player; the character body is simply never shown.
 *
 * The control starts nothing by itself: the host's `onContinue` callback owns
 * the OIDC flow (issuer, redirect, state, nonce, PKCE). The decorative seed only
 * varies eye timing, is never sent anywhere and never implies authentication.
 *
 * This entry deliberately imports nothing from the Node provider graph
 * (`oidc-provider`, `jose`, `node:*`); keep it that way.
 */
import { mountCharacter, type CharacterPlayer } from '@openagentid/sdk/character-player';
import type { AvatarExpression } from '@openagentid/sdk/characters';
import { type ResolvedButtonAppearance, resolveButtonAppearance } from './button-identity.js';

export { decorativeAgentDid, isDecorativeAgentDid, resolveButtonAppearance } from './button-identity.js';
export type { ContinueAsAgentAppearance, ResolvedButtonAppearance, RandomBytes } from './button-identity.js';

/** The exact brand label. It is not configurable. */
export const CONTINUE_AS_AGENT_LABEL = 'Continue as Agent';
/** Side of the dark eye window in CSS pixels. */
export const CONTINUE_AS_AGENT_AVATAR_SIZE = 32;

export type ContinueAsAgentTheme = 'auto' | 'light' | 'dark';
export type ContinueAsAgentSize = 'medium' | 'large';
export type ContinueAsAgentState = 'idle' | 'loading' | 'error';

export interface ContinueAsAgentOptions {
  /** Starts the host's own OIDC authorization request. May return a promise while it runs. */
  readonly onContinue: (event: ContinueAsAgentActivation) => void | Promise<void>;
  /** Receives rejections and thrown errors from `onContinue` after the button has recovered. */
  readonly onError?: (error: unknown) => void;
  /** Seeds the eyes' timing from an already chosen agent DID instead of a random decorative seed. */
  readonly appearance?: import('./button-identity.js').ContinueAsAgentAppearance;
  readonly disabled?: boolean;
  /** `auto` follows `prefers-color-scheme`; `light` and `dark` are fixed. */
  readonly theme?: ContinueAsAgentTheme;
  readonly size?: ContinueAsAgentSize;
  /** Stretch to the container width; the silhouette and label do not change. */
  readonly fullWidth?: boolean;
  /** Accessible text announced when `onContinue` fails. */
  readonly errorMessage?: string;
}

/**
 * What `onContinue` receives: only the button. The decorative seed is
 * deliberately absent so a generated pseudo-DID can never slip into an
 * authorization request; read `handle.appearance` for display purposes only.
 */
export interface ContinueAsAgentActivation {
  readonly button: HTMLButtonElement;
}

export interface ContinueAsAgentIdentity {
  readonly did: string;
  readonly decorative: boolean;
}

export interface ContinueAsAgentHandle {
  readonly root: HTMLElement;
  readonly button: HTMLButtonElement;
  /** Display-only: which seed times the eyes. Never send it as an identity claim. */
  readonly appearance: ContinueAsAgentIdentity;
  getState(): ContinueAsAgentState;
  isDisabled(): boolean;
  setDisabled(disabled: boolean): void;
  dispose(): void;
}

const themes: readonly ContinueAsAgentTheme[] = ['auto', 'light', 'dark'];
const sizes: readonly ContinueAsAgentSize[] = ['medium', 'large'];
const optionKeys: readonly string[] = ['onContinue', 'onError', 'appearance', 'disabled', 'theme', 'size', 'fullWidth', 'errorMessage'];
/** Idle glances: the SDK expressions that tilt, narrow and widen the eyes while nothing is happening. */
const idleMoods: readonly AvatarExpression[] = ['neutral', 'curious', 'attentive', 'suspicious', 'thoughtful', 'neutral', 'unimpressed', 'confused', 'sleepy', 'surprised'];
const moodPauseMs = 1800;
const moodSpreadMs = 2400;
/**
 * Bounded wander of the eye pair inside the 32px window, in CSS pixels and
 * degrees, on top of the SDK's own gaze. Sized so the widest SDK expression
 * at the stylesheet's 1.35 scale never leaves the window; SDK transforms stay untouched.
 */
const glanceRangeX = 3;
const glanceRangeY = 3;
const glanceTiltDegrees = 7;
/** Roughly one glance in four keeps the current spot so the eyes pause rather than swim. */
const glanceHoldChance = 4;
function validate(container: unknown, options: unknown): asserts options is ContinueAsAgentOptions {
  if (!container || typeof container !== 'object' || (container as Element).nodeType !== 1 || !(container as Element).ownerDocument?.defaultView) {
    throw new TypeError('Continue as Agent requires a browser container element');
  }
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !optionKeys.includes(key))) {
    throw new TypeError('Invalid Continue as Agent options');
  }
  const value = options as Record<string, unknown>;
  if (typeof value.onContinue !== 'function') throw new TypeError('Continue as Agent requires an onContinue callback');
  if (value.onError !== undefined && typeof value.onError !== 'function') throw new TypeError('Continue as Agent onError must be a function');
  if (value.disabled !== undefined && typeof value.disabled !== 'boolean') throw new TypeError('Continue as Agent disabled must be boolean');
  if (value.fullWidth !== undefined && typeof value.fullWidth !== 'boolean') throw new TypeError('Continue as Agent fullWidth must be boolean');
  if (value.theme !== undefined && !themes.includes(value.theme as ContinueAsAgentTheme)) throw new TypeError('Unsupported Continue as Agent theme');
  if (value.size !== undefined && !sizes.includes(value.size as ContinueAsAgentSize)) throw new TypeError('Unsupported Continue as Agent size');
  if (value.errorMessage !== undefined && (typeof value.errorMessage !== 'string' || value.errorMessage.trim().length === 0)) {
    throw new TypeError('Continue as Agent errorMessage must be non-empty text');
  }
}

/**
 * Mount one Continue as Agent button into `container`.
 *
 * The eye-timing seed is chosen once per mount and never changes across
 * renders, focus, clicks, loading or errors. Pass `appearance.did` to time the
 * eyes from an agent the host has already selected; doing so still does not
 * claim that the agent is authenticated.
 */
export function mountContinueAsAgent(container: Element, options: ContinueAsAgentOptions): ContinueAsAgentHandle {
  validate(container, options);
  const doc = container.ownerDocument;
  const win = doc.defaultView!;
  const random = (length: number): Uint8Array => win.crypto.getRandomValues(new Uint8Array(length));
  const randomBelow = (limit: number): number => {
    const bytes = random(2);
    return (bytes[0]! * 256 + bytes[1]!) % limit;
  };
  const resolved: ResolvedButtonAppearance = resolveButtonAppearance(options.appearance, random);
  const { onContinue, onError } = options;
  const errorMessage = options.errorMessage ?? 'Could not continue as agent. Try again.';

  const root = doc.createElement('div');
  root.className = 'oaid-continue';
  root.dataset.theme = options.theme ?? 'auto';
  root.dataset.size = options.size ?? 'medium';
  if (options.fullWidth) root.dataset.fullWidth = 'true';

  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'oaid-continue__button';
  button.dataset.state = 'idle';
  button.disabled = options.disabled === true;

  const avatar = doc.createElement('span');
  avatar.className = 'oaid-continue__avatar';
  avatar.setAttribute('aria-hidden', 'true');
  // Outer wrapper the button moves and tilts; the SDK keeps full control of the eye group inside it.
  const eyes = doc.createElement('span');
  eyes.className = 'oaid-continue__eyes';
  avatar.append(eyes);

  const label = doc.createElement('span');
  label.className = 'oaid-continue__label';
  label.textContent = CONTINUE_AS_AGENT_LABEL;

  const status = doc.createElement('span');
  status.className = 'oaid-continue__status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  // Mounted empty and accessibility-visible from the start so a later failure is announced.
  status.textContent = '';

  // One fixed plain character whose body the stylesheet never shows; only the
  // live eyes remain. The real SDK player validates the DID before anything is attached.
  const player: CharacterPlayer = mountCharacter(eyes, resolved.did, {
    skin: 'autos', shape: 'standard', finish: 'flat', eyePlacement: 'face', accessories: [],
    size: CONTINUE_AS_AGENT_AVATAR_SIZE,
    reducedMotion: 'system',
  });
  const appearance: ContinueAsAgentIdentity = Object.freeze({ did: resolved.did, decorative: resolved.decorative });

  let state: ContinueAsAgentState = 'idle';
  let pending = false;
  let disposed = false;
  let hovered = false;
  let focused = false;
  const engaged = (): boolean => hovered || focused;
  let moodTimer: number | undefined;
  const motion = win.matchMedia('(prefers-reduced-motion: reduce)');
  const statusId = 'oaid-continue-status-' + Array.from(random(4), value => value.toString(16).padStart(2, '0')).join('');
  status.id = statusId;

  // Idle glances run on a slow timer; they stop under reduced motion, in hidden
  // tabs, while the pointer or focus is on the button, and outside the idle state.
  function clearMood(): void {
    if (moodTimer !== undefined) win.clearTimeout(moodTimer);
    moodTimer = undefined;
  }
  function restless(): boolean {
    return !disposed && !doc.hidden && !motion.matches && state === 'idle' && !engaged();
  }
  function scheduleMood(): void {
    clearMood();
    if (restless()) moodTimer = win.setTimeout(nextMood, moodPauseMs + randomBelow(moodSpreadMs));
  }
  function look(x: number, y: number, tilt: number): void {
    eyes.style.setProperty('--oaid-eyes-x', `${x}px`);
    eyes.style.setProperty('--oaid-eyes-y', `${y}px`);
    eyes.style.setProperty('--oaid-eyes-tilt', `${tilt}deg`);
  }
  function glance(): void {
    if (randomBelow(glanceHoldChance) === 0) return;
    const spread = (range: number, steps: number) => (randomBelow(steps * 2 + 1) - steps) * (range / steps);
    look(spread(glanceRangeX, 3), spread(glanceRangeY, 3), spread(glanceTiltDegrees, 7));
  }
  function nextMood(): void {
    moodTimer = undefined;
    if (!restless()) return;
    player.update({ expression: idleMoods[randomBelow(idleMoods.length)]! });
    glance();
    scheduleMood();
  }
  function settleIdleEyes(): void {
    if (disposed || state !== 'idle') return;
    // Attention or a fresh idle period starts with the eyes centred on the viewer.
    look(0, 0, 0);
    player.update({ status: engaged() ? 'listening' : 'idle' });
    scheduleMood();
  }
  // Hover and focus are tracked separately: leaving with the pointer must not
  // resume idle glances while keyboard focus remains, and vice versa.
  function attention(change: Partial<{ hovered: boolean; focused: boolean }>): void {
    const before = engaged();
    if (change.hovered !== undefined) hovered = change.hovered;
    if (change.focused !== undefined) focused = change.focused;
    if (engaged() === before) return;
    clearMood();
    settleIdleEyes();
  }
  const pointerEnter = (): void => attention({ hovered: true });
  const pointerLeave = (): void => attention({ hovered: false });
  const focusIn = (): void => attention({ focused: true });
  const focusOut = (): void => attention({ focused: false });
  function visibilityChanged(): void { if (doc.hidden) clearMood(); else scheduleMood(); }
  function motionChanged(): void { if (motion.matches) look(0, 0, 0); scheduleMood(); }

  function setState(next: ContinueAsAgentState): void {
    state = next;
    button.dataset.state = next;
    button.setAttribute('aria-busy', next === 'loading' ? 'true' : 'false');
    if (next === 'error') {
      status.textContent = errorMessage;
      button.setAttribute('aria-describedby', statusId);
    } else {
      status.textContent = '';
      button.removeAttribute('aria-describedby');
    }
  }

  function settle(result: 'success' | 'error', error?: unknown): void {
    pending = false;
    if (disposed) return;
    if (result === 'success') {
      setState('idle');
      player.update({ status: 'success' });
      scheduleMood();
      return;
    }
    setState('error');
    player.update({ status: 'error' });
    if (onError) onError(error);
  }

  function activate(event: Event): void {
    if (disposed || pending || button.disabled) return;
    event.preventDefault();
    pending = true;
    clearMood();
    look(0, 0, 0);
    setState('loading');
    player.update({ status: 'reasoning' });
    let outcome: void | Promise<void>;
    try {
      outcome = onContinue({ button });
    } catch (error) {
      settle('error', error);
      return;
    }
    if (outcome && typeof (outcome as Promise<void>).then === 'function') {
      (outcome as Promise<void>).then(() => settle('success'), error => settle('error', error));
    } else {
      settle('success');
    }
  }

  button.append(avatar, label);
  root.append(button, status);
  button.addEventListener('click', activate);
  button.addEventListener('pointerenter', pointerEnter);
  button.addEventListener('pointerleave', pointerLeave);
  button.addEventListener('focus', focusIn);
  button.addEventListener('blur', focusOut);
  motion.addEventListener('change', motionChanged);
  doc.addEventListener('visibilitychange', visibilityChanged);
  container.append(root);
  look(0, 0, 0);
  scheduleMood();

  return Object.freeze({
    root,
    button,
    appearance,
    getState: () => state,
    isDisabled: () => button.disabled,
    setDisabled(disabled: boolean) {
      if (disposed) throw new Error('Continue as Agent button is disposed');
      if (typeof disabled !== 'boolean') throw new TypeError('Continue as Agent disabled must be boolean');
      button.disabled = disabled;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearMood();
      button.removeEventListener('click', activate);
      button.removeEventListener('pointerenter', pointerEnter);
      button.removeEventListener('pointerleave', pointerLeave);
      button.removeEventListener('focus', focusIn);
      button.removeEventListener('blur', focusOut);
      motion.removeEventListener('change', motionChanged);
      doc.removeEventListener('visibilitychange', visibilityChanged);
      player.dispose();
      root.remove();
    },
  });
}
