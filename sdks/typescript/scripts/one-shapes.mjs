/**
 * Generates src/character-one-shapes.ts from the pinned Ones' shape library and agent palette in
 * test/fixtures/ones-shapes (see PROVENANCE.md there). Run from sdks/typescript:
 *
 *   node scripts/one-shapes.mjs
 *
 * The module carries data only: the fourteen shapes in library order, Digital One's circle, the
 * eighteen colours in team order and the team shape order. Geometry values are copied; path encoding is lossless.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const fixtures = new URL('test/fixtures/ones-shapes/', root);
const SHAPES_SHA256 = '894f801c251f54c113adc2c4b7be9dc3bd5574f536897653330456475a8c1767';
const PALETTE_SHA256 = '76fa20166a4d4ed22021b49e418dd4d8cf8a8c2c30c1b0daa7f4e49eae76c991';

function pinned(name, sha256) {
  const bytes = readFileSync(new URL(name, fixtures));
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== sha256) throw new Error(`${name} sha256 ${actual} is not the pinned ${sha256}`);
  return JSON.parse(bytes.toString('utf8'));
}

const shapes = pinned('shapes.json', SHAPES_SHA256);
const palette = pinned('palette.json', PALETTE_SHA256);
if (shapes.schema !== 'life/ones-shapes/v2') throw new Error(`Unexpected shapes schema ${shapes.schema}`);
if (palette.schema !== 'life/ones-agent-palette/v1') throw new Error(`Unexpected palette schema ${palette.schema}`);
if (shapes.shapes.length !== 14) throw new Error(`Expected 14 shapes, found ${shapes.shapes.length}`);
if (palette.colours.length !== 18) throw new Error(`Expected 18 colours, found ${palette.colours.length}`);
if (palette.order.join() !== palette.colours.map(colour => colour.id).join()) throw new Error('Palette order and colours disagree');

/**
 * The team shape order (the plan of record, §5.3): each shape has the largest worst-case 16 px difference
 * from Digital One and from every earlier shape, ties by library rank. Derived from the library's own
 * raster method; recorded here because shapes.json does not carry it.
 */
const TEAM_SHAPE_ORDER = ['droplet', 'cloud', 'heart', 'diamond', 'star', 'bean', 'blob', 'peanut', 'egg', 'gumdrop', 'clover', 'hexagon', 'squircle', 'flower'];
const libraryIds = shapes.shapes.map(shape => shape.id);
if ([...TEAM_SHAPE_ORDER].sort().join() !== [...libraryIds].sort().join()) throw new Error('The team shape order is not a permutation of the library');

const quote = value => `'${value}'`;
const union = values => values.map(quote).join(' | ');
const num = value => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Expected a finite number, found ${value}`);
  return String(value);
};
const hex = value => {
  if (!/^#[0-9a-f]{6}$/.test(value)) throw new Error(`Expected a lowercase hex colour, found ${value}`);
  return quote(value);
};
const path = value => {
  if (!/^M[-0-9. AHVLZ]+Z$/.test(value)) throw new Error(`Unexpected path syntax: ${value}`);
  return quote(value);
};
const title = id => id[0].toUpperCase() + id.slice(1);
const eye = value => {
  const args = [value.x, value.y, value.openScale, value.lookGain, value.openMax, value.mouthMax, value.scale, value.liftGain];
  const defaults = [undefined, undefined, 1, 1, 1.35, 1, 0.8, 1];
  while (args.length > 2 && args.at(-1) === defaults[args.length - 1]) args.pop();
  return `makeEye(${args.map(num).join(', ')})`;
};
const point = value => `{ x: ${num(value.x)}, y: ${num(value.y)} }`;
const colourIds = palette.order;
const temperaments = new Set(['quick', 'bouncy', 'neat', 'slow']);

const shapeLines = shapes.shapes.map((shape, index) => {
  if (!temperaments.has(shape.temperament)) throw new Error(`${shape.id}: unexpected temperament ${shape.temperament}`);
  if (!colourIds.includes(shape.colour)) throw new Error(`${shape.id}: unknown default colour ${shape.colour}`);
  for (const never of shape.never) if (!colourIds.includes(never)) throw new Error(`${shape.id}: unknown never colour ${never}`);
  if (shape.never.includes(shape.colour)) throw new Error(`${shape.id}: its default colour is on its never list`);
  path(shape.d);
  return `  shape(${quote(shape.id)}, catalogPath(ONE_PATHS[${index}]!), ${eye(shape.eye)}, ${num(shape.mouthDy)}, ${point(shape.pivot)}, ${quote(shape.temperament)}, ${quote(shape.colour)}, [${shape.never.map(quote).join(', ')}]${shape.label === title(shape.id) ? '' : ', ' + quote(shape.label)}),`;
});
const colourLines = palette.colours.map(colour => {
  const keyline = colour.keyline === null ? 'null' : hex(colour.keyline);
  return `  colour(${quote(colour.id)}, ${hex(colour.hex)}, ${hex(colour.eyeHex)}, ${keyline}${colour.label === title(colour.id) ? '' : ', ' + quote(colour.label)}),`;
});
const one = shapes.digitalOne;
const digital = palette.digitalOne;
if (one.id !== 'circle' || one.temperament !== 'dry') throw new Error('Digital One is not the dry circle');
if (digital.disc !== '#141b16' || digital.rim.surfaces !== 'dark only' || digital.rim.widthPx !== 1) throw new Error('Digital One\'s palette values are not the plan\'s');

// The live renderer accepts only this pinned catalog. Record command arities
// at generation time so it need not ship the general path grammar/validator.
function commands(path) {
  let start, current, closed = false;
  const out = [], data = [];
  for (const match of path.matchAll(/([MLHVAZ])([^MLHVAZ]*)/g)) {
    const command = match[1], values = (match[2].match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? []).map(Number);
    const arity = { M: 2, L: 2, H: 1, V: 1, A: 7, Z: 0 }[command];
    if (closed || values.length !== arity || values.some(value => !Number.isFinite(value))) throw new Error('Invalid catalog path');
    if (command === 'M') { if (start) throw new Error('Multiple catalog subpaths'); start = current = values; out.push(command); data.push(...values); continue; }
    if (!current) throw new Error('Catalog path needs M');
    if (command === 'Z') { closed = true; out.push(command); continue; }
    if (command === 'A' && (values[0] !== values[1] || values[0] <= 0 || values[2] !== 0 || ![0, 1].includes(values[3]) || ![0, 1].includes(values[4]))) throw new Error('Catalog arcs must be circular');
    current = command === 'A' ? values.slice(5) : command === 'L' ? values : command === 'H' ? [values[0], current[1]] : [current[0], values[0]];
    out.push(command);
    data.push(...(command === 'A' ? [values[0], ...values.slice(3)] : values));
  }
  if (!closed || !start || Math.hypot(current[0] - start[0], current[1] - start[1]) > 1e-9) throw new Error('Catalog path must end at its start');
  let rebuilt = '', offset = 0;
  for (const cmd of out) {
    if (cmd === 'A') { const r = data[offset++]; rebuilt += `A${r} ${r} 0 ${data[offset++]} ${data[offset++]} ${data[offset++]} ${data[offset++]}`; }
    else if (cmd === 'Z') rebuilt += 'Z';
    else { rebuilt += cmd + data[offset++]; if (cmd === 'M' || cmd === 'L') rebuilt += ' ' + data[offset++]; }
  }
  if (rebuilt !== path) throw new Error('Catalog path encoding changed SVG bytes');
  const packed = data.map(value => {
    const integer = Math.round(value * 100);
    if (!Number.isSafeInteger(integer) || !Object.is(integer / 100, value)) throw new Error('Catalog fixed-point encoding changed a value');
    return integer;
  });
  return `[${quote(out.join(''))}, coordinates([${packed.map(num).join(',')}])]`;
}
const pathSpecs = [...shapes.shapes.map(shape => commands(shape.d)), commands(one.d)];

const source = `/**
 * The One family's shape library and agent palette, generated by scripts/one-shapes.mjs from the pinned
 * library files in test/fixtures/ones-shapes (shapes.json sha256 ${SHAPES_SHA256.slice(0, 8)}…${SHAPES_SHA256.slice(-4)},
 * palette.json sha256 ${PALETTE_SHA256.slice(0, 8)}…${PALETTE_SHA256.slice(-4)}). Never edit by hand.
 *
 * Paths are in agent-eye's head box (viewBox -100 -100 200 200): one closed subpath of M, H, V, L, A and Z
 * that starts at 12 o'clock on the eye's axis and runs clockwise, drawn as a belt of true circular arcs and
 * straight tangents. Digital One is always the black circle; no agent is a circle and no agent is black.
 */

/** The fourteen agent shapes, in library order. */
export type OneShape = ${union(libraryIds)};
/** The eighteen agent colours, in team order. */
export type OneColor = ${union(colourIds)};
/** A temperament paces a One's moves; it comes from the shape (Digital One is dry) and is never shown as a name. */
export type OneTemperament = 'quick' | 'bouncy' | 'neat' | 'slow' | 'dry';

/** Where agent-eye's 200-unit eye box sits in a shape, and how far the eye may turn there. */
export interface OneShapeEye {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  /** The bar's open length in this shape, 0.7–1 of the mark. */
  readonly openScale: number;
  /** Look gain, at least 0.5. */
  readonly lookGain: number;
  readonly liftGain: number;
  /** The cap on how far the eye opens. */
  readonly openMax: number;
  /** The cap on the smile line's width, at least 0.6. */
  readonly mouthMax: number;
}

/** The drawn geometry every One shares: a path, an eye placement, a mouth offset and a pivot. */
export interface OneShapeGeometry {
  readonly path: string;
  readonly eye: OneShapeEye;
  /** The mouth line's lift in eye-box units, so a shorter bar keeps the mark's smile gap. */
  readonly mouthDy: number;
  /** The foot: where the body squashes and bounces. */
  readonly pivot: { readonly x: number; readonly y: number };
}

export interface OneShapeDescription extends OneShapeGeometry {
  readonly id: OneShape;
  /** Shape name for a picker. Never use it as an agent's name. */
  readonly label: string;
  readonly temperament: OneTemperament;
  /** The shape's own colour: the site draws it in this, and a team's first agent of this shape wears it. */
  readonly color: OneColor;
  /** Colours that would turn the shape into a sign or a symbol. A never pair is refused everywhere. */
  readonly never: readonly OneColor[];
}

export interface OneColorDescription {
  readonly id: OneColor;
  /** Colour name for a picker. Never use it as an agent's name. */
  readonly label: string;
  /** One value on every surface: there are no dark tones. */
  readonly disc: string;
  /** The line's colour, from the disc and never from the surface: paper on deep colours, ink on bright ones. */
  readonly eye: string;
  /** A ring in the colour's own hue, 1 CSS px inside the edge on light surfaces only, where the disc alone falls under 3:1. */
  readonly keyline: string | null;
}

import { freeze } from './character-intrinsics.js';
const title = (id: string): string => id[0]!.toUpperCase() + id.slice(1);
const makeEye = (x: number, y: number, openScale = 1, lookGain = 1, openMax = 1.35, mouthMax = 1, scale = 0.8, liftGain = 1): OneShapeEye =>
  ({ x, y, scale, openScale, lookGain, liftGain, openMax, mouthMax });
const shape = (id: OneShape, path: string, eye: OneShapeEye, mouthDy: number, pivot: { x: number; y: number },
  temperament: OneTemperament, color: OneColor, never: readonly OneColor[], label = title(id)): OneShapeDescription =>
  freeze({ id, label, path, eye: freeze(eye), mouthDy, pivot: freeze(pivot), temperament, color, never: freeze(never) });
const colour = (id: OneColor, disc: string, eye: string, keyline: string | null, label = title(id)): OneColorDescription =>
  freeze({ id, label, disc, eye, keyline });

const coordinates = (values: number[]): readonly number[] => freeze(values.map(value => value / 100));

/** Lossless fixed-point command/value skeletons in library order, followed by Digital One. */
export const ONE_PATHS: readonly (readonly [string, readonly number[]])[] = freeze([
  ${pathSpecs.join(',\n  ')}
]);

function catalogPath([commands, values]: readonly [string, readonly number[]]): string {
  let path = '', offset = 0;
  for (const command of commands) {
    if (command === 'A') {
      const radius = values[offset++];
      path += \`A\${radius} \${radius} 0 \${values[offset++]} \${values[offset++]} \${values[offset++]} \${values[offset++]}\`;
    } else if (command === 'Z') path += 'Z';
    else {
      path += command + values[offset++];
      if (command === 'M' || command === 'L') path += ' ' + values[offset++];
    }
  }
  return path;
}

/** The fourteen shapes in library order. */
export const ONE_SHAPES: readonly OneShapeDescription[] = freeze([
${shapeLines.join('\n')}
]);

/** Digital One's circle: the logo's disc, eye at the centre at full scale, standing on its base. */
export const ONE_CIRCLE: OneShapeGeometry = freeze({
  path: catalogPath(ONE_PATHS[14]!),
  eye: freeze(${eye(one.eye)}),
  mouthDy: ${num(one.mouthDy)},
  pivot: freeze(${point(one.pivot)}),
});

/** The eighteen colours in team order: the first five, eight and twelve are the most distinct under every colour vision. */
export const ONE_COLORS: readonly OneColorDescription[] = freeze([
${colourLines.join('\n')}
]);

/**
 * The team shape order: the first-free assignment hands shapes out in it. Each shape has the largest worst-case
 * difference at 16 px from Digital One and from every earlier shape; ties go to library rank.
 */
export const ONE_SHAPE_ORDER: readonly OneShape[] = freeze([${TEAM_SHAPE_ORDER.map(quote).join(', ')}]);

/** Digital One on every surface: the black disc; the eye cut out to the surface on light, chalk on dark, with a chalk rim. */
export const ONE_DIGITAL = freeze({
  disc: ${hex(digital.disc)},
  /** Null on light surfaces, where the eye is cut out of the disc with the even-odd rule. */
  eye: freeze({ light: null, dark: ${hex(digital.eye.dark)} }),
  /** Dark surfaces only: 1 CSS px inside the edge, 2 from 96 px, never reduced to one device pixel. */
  rim: freeze({ color: ${hex(digital.rim.colour)}, opacity: ${num(digital.rim.opacity)}, flat: ${hex(digital.rimHex)} }),
});
`;

writeFileSync(new URL('src/character-one-shapes.ts', root), source);
console.log(`wrote src/character-one-shapes.ts: ${shapes.shapes.length} shapes, ${palette.colours.length} colours`);
