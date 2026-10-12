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
    description: 'A compact headband and padded ear cups, independent of the character family.' }),
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

type Tag = 'g' | 'path' | 'rect';
const node = (tag: Tag, attributes: Readonly<Record<string, string>>,
  children?: readonly CharacterArtNode[]): CharacterArtNode => Object.freeze({
  tag, attributes: Object.freeze({ ...attributes }),
  ...(children ? { children: Object.freeze([...children]) } : {}),
});

// The common face center is (256,264). All painted geometry, including strokes,
// fits within radius 100, inside every current circular avatar crop. The renderer
// places this stationary layer before the live eyes, preserving extreme poses.
const glasses = node('g', { 'data-character-accessory': 'glasses', 'aria-hidden': 'true' }, [
  // A light keyline around the dark rim stays readable on both dark and pale
  // bodies. Both strokes are hollow; the lens interiors remain transparent.
  node('path', { d: 'M191 242H180M321 242H332', fill: 'none', stroke: '#BBC4D1',
    'stroke-width': '8', 'stroke-linecap': 'round' }),
  node('rect', { x: '191', y: '220', width: '62', height: '86', rx: '23',
    fill: 'none', stroke: '#BBC4D1', 'stroke-width': '10' }),
  node('rect', { x: '259', y: '220', width: '62', height: '86', rx: '23',
    fill: 'none', stroke: '#BBC4D1', 'stroke-width': '10' }),
  node('path', { d: 'M253 245Q256 241 259 245', fill: 'none', stroke: '#BBC4D1',
    'stroke-width': '8', 'stroke-linecap': 'round' }),
  node('path', { d: 'M191 242H180M321 242H332', fill: 'none', stroke: '#243247',
    'stroke-width': '5', 'stroke-linecap': 'round' }),
  node('rect', { x: '191', y: '220', width: '62', height: '86', rx: '23',
    fill: 'none', stroke: '#243247', 'stroke-width': '6' }),
  node('rect', { x: '259', y: '220', width: '62', height: '86', rx: '23',
    fill: 'none', stroke: '#243247', 'stroke-width': '6' }),
  node('path', { d: 'M253 245Q256 241 259 245', fill: 'none', stroke: '#243247',
    'stroke-width': '5', 'stroke-linecap': 'round' }),
  node('path', { d: 'M199 232Q202 224 211 224M267 232Q270 224 279 224', fill: 'none',
    stroke: '#8291A8', 'stroke-width': '2', 'stroke-linecap': 'round' }),
]);

const headphones = node('g', { 'data-character-accessory': 'headphones', 'aria-hidden': 'true' }, [
  node('path', { d: 'M175 246Q175 180 224 180H288Q337 180 337 246',
    fill: 'none', stroke: '#243247', 'stroke-width': '8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  node('path', { d: 'M180 240Q180 188 224 188H288Q332 188 332 240',
    fill: 'none', stroke: '#8291A8', 'stroke-width': '2', 'stroke-linecap': 'round' }),
  node('rect', { x: '164', y: '238', width: '22', height: '62', rx: '11', fill: '#243247' }),
  node('rect', { x: '326', y: '238', width: '22', height: '62', rx: '11', fill: '#243247' }),
  node('rect', { x: '169', y: '245', width: '11', height: '48', rx: '5.5', fill: '#63788F' }),
  node('rect', { x: '332', y: '245', width: '11', height: '48', rx: '5.5', fill: '#63788F' }),
]);
const art: Readonly<Record<CharacterAccessory, CharacterArtNode>> = Object.freeze({ glasses, headphones });

/** Closed SVG art only; no caller markup, external resources, IDs or eye geometry. */
export function characterAccessories(accessories: readonly CharacterAccessory[]): CharacterArtNode {
  const selected = parseCharacterAccessories(accessories);
  return node('g', { 'data-character-accessories': 'true' }, selected.map(item => art[item]));
}
