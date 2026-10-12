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
  for (const [stroke, width] of [['#BBC4D1', '9'], ['#243247', '5']] as const) {
    for (const x of [191 - eyeOffset, 259 + eyeOffset]) frames.push(node('rect', {
      x: number(x), y: '206', width: '62', height: '116', rx: '28', fill: 'none', stroke, 'stroke-width': width,
    }));
    frames.push(node('path', { d: `M${253 - eyeOffset} 246Q256 240 ${259 + eyeOffset} 246`, fill: 'none', stroke, 'stroke-width': width, 'stroke-linecap': 'round' }));
  }
  frames.push(node('path', { d: `M${199 - eyeOffset} 224Q${202 - eyeOffset} 214 ${213 - eyeOffset} 212M${267 + eyeOffset} 224Q${270 + eyeOffset} 214 ${281 + eyeOffset} 212`, fill: 'none', stroke: '#e2e8f0', 'stroke-width': '1.5', 'stroke-linecap': 'round' }));
  const animated = motion ? [node('animateTransform', { attributeName: 'transform', type: 'translate',
    values: motion.poses.map(p => `${number(p.x * 20)} ${number(p.y * 14 + eyeCenterY - 264)}`).join(';'), ...timing(motion) })] : [];
  return node('g', { 'data-character-accessory': 'glasses', 'aria-hidden': 'true' }, [
    ...(['#BBC4D1', '#243247'] as const).map((stroke, index) => node('path', {
      'data-glasses-temples': 'true', d: pose.temples, fill: 'none', stroke, 'stroke-width': index ? '4' : '7', 'stroke-linecap': 'round',
    }, motion ? [node('animate', { attributeName: 'd', values: motion.poses.map(p => characterGlassesPose(head, p, eyeOffset, eyeCenterY).temples).join(';'), ...timing(motion) })] : undefined)),
    node('g', { 'data-glasses-frames': 'true', transform: pose.transform }, [...animated, ...frames]),
  ]);
}

function headphones(head: CharacterHeadAnchor): CharacterArtNode {
  const { left, right, top, sideY } = head;
  const middle = (left + right) / 2;
  const band = `M${number(left - 9)} ${number(sideY - 9)}Q${number(left - 9)} ${number(top - 22)} ${number(middle)} ${number(top - 22)}Q${number(right + 9)} ${number(top - 22)} ${number(right + 9)} ${number(sideY - 9)}`;
  return node('g', { 'data-character-accessory': 'headphones', 'aria-hidden': 'true' }, [
    node('path', { d: band, fill: 'none', stroke: '#141c2a', 'stroke-width': '13', 'stroke-linecap': 'round' }),
    node('path', { d: band, fill: 'none', stroke: '#66788f', 'stroke-width': '6', 'stroke-linecap': 'round' }),
    ...[left - 29, right + 2].flatMap(x => [
      node('rect', { x: number(x), y: number(sideY - 33), width: '27', height: '66', rx: '12', fill: '#182231', stroke: '#92a2b8', 'stroke-width': '1.5' }),
      node('rect', { x: number(x + 6), y: number(sideY - 25), width: '14', height: '50', rx: '7', fill: '#41556e' }),
      node('path', { d: `M${number(x + 10)} ${number(sideY - 18)}Q${number(x + 8)} ${number(sideY)} ${number(x + 10)} ${number(sideY + 18)}`, fill: 'none', stroke: '#94a5bb', 'stroke-width': '2', 'stroke-linecap': 'round' }),
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
