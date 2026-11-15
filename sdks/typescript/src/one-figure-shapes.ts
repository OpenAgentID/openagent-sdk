/**
 * The One family's second set of heads and the warm colours, from the avatar family design (round 2, approved
 * 15 Nov 2026; the design note's §11). They sit after the fourteen heads of character-one-shapes.ts and are never
 * part of the DID defaults: `oneLookForDid` keeps the fourteen shapes and eighteen colours, so no existing agent
 * changes look. Paths are in agent-eye's head box (viewBox -100 -100 200 200): one closed subpath of M, H, V, L, A
 * and Z with circular arcs only, clockwise. Eye placement uses the same fields and defaults as the first set.
 */
import { freeze } from './character-intrinsics.js';
import type { OneShapeEye, OneTemperament } from './character-one-shapes.js';

/** The ten heads added after the fourteen, in library order. */
export type OneNewShape = 'capsule' | 'chip' | 'scallop' | 'leaf' | 'house' | 'mushroom' | 'ghost' | 'tulip' | 'bell' | 'cat';
/** The five warm colours added after the eighteen, in team order. Sky already exists. */
export type OneWarmColor = 'deepblue' | 'tomato' | 'sunny' | 'leaf' | 'cream';

export interface OneNewShapeDescription {
  readonly id: OneNewShape;
  readonly label: string;
  readonly path: string;
  readonly eye: OneShapeEye;
  readonly mouthDy: number;
  readonly pivot: { readonly x: number; readonly y: number };
  readonly temperament: Exclude<OneTemperament, 'dry'>;
  /** The head's own colour, from either palette. */
  readonly color: string;
  /** Colours that would turn the head into a sign. */
  readonly never: readonly string[];
}

export interface OneWarmColorDescription {
  readonly id: OneWarmColor;
  readonly label: string;
  readonly disc: string;
  readonly eye: string;
  readonly keyline: string | null;
}

const title = (id: string): string => id[0]!.toUpperCase() + id.slice(1);
const eye = (x: number, y: number, scale: number): OneShapeEye =>
  freeze({ x, y, scale, openScale: 1, lookGain: 1, liftGain: 1, openMax: 1.35, mouthMax: 1 });
const head = (id: OneNewShape, path: string, placement: OneShapeEye, pivotY: number, temperament: Exclude<OneTemperament, 'dry'>,
  color: string, never: readonly string[] = []): OneNewShapeDescription =>
  freeze({ id, label: title(id), path, eye: placement, mouthDy: 0, pivot: freeze({ x: 0, y: pivotY }), temperament, color, never: freeze([...never]) });

export const ONE_NEW_SHAPES: readonly OneNewShapeDescription[] = freeze([
  head('capsule', 'M0 -64H34A64 64 0 0 1 34 64H-34A64 64 0 0 1 -34 -64Z', eye(0, 0, 0.62), 64, 'quick', 'sunny'),
  head('chip', 'M-20.9 -54.99A24 24 0 0 1 20.9 -54.99L75.78 42.2A24 24 0 0 1 54.88 78L-54.88 78A24 24 0 0 1 -75.78 42.2Z', eye(0, 26, 0.56), 78, 'quick', 'tomato'),
  head('scallop', 'M-75 -75A25 25 0 0 1 -25 -75A25 25 0 0 1 25 -75A25 25 0 0 1 75 -75A25 25 0 0 1 75 -25A25 25 0 0 1 75 25A25 25 0 0 1 75 75A25 25 0 0 1 25 75A25 25 0 0 1 -25 75A25 25 0 0 1 -75 75A25 25 0 0 1 -75 25A25 25 0 0 1 -75 -25A25 25 0 0 1 -75 -75Z', eye(0, 0, 0.7), 100, 'bouncy', 'leaf'),
  head('leaf', 'M0 -98A132 132 0 0 1 0 98A132 132 0 0 1 0 -98Z', eye(0, 2, 0.66), 98, 'slow', 'leaf'),
  head('house', 'M-9.56 -87.06A14 14 0 0 1 9.56 -87.06L88.19 -13.56A12 12 0 0 1 92 -4.79L92 74A16 16 0 0 1 76 90L-76 90A16 16 0 0 1 -92 74L-92 -4.79A12 12 0 0 1 -88.19 -13.56Z', eye(0, 16, 0.72), 90, 'neat', 'deepblue'),
  head('mushroom', 'M0 -88A98 98 0 0 1 98 10A10 10 0 0 1 88 20H46V74A18 18 0 0 1 28 92H-28A18 18 0 0 1 -46 74V20H-88A10 10 0 0 1 -98 10A98 98 0 0 1 0 -88Z', eye(0, -30, 0.6), 92, 'slow', 'tomato'),
  head('ghost', 'M0 -96A80 80 0 0 1 80 -16V72A26.67 26.67 0 0 1 26.67 72A26.67 26.67 0 0 1 -26.67 72A26.67 26.67 0 0 1 -80 72V-16A80 80 0 0 1 0 -96Z', eye(0, -14, 0.72), 98.67, 'bouncy', 'cream'),
  head('tulip', 'M-7.44 -87.06A9 9 0 0 1 7.44 -87.06L26.89 -58.46A12 12 0 0 0 44.07 -55.65L69.55 -75.02A9 9 0 0 1 84 -67.86L84 16A80 80 0 0 1 4 96L-4 96A80 80 0 0 1 -84 16L-84 -67.86A9 9 0 0 1 -69.55 -75.02L-44.07 -55.65A12 12 0 0 0 -26.89 -58.46Z', eye(0, 18, 0.7), 96, 'bouncy', 'bubblegum'),
  head('bell', 'M0 -96A56 56 0 0 1 56 -40V28A40 40 0 0 0 92 68A12 12 0 0 1 80 82H-80A12 12 0 0 1 -92 68A40 40 0 0 0 -56 28V-40A56 56 0 0 1 0 -96Z', eye(0, -10, 0.6), 82, 'neat', 'deepblue'),
  head('cat', 'M0 -58L21.83 -58A22 22 0 0 0 38.59 -65.75L55.66 -85.83A9 9 0 0 1 71.05 -82.85L87.95 -32.16A40 40 0 0 1 90 -19.51L90 30A62 62 0 0 1 28 92L-28 92A62 62 0 0 1 -90 30L-90 -19.51A40 40 0 0 1 -87.95 -32.16L-71.05 -82.85A9 9 0 0 1 -55.66 -85.83L-38.59 -65.75A22 22 0 0 0 -21.83 -58Z', eye(0, 14, 0.72), 92, 'quick', 'apricot'),
]);

export const ONE_WARM_COLORS: readonly OneWarmColorDescription[] = freeze([
  freeze({ id: 'deepblue', label: 'Deep blue', disc: '#2747d6', eye: '#fbfaf6', keyline: null }),
  freeze({ id: 'tomato', label: 'Tomato', disc: '#f2542d', eye: '#141b16', keyline: null }),
  freeze({ id: 'sunny', label: 'Sunny', disc: '#ffc928', eye: '#141b16', keyline: '#a87f00' }),
  freeze({ id: 'leaf', label: 'Leaf', disc: '#3fae4a', eye: '#141b16', keyline: null }),
  freeze({ id: 'cream', label: 'Cream', disc: '#fbefd5', eye: '#141b16', keyline: '#b9a175' }),
] as const);

/**
 * New never pairs on the first fourteen heads, for the warm colours only (their own never lists are unchanged):
 * a tomato star or drop and a sunny diamond read as warning signs.
 */
export const ONE_WARM_NEVER: Readonly<Record<string, readonly OneWarmColor[]>> = freeze({
  star: freeze(['tomato'] as OneWarmColor[]),
  droplet: freeze(['tomato'] as OneWarmColor[]),
  diamond: freeze(['sunny'] as OneWarmColor[]),
});
