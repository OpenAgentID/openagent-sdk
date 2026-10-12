/** Independent, package-owned wearables in the shared face coordinate space. */
import type { CharacterArtNode } from './character-art-types.js';

export type CharacterAccessory = 'glasses' | 'headphones';

export interface CharacterAccessoryDescription {
  readonly id: CharacterAccessory;
  readonly label: string;
  readonly description: string;
}

const order: readonly CharacterAccessory[] = Object.freeze(['glasses', 'headphones'] as const);
const empty: readonly CharacterAccessory[] = Object.freeze([]);
const catalog: readonly CharacterAccessoryDescription[] = Object.freeze([
  Object.freeze({ id: 'glasses' as const, label: 'Glasses',
    description: 'Thin rounded frames with transparent lenses; the shared live eyes remain visible.' }),
  Object.freeze({ id: 'headphones' as const, label: 'Headphones',
    description: 'An external headband and padded ear cups fitted to the head, with room reserved in the avatar crop.' }),
]);

/** Immutable catalog. Accessories can be combined and default to none. */
export function getCharacterAccessories(): readonly CharacterAccessoryDescription[] {
  return catalog;
}

/** Strict selection with canonical ordering; never retains a caller-owned array. */
export function parseCharacterAccessories(value: unknown): readonly CharacterAccessory[] {
  if (value === undefined) return empty;
  if (!Array.isArray(value) || value.length > order.length) throw new TypeError('Invalid character accessories');
  const selected = new Set<CharacterAccessory>();
  for (const item of value) {
    if ((item !== 'glasses' && item !== 'headphones') || selected.has(item)) {
      throw new TypeError('Invalid character accessories');
    }
    selected.add(item);
  }
  return selected.size === 0 ? empty : Object.freeze(order.filter(item => selected.has(item)));
}

export interface CharacterHeadAnchor { readonly left: number; readonly right: number; readonly top: number; readonly sideY: number }
export interface CharacterGaze { readonly x: number; readonly y: number }
export interface AccessoryMotion { readonly poses: readonly CharacterGaze[]; readonly duration: number }
const number = (value: number): string => String(Number(value.toFixed(4)));
const node = (tag: string, attributes: Readonly<Record<string, string>>,
  children?: readonly CharacterArtNode[]): CharacterArtNode => Object.freeze({
  tag, attributes: Object.freeze({ ...attributes }),
  ...(children ? { children: Object.freeze([...children]) } : {}),
});
const defaultHead: CharacterHeadAnchor = { left: 100, right: 412, top: 96, sideY: 264 };
const timing = (motion: AccessoryMotion): Record<string, string> => ({
  keyTimes: '0;0.35;0.7;1', calcMode: 'spline', keySplines: '0.4 0 0.2 1;0.4 0 0.2 1;0.4 0 0.2 1',
  dur: `${number(motion.duration)}s`, begin: '0s', repeatCount: 'indefinite',
});

/** Glasses use the very same gaze sample as the eyes; expression/blink never resize the frame. */
export function characterGlassesPose(head: CharacterHeadAnchor, gaze: CharacterGaze, eyeOffset = 0, eyeCenterY = 264): { transform: string; temples: string } {
  const x = gaze.x * 20, y = gaze.y * 14 + eyeCenterY - 264;
  const left = 191 - eyeOffset + x, right = 321 + eyeOffset + x, hingeY = 246 + y;
  return {
    transform: `translate(${number(x)} ${number(y)})`,
    temples: `M${number(head.left)} ${number(head.sideY)}Q${number((head.left + left) / 2)} ${number(hingeY - 9)} ${number(left)} ${number(hingeY)}M${number(head.right)} ${number(head.sideY)}Q${number((head.right + right) / 2)} ${number(hingeY - 9)} ${number(right)} ${number(hingeY)}`,
  };
}

function glasses(head: CharacterHeadAnchor, gaze: CharacterGaze, eyeOffset: number, motion: AccessoryMotion | undefined, eyeCenterY: number): CharacterArtNode {
  const pose = characterGlassesPose(head, gaze, eyeOffset, eyeCenterY);
  const frames: CharacterArtNode[] = [];
  // A fine pale edge keeps the metal readable on dark skins without a bulky rim.
  for (const [stroke, width] of [['#BAC5CF', '6'], ['#273647', '3.25']] as const) {
    for (const x of [191 - eyeOffset, 259 + eyeOffset]) frames.push(node('rect', {
      x: number(x), y: '206', width: '62', height: '116', rx: '28', fill: 'none', stroke, 'stroke-width': width,
    }));
    frames.push(node('path', { d: `M${253 - eyeOffset} 246Q256 240 ${259 + eyeOffset} 246`, fill: 'none', stroke, 'stroke-width': width, 'stroke-linecap': 'round' }));
  }
  frames.push(node('path', { d: `M${194 - eyeOffset} 224Q${200 - eyeOffset} 208 ${217 - eyeOffset} 207M${262 + eyeOffset} 224Q${268 + eyeOffset} 208 ${285 + eyeOffset} 207`, fill: 'none', stroke: '#E3EAF0', 'stroke-width': '1', 'stroke-linecap': 'round' }));
  for (const x of [191 - eyeOffset, 321 + eyeOffset]) {
    frames.push(node('path', { d: `M${number(x)} 243Q${number(x)} 246 ${number(x)} 249`, fill: 'none', stroke: '#8898A8', 'stroke-width': '3.5', 'stroke-linecap': 'round' }));
  }
  const animated = motion ? [node('animateTransform', { attributeName: 'transform', type: 'translate',
    values: motion.poses.map(p => `${number(p.x * 20)} ${number(p.y * 14 + eyeCenterY - 264)}`).join(';'), ...timing(motion) })] : [];
  return node('g', { 'data-character-accessory': 'glasses', 'aria-hidden': 'true' }, [
    ...(['#BAC5CF', '#273647'] as const).map((stroke, index) => node('path', {
      'data-glasses-temples': 'true', d: pose.temples, fill: 'none', stroke, 'stroke-width': index ? '2.5' : '4', 'stroke-linecap': 'round',
    }, motion ? [node('animate', { attributeName: 'd', values: motion.poses.map(p => characterGlassesPose(head, p, eyeOffset, eyeCenterY).temples).join(';'), ...timing(motion) })] : undefined)),
    node('g', { 'data-glasses-frames': 'true', transform: pose.transform }, [...animated, ...frames]),
  ]);
}

function headphones(head: CharacterHeadAnchor): CharacterArtNode {
  const { left, right, top, sideY } = head;
  const middle = (left + right) / 2;
  const band = `M${number(left - 9)} ${number(sideY - 9)}Q${number(left - 9)} ${number(top - 22)} ${number(middle)} ${number(top - 22)}Q${number(right + 9)} ${number(top - 22)} ${number(right + 9)} ${number(sideY - 9)}`;
  return node('g', { 'data-character-accessory': 'headphones', 'aria-hidden': 'true' }, [
    node('path', { d: band, fill: 'none', stroke: '#A8B5C2', 'stroke-width': '11', 'stroke-linecap': 'round' }),
    node('path', { d: band, fill: 'none', stroke: '#253343', 'stroke-width': '9', 'stroke-linecap': 'round' }),
    node('path', { d: band, fill: 'none', stroke: '#627384', 'stroke-width': '2.25', 'stroke-linecap': 'round' }),
    ...[left - 29, right + 2].flatMap((x, side) => [
      // All relief stays inside the qualified cup envelope; no shadows enlarge the crop.
      node('rect', { x: number(x), y: number(sideY - 33), width: '27', height: '66', rx: '13', fill: '#263545', stroke: '#A8B5C2', 'stroke-width': '1' }),
      node('rect', { x: number(x + 2.5), y: number(sideY - 30), width: '22', height: '60', rx: '11', fill: '#14202E' }),
      node('rect', { x: number(x + 5), y: number(sideY - 26), width: '17', height: '52', rx: '8.5', fill: '#394B5D' }),
      node('rect', { x: number(x + (side ? 2 : 19)), y: number(sideY - 25), width: '6', height: '50', rx: '3', fill: '#1D2A38' }),
      node('path', { d: `M${number(x + 6)} ${number(sideY - 17)}Q${number(x + 6)} ${number(sideY - 27)} ${number(x + 13.5)} ${number(sideY - 27)}Q${number(x + 21)} ${number(sideY - 27)} ${number(x + 21)} ${number(sideY - 17)}`, fill: 'none', stroke: '#8192A3', 'stroke-width': '1.25', 'stroke-linecap': 'round' }),
      node('path', { d: `M${number(x + (side ? 20 : 7))} ${number(sideY - 12)}Q${number(x + (side ? 20 : 7))} ${number(sideY)} ${number(x + (side ? 20 : 7))} ${number(sideY + 13)}`, fill: 'none', stroke: '#60768B', 'stroke-width': '1', 'stroke-linecap': 'round' }),
    ]),
  ]);
}

/** Closed SVG art only; head anchors are package geometry, never caller markup. */
export function characterAccessories(accessories: readonly CharacterAccessory[], head: CharacterHeadAnchor = defaultHead,
  gaze: CharacterGaze = { x: 0, y: 0 }, eyeOffset = 0, motion?: AccessoryMotion, eyeCenterY = 264): CharacterArtNode {
  const selected = parseCharacterAccessories(accessories);
  return node('g', { 'data-character-accessories': 'true' }, selected.map(item =>
    item === 'glasses' ? glasses(head, gaze, eyeOffset, motion, eyeCenterY) : headphones(head)));
}
