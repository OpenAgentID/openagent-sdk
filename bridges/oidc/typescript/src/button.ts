/**
 * @openagentid/oidc/button -- the branded "Continue as Agent" browser control.
 *
 * Framework-neutral and browser-only. It renders one canonical button whose
 * only variable element is a bounded 32px avatar slot filled by the real
 * OpenAgentID character generator and live player from `@openagentid/sdk`.
 *
 * The control starts nothing by itself: the host's `onContinue` callback owns
 * the OIDC flow (issuer, redirect, state, nonce, PKCE). The decorative seed is
 * never sent anywhere and never implies an authenticated agent.
 *
 * This entry deliberately imports nothing from the Node provider graph
 * (`oidc-provider`, `jose`, `node:*`); keep it that way.
 */
import { mountCharacter, type CharacterPlayer } from '@openagentid/sdk/character-player';
import { getCharacterSkins, type CharacterShape, type CharacterSkin } from '@openagentid/sdk/characters';
import { type ContinueAsAgentAppearance, type ResolvedButtonAppearance, resolveButtonAppearance } from './button-identity.js';

export { SEASONAL_FAMILIES, decorativeAgentDid, isDecorativeAgentDid, pickYearRoundFamily, resolveButtonAppearance, yearRoundFamilies } from './button-identity.js';
export type { ContinueAsAgentAppearance, ResolvedButtonAppearance, RandomBytes } from './button-identity.js';

/** The exact brand label. It is not configurable. */
export const CONTINUE_AS_AGENT_LABEL = 'Continue as Agent';
/** Side of the bounded avatar slot in CSS pixels. */
export const CONTINUE_AS_AGENT_AVATAR_SIZE = 32;

export type ContinueAsAgentTheme = 'auto' | 'light' | 'dark';
export type ContinueAsAgentSize = 'medium' | 'large';
export type ContinueAsAgentState = 'idle' | 'loading' | 'error';

export interface ContinueAsAgentOptions {
  /** Starts the host's own OIDC authorization request. May return a promise while it runs. */
  readonly onContinue: (event: ContinueAsAgentActivation) => void | Promise<void>;
  /** Receives rejections and thrown errors from `onContinue` after the button has recovered. */
  readonly onError?: (error: unknown) => void;
  /** Shows an already chosen agent instead of a random decorative character. */
  readonly appearance?: ContinueAsAgentAppearance;
  readonly disabled?: boolean;
  /** `auto` follows `prefers-color-scheme`; `light` and `dark` are fixed. */
  readonly theme?: ContinueAsAgentTheme;
  readonly size?: ContinueAsAgentSize;
  /** Stretch to the container width; the silhouette, label and mark do not change. */
  readonly fullWidth?: boolean;
  /** Accessible text announced when `onContinue` fails. */
  readonly errorMessage?: string;
}

/**
 * What `onContinue` receives: only the button. The decorative appearance is
 * deliberately absent so a generated pseudo-DID can never slip into an
 * authorization request; read `handle.appearance` for display purposes only.
 */
export interface ContinueAsAgentActivation {
  readonly button: HTMLButtonElement;
}

export interface ContinueAsAgentIdentity {
  readonly did: string;
  readonly skin: CharacterSkin;
  readonly shape: CharacterShape;
  readonly decorative: boolean;
}

export interface ContinueAsAgentHandle {
  readonly root: HTMLElement;
  readonly button: HTMLButtonElement;
  /** Display-only: which character fills the slot. Never send it as an identity claim. */
  readonly appearance: ContinueAsAgentIdentity;
  getState(): ContinueAsAgentState;
  isDisabled(): boolean;
  setDisabled(disabled: boolean): void;
  dispose(): void;
}

const themes: readonly ContinueAsAgentTheme[] = ['auto', 'light', 'dark'];
const sizes: readonly ContinueAsAgentSize[] = ['medium', 'large'];
const optionKeys: readonly string[] = ['onContinue', 'onError', 'appearance', 'disabled', 'theme', 'size', 'fullWidth', 'errorMessage'];
const svgNamespace = 'http://www.w3.org/2000/svg';
/** Official OpenAgentID mark (four OAID glyphs), reproduced locally in currentColor. */
const markPaths: readonly string[] = [
  'M114.8 0C135.6 0 154.8 5.2 172.4 15.6C190 25.7333 203.867 39.6 214 57.2C224.4 74.8 229.6 94 229.6 114.8V175.6C229.6 196.4 224.4 215.6 214 233.2C203.867 250.8 190 264.8 172.4 275.2C154.8 285.333 135.6 290.4 114.8 290.4C94 290.4 74.8 285.333 57.2 275.2C39.6 264.8 25.6 250.8 15.2 233.2C5.06667 215.6 0 196.4 0 175.6V114.8C0 94 5.06667 74.8 15.2 57.2C25.6 39.6 39.6 25.7333 57.2 15.6C74.8 5.2 94 0 114.8 0ZM14.8 175.6C14.8 193.733 19.2 210.533 28 226C37.0667 241.2 49.2 253.333 64.4 262.4C79.8667 271.2 96.6667 275.6 114.8 275.6C132.933 275.6 149.6 271.2 164.8 262.4C180.267 253.333 192.4 241.2 201.2 226C210.267 210.533 214.8 193.733 214.8 175.6V114.8C214.8 96.6667 210.267 80 201.2 64.8C192.4 49.3333 180.267 37.2 164.8 28.4C149.6 19.3333 132.933 14.8 114.8 14.8C96.6667 14.8 79.8667 19.3333 64.4 28.4C49.2 37.2 37.0667 49.3333 28 64.8C19.2 80 14.8 96.6667 14.8 114.8V175.6Z',
  'M542.094 284.4H279.694L410.894 0L542.094 284.4ZM302.894 269.6H518.894L410.894 35.2L302.894 269.6Z',
  'M206.2 366V380.8H123V629.6H206.2V644.4H25.8V629.6H108.6V380.8H25.8V366H206.2Z',
  'M311.894 644.4V366H415.494C435.76 366 454.427 371.067 471.494 381.2C488.827 391.333 502.56 405.067 512.694 422.4C522.827 439.467 527.894 458.133 527.894 478.4V532C527.894 552.267 522.827 571.067 512.694 588.4C502.56 605.467 488.827 619.067 471.494 629.2C454.427 639.333 435.76 644.4 415.494 644.4H311.894Z',
];

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

function officialMark(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('viewBox', '0 0 543 645');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'oaid-continue__mark');
  for (const d of markPaths) {
    const path = doc.createElementNS(svgNamespace, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'currentColor');
    svg.append(path);
  }
  return svg;
}

/**
 * Mount one Continue as Agent button into `container`.
 *
 * The decorative seed and family are chosen once per mount and never change
 * across renders, focus, clicks, loading or errors. Pass `appearance.did` to
 * show an agent the host has already selected; doing so still does not claim
 * that the agent is authenticated.
 */
export function mountContinueAsAgent(container: Element, options: ContinueAsAgentOptions): ContinueAsAgentHandle {
  validate(container, options);
  const doc = container.ownerDocument;
  const win = doc.defaultView!;
  const random = (length: number): Uint8Array => win.crypto.getRandomValues(new Uint8Array(length));
  const resolved: ResolvedButtonAppearance = resolveButtonAppearance(options.appearance, getCharacterSkins(), random);
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

  const label = doc.createElement('span');
  label.className = 'oaid-continue__label';
  label.textContent = CONTINUE_AS_AGENT_LABEL;

  const status = doc.createElement('span');
  status.className = 'oaid-continue__status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  // Mounted empty and accessibility-visible from the start so a later failure is announced.
  status.textContent = '';

  // The real SDK player validates the DID and appearance before anything is attached.
  const player: CharacterPlayer = mountCharacter(avatar, resolved.did, {
    skin: resolved.skin,
    ...(resolved.shape === undefined ? {} : { shape: resolved.shape }),
    ...(resolved.finish === undefined ? {} : { finish: resolved.finish }),
    ...(resolved.eyePlacement === undefined ? {} : { eyePlacement: resolved.eyePlacement }),
    ...(resolved.accessories === undefined ? {} : { accessories: resolved.accessories }),
    size: CONTINUE_AS_AGENT_AVATAR_SIZE,
    reducedMotion: 'system',
  });
  const mounted = avatar.querySelector('svg[data-character-player]')!;
  const appearance: ContinueAsAgentIdentity = Object.freeze({
    did: resolved.did,
    skin: mounted.getAttribute('data-character-skin') as CharacterSkin,
    shape: mounted.getAttribute('data-character-shape') as CharacterShape,
    decorative: resolved.decorative,
  });

  let state: ContinueAsAgentState = 'idle';
  let pending = false;
  let disposed = false;
  const statusId = 'oaid-continue-status-' + Array.from(random(4), value => value.toString(16).padStart(2, '0')).join('');
  status.id = statusId;

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

  button.append(avatar, label, officialMark(doc));
  root.append(button, status);
  button.addEventListener('click', activate);
  container.append(root);

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
      button.removeEventListener('click', activate);
      player.dispose();
      root.remove();
    },
  });
}
