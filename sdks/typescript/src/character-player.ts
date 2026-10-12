/** A mounted inline-SVG character; importing this module does not require a DOM. */
import { generateCharacter, getCharacterSkins, type CharacterView, type CharacterOptions, type CharacterSkin, type CharacterShape, type CharacterDescriptor } from './characters.js';
import { characterBody, characterFraming } from './character-body.js';
import { createCharacterAnimator, type CharacterFrame } from './character-animation.js';
import type { CharacterArtNode } from './character-art-types.js';
import type { CharacterStateUpdate, CharacterRuntimeState } from './character-state.js';

export type CharacterMotionPreference = boolean | 'system';
export interface CharacterPlayerOptions extends CharacterOptions {
  readonly transitionMs?: number;
  /** Defaults to the operating system's reduced-motion preference. */
  readonly reducedMotion?: CharacterMotionPreference;
}
export interface CharacterAppearanceUpdate {
  readonly skin?: CharacterSkin;
  /** null restores the identity-selected shape. */
  readonly shape?: CharacterShape | null;
  readonly size?: number;
  readonly view?: CharacterView;
}
export interface CharacterPlayer {
  update(state: CharacterStateUpdate): CharacterRuntimeState;
  setAppearance(appearance: CharacterAppearanceUpdate): void;
  setReducedMotion(preference: CharacterMotionPreference): void;
  getState(): CharacterRuntimeState;
  dispose(): void;
}
const namespace = 'http://www.w3.org/2000/svg';
const numeric = (value: number): string => String(Number(value.toFixed(4)));

/** Hosts deliver authorized state updates; this renderer never writes an agent profile. */
export function mountCharacter(element: Element, did: string, options: CharacterPlayerOptions = {}): CharacterPlayer {
  if (!element || element.nodeType !== 1 || !element.ownerDocument?.defaultView) throw new TypeError('Character requires a browser element');
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Invalid character player options');
  const doc = element.ownerDocument;
  const win = doc.defaultView!;
  const { transitionMs, reducedMotion = 'system', ...initialOptions } = options;
  const preference = (value: unknown): CharacterMotionPreference => {
    if (value !== true && value !== false && value !== 'system') throw new TypeError('Invalid character motion preference');
    return value;
  };
  let selectedMotion = preference(reducedMotion);
  const media = win.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => selectedMotion === 'system' ? media.matches : selectedMotion;
  const now = () => win.performance.now();
  let appearance: CharacterOptions = { ...initialOptions };
  let descriptor = generateCharacter(did, appearance);
  const animator = createCharacterAnimator(did, { ...initialOptions, transitionMs, reducedMotion: reduced(), now });
  let disposed = false;
  let request: number | undefined;
  const node = (tag: string, attributes: Readonly<Record<string, string>> = {}): SVGElement => {
    const value = doc.createElementNS(namespace, tag);
    for (const [key, attribute] of Object.entries(attributes)) value.setAttribute(key, attribute);
    return value;
  };
  const instance = 'oaid-' + Array.from(win.crypto.getRandomValues(new Uint32Array(2)), value => value.toString(16)).join('-');
  const artNode = (art: CharacterArtNode): SVGElement => {
    const result = node(art.tag, art.attributes);
    if (art.children) result.append(...art.children.map(artNode));
    return result;
  };
  const face = node('g', { 'data-character-face': 'true' });
  const svg = node('svg', { xmlns: namespace, viewBox: '0 0 512 512', role: 'img', 'data-character-player': 'live-v1' });
  const title = node('title');
  const gaze = node('g', { fill: '#ffffff', 'data-character-eyes': 'live-v1' });
  const eyes = ['left', 'right'].map(side => node('rect', { 'data-character-eye': side }));
  gaze.append(...eyes);
  face.append(gaze);
  let body: SVGElement;
  function setDescriptor(next: CharacterDescriptor): void {
    const geometry = characterBody(next.skin, next.shape, next.color, instance);
    const nextBody = artNode(geometry);
    const framing = characterFraming(next.skin, next.shape, next.view);
    svg.setAttribute('viewBox', framing.viewBox);
    face.setAttribute('transform', framing.faceTransform);
    if (body) body.replaceWith(nextBody);
    else svg.append(nextBody);
    body = nextBody;
    for (const [key, value] of Object.entries({ width: next.size, height: next.size,
      'data-character-view': next.view, 'data-character-skin': next.skin, 'data-character-version': 1, 'data-character-shape': next.shape })) svg.setAttribute(key, String(value));
    descriptor = next;
  }
  function paint(frame: CharacterFrame): void {
    svg.setAttribute('data-character-expression', frame.expression);
    svg.setAttribute('data-character-status', frame.status);
    title.textContent = `OpenAgent ${getCharacterSkins().find(entry => entry.id === descriptor.skin)!.label} character, ${frame.expression}`;
    gaze.setAttribute('transform', `translate(${numeric(frame.gaze.x * 20)} ${numeric(frame.gaze.y * 14)})`);
    frame.eyes.forEach((eye, index) => {
      const rect = eyes[index]!;
      for (const key of ['x', 'y', 'width', 'height', 'rx'] as const) rect.setAttribute(key, numeric(eye[key]));
      rect.setAttribute('transform', `rotate(${numeric(eye.rotation)} ${eye.centerX} ${numeric(eye.centerY)})`);
    });
  }
  function active(): void { if (disposed) throw new Error('Character player is disposed'); }
  function stop(): void { if (request !== undefined) win.cancelAnimationFrame(request); request = undefined; }
  function schedule(): void {
    if (!disposed && request === undefined && !doc.hidden && !reduced() && descriptor.animated) request = win.requestAnimationFrame(tick);
  }
  function tick(): void {
    request = undefined;
    if (disposed || doc.hidden) return;
    paint(animator.sample());
    schedule();
  }
  function motionChanged(): void {
    if (disposed) return;
    stop();
    animator.setReducedMotion(reduced());
    paint(animator.sample());
    schedule();
  }
  function visibilityChanged(): void {
    stop();
    if (!doc.hidden && !disposed) { paint(animator.sample()); schedule(); }
  }
  // Everything above validates before the host element is mutated.
  svg.append(title);
  setDescriptor(descriptor);
  svg.append(face);
  paint(animator.sample());
  element.append(svg);
  media.addEventListener('change', motionChanged);
  doc.addEventListener('visibilitychange', visibilityChanged);
  schedule();
  return Object.freeze({
    update(state: CharacterStateUpdate) {
      active();
      const next = animator.update(state);
      paint(animator.sample());
      schedule();
      return next;
    },
    setAppearance(input: CharacterAppearanceUpdate) {
      active();
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          Object.keys(input).some(key => !['skin', 'shape', 'size', 'view'].includes(key))) throw new TypeError('Invalid character appearance update');
      const next = { ...appearance };
      if (input.skin !== undefined) {
        if (input.skin !== descriptor.skin) delete next.shape;
        next.skin = input.skin;
      }
      if (input.shape === null) delete next.shape;
      else if (input.shape !== undefined) next.shape = input.shape;
      if (input.view !== undefined) next.view = input.view;
      if (input.size !== undefined) next.size = input.size;
      const candidate = generateCharacter(did, { ...next, state: animator.getState() });
      appearance = next;
      setDescriptor(candidate);
      paint(animator.sample());
    },
    setReducedMotion(value: CharacterMotionPreference) {
      active();
      selectedMotion = preference(value);
      motionChanged();
    },
    getState() { return animator.getState(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      media.removeEventListener('change', motionChanged);
      doc.removeEventListener('visibilitychange', visibilityChanged);
      svg.remove();
    },
  });
}
