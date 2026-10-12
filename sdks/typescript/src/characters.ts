/** OpenAgent character profile v1: deterministic bodies and shared live-v1 eyes. */
import { characterBody, characterFraming, characterArt, serializeCharacterBody } from './character-body.js';
import { blake3 } from '@noble/hashes/blake3';
import { isAgentAvatarDid } from './avatar-did.js';
export { isAgentAvatarDid } from './avatar-did.js';
import { CHARACTER_EXPRESSIONS, parseCharacterState, type AvatarExpression, type LiveEyeState } from './character-state.js';
export { getCharacterExpressions, getCharacterStatuses, parseCharacterState, expressionForStatus } from './character-state.js';
export type { AvatarExpression, AvatarStatus, AgentActivity, LiveEyeState, CharacterRuntimeState, CharacterStateUpdate } from './character-state.js';

export type CharacterSkin = 'autos' | 'spacex' | 'fold' | 'sprig' | 'ripple' | 'halo' |
  'purl' | 'prism' | 'coil' | 'kiln' | 'wisp' | 'relay' | 'cairn' | 'tuft' |
  'halloween' | 'thanksgiving' | 'christmas';
export type CharacterView = 'avatar' | 'full';
export type CharacterEyeStyle = 'live-v1';
export type CharacterShape = 'standard' | 'slender' | 'wide' | 'circle' | 'pebble' |
  'squircle' | 'capsule' | 'triangle' | 'hexagon' | 'cloud' | 'droplet' |
  'kite' | 'fan' | 'bud' | 'leaf' | 'drop' | 'wave' | 'comet' | 'satellite' |
  'mitt' | 'hood' | 'crystal' | 'obelisk' | 'spring' | 'bellows' | 'vase' | 'teapot' |
  'flame' | 'curl' | 'radio' | 'beacon' | 'tower' | 'arch' | 'pom' | 'bear' |
  'pumpkin' | 'ghost' | 'bat' | 'witch-hat' | 'candy-corn' |
  'turkey' | 'acorn' | 'squash' | 'pie' | 'corn' | 'light' | 'tree' | 'snowman' | 'ornament' | 'gift';

export interface CharacterAppearance {
  readonly skin: CharacterSkin;
  readonly skinVersion?: 1;
  readonly eyeStyle?: CharacterEyeStyle;
  readonly shape?: CharacterShape;
}

export interface CharacterOptions extends Omit<CharacterAppearance, 'skin'> {
  readonly skin?: CharacterSkin;
  readonly expression?: AvatarExpression;
  /** Face crop by default; full includes the complete character for illustrations. */
  readonly view?: CharacterView;
  /** Square pixel dimensions, 32–2048; framing is independent of output size. */
  readonly size?: number;
  /** Set false for a static runtime-controlled pose or reduced-motion display. */
  readonly animated?: boolean;
  readonly state?: LiveEyeState;
}

export interface CharacterSkinDescription {
  readonly id: CharacterSkin;
  readonly label: string;
  readonly version: 1;
  readonly eyeStyles: readonly CharacterEyeStyle[];
  readonly shapes: readonly CharacterShape[];
  readonly expressions: readonly AvatarExpression[];
}

export interface CharacterDescriptor {
  readonly did: string;
  readonly skin: CharacterSkin;
  readonly skinVersion: 1;
  readonly eyeStyle: CharacterEyeStyle;
  readonly shape: CharacterShape;
  readonly expression: AvatarExpression;
  readonly color: string;
  readonly view: CharacterView;
  readonly size: number;
  readonly animated: boolean;
  readonly state: {
    readonly status?: import('./character-state.js').AvatarStatus;
    readonly expression?: AvatarExpression;
    readonly blink: number;
    readonly gaze: { readonly x: number; readonly y: number };
  };
  readonly svg: string;
}

const encoder = new TextEncoder();
const eyeStyles: readonly CharacterEyeStyle[] = Object.freeze(['live-v1'] as const);
const autosShapes = Object.freeze(['standard', 'slender', 'wide'] as const);
const spaceShapes = Object.freeze(['circle', 'pebble', 'squircle', 'capsule', 'triangle', 'hexagon', 'cloud', 'droplet'] as const);
const expressions = CHARACTER_EXPRESSIONS;
const catalog: readonly CharacterSkinDescription[] = Object.freeze([
  Object.freeze({ id: 'autos' as const, label: 'Autos', version: 1 as const, eyeStyles, shapes: autosShapes, expressions }),
  Object.freeze({ id: 'spacex' as const, label: 'SpaceX', version: 1 as const, eyeStyles, shapes: spaceShapes, expressions }),
  ...Object.entries(characterArt).map(([id, family]) => Object.freeze({ id: id as CharacterSkin,
    label: family.label, version: 1 as const, eyeStyles,
    shapes: Object.freeze(Object.keys(family.shapes) as CharacterShape[]), expressions })),
]);
const palette = Object.freeze(['#757575', '#1687ff', '#ff6a00', '#161616', '#00c875', '#96663c', '#7656d6', '#e84770']);

/** Immutable versioned body/face skins. Eye expression is independent of skin. */
export function getCharacterSkins(): readonly CharacterSkinDescription[] {
  return catalog;
}


function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => !keys.includes(key))) {
    throw new TypeError(`Invalid character ${label}`);
  }
  return value as Record<string, unknown>;
}

function normalizedOptions(options: CharacterOptions | undefined): {
  skin: CharacterSkin; shape?: CharacterShape; expression: AvatarExpression;
  view: CharacterView; size: number; animated: boolean; state: CharacterDescriptor['state'];
} {
  const value: Record<string, unknown> = options === undefined ? {} : record(options,
    ['skin', 'skinVersion', 'eyeStyle', 'shape', 'view', 'expression', 'size', 'animated', 'state'], 'options');
  const selection = catalog.find(entry => entry.id === (value.skin === undefined ? 'autos' : value.skin));
  if (!selection) throw new TypeError('Unsupported character skin');
  const skin = selection.id;
  if (value.skinVersion !== undefined && value.skinVersion !== 1) throw new TypeError('Unsupported character skin version');
  if (value.eyeStyle !== undefined && value.eyeStyle !== 'live-v1') throw new TypeError('Unsupported character eye style');
  const shapes = selection.shapes;
  if (value.shape !== undefined && !shapes.includes(value.shape as CharacterShape)) {
    throw new TypeError('Unsupported shape for character skin');
  }
  const view = value.view === undefined ? 'avatar' : value.view;
  if (view !== 'avatar' && view !== 'full') throw new TypeError('Unsupported character view');
  const expression = value.expression === undefined ? 'neutral' : value.expression;
  if (!expressions.includes(expression as AvatarExpression)) throw new TypeError('Unsupported avatar expression');
  const size = value.size === undefined ? 512 : value.size;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 32 || size > 2048) {
    throw new RangeError('Character size must be an integer from 32 to 2048');
  }
  const animated = value.animated === undefined ? true : value.animated;
  if (typeof animated !== 'boolean') throw new TypeError('Character animated must be boolean');
  const input = value.state === undefined ? {} : value.state;
  const resolved = parseCharacterState(input, expression as AvatarExpression);
  const supplied = input as Record<string, unknown>;
  return { skin, view, shape: value.shape as CharacterShape | undefined, expression: resolved.expression, size, animated,
    state: Object.freeze({ blink: resolved.blink, gaze: resolved.gaze,
      ...(supplied.status === undefined ? {} : { status: resolved.status }),
      ...(supplied.expression === undefined ? {} : { expression: resolved.expression }) }) };
}

/** Strict stored body/face selection; expression and live state belong elsewhere. */
export function parseCharacterAppearance(value: unknown): CharacterAppearance {
  const selection = record(value, ['skin', 'skinVersion', 'eyeStyle', 'shape'], 'appearance');
  if (!Object.hasOwn(selection, 'skin') || !catalog.some(entry => entry.id === selection.skin)) {
    throw new TypeError('Character appearance requires a supported skin');
  }
  const normalized = normalizedOptions({ skin: selection.skin,
    skinVersion: selection.skinVersion, eyeStyle: selection.eyeStyle,
    shape: selection.shape } as CharacterOptions);
  return Object.freeze({ skin: normalized.skin,
    ...(selection.skinVersion === undefined ? {} : { skinVersion: 1 as const }),
    ...(selection.eyeStyle === undefined ? {} : { eyeStyle: 'live-v1' as const }),
    ...(normalized.shape === undefined ? {} : { shape: normalized.shape }) });
}

function numeric(value: number): string {
  return Number(value.toFixed(3)).toString();
}

export type EyeGeometry = readonly [width: number, height: number, centerY: number, rotation: number];
export const expressionEyes: Readonly<Record<AvatarExpression, readonly [EyeGeometry, EyeGeometry]>> = {
  neutral: [[28, 72, 264, 0], [28, 72, 264, 0]],
  attentive: [[26, 80, 256, -3], [26, 80, 256, 3]],
  surprised: [[40, 56, 264, 0], [40, 56, 264, 0]],
  excited: [[36, 78, 272, -8], [36, 78, 272, 8]],
  happy: [[30, 16, 248, 8], [30, 16, 248, -8]],
  laughing: [[44, 14, 248, 12], [44, 14, 248, -12]],
  angry: [[38, 28, 256, 24], [38, 28, 256, -24]],
  sad: [[24, 40, 282, -22], [24, 40, 282, 22]],
  scared: [[34, 84, 280, 0], [34, 84, 280, 0]],
  suspicious: [[25, 56, 250, -8], [25, 18, 256, -8]],
  confused: [[24, 72, 256, -8], [32, 20, 264, 24]],
  curious: [[28, 66, 272, -18], [24, 48, 252, -18]],
  proud: [[32, 14, 246, 10], [32, 14, 246, -10]],
  shy: [[20, 38, 282, -8], [20, 38, 282, -8]],
  unimpressed: [[32, 10, 256, 0], [32, 10, 256, 0]],
  sleepy: [[22, 20, 280, 0], [22, 20, 280, 0]],
  thoughtful: [[26, 60, 257, -9], [24, 43, 250, -9]],
  concerned: [[26, 58, 270, -12], [26, 58, 270, 12]],
};

for (const pair of Object.values(expressionEyes)) {
  for (const geometry of pair) Object.freeze(geometry);
  Object.freeze(pair);
}
Object.freeze(expressionEyes);

function eyes(expression: AvatarExpression, state: CharacterDescriptor['state'], animated: boolean, seed: Uint8Array): string {
  const gazeX = state.gaze.x * 20;
  const gazeY = state.gaze.y * 14;
  const duration = 4 + seed[2]! / 255 * 2;
  const result = [`<g data-character-eyes="live-v1" transform="translate(${numeric(gazeX)} ${numeric(gazeY)})" fill="#ffffff">`];
  if (animated) {
    // Residual movement keeps even an explicit extreme pose inside the face.
    const dx = (1 - Math.abs(state.gaze.x)) * 8;
    const dy = (1 - Math.abs(state.gaze.y)) * 5;
    const poses = [[gazeX, gazeY], [gazeX + dx, gazeY - dy], [gazeX - dx, gazeY + dy], [gazeX, gazeY]];
    result.push(`<animateTransform attributeName="transform" type="translate" values="${poses.map(([x, y]) => `${numeric(x!)} ${numeric(y!)}`).join(';')}" keyTimes="0;0.35;0.7;1" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1;0.4 0 0.2 1" dur="${numeric(duration * 2)}s" begin="0s" repeatCount="indefinite"/>`);
  }
  for (const [index, side, centerX] of [[0, 'left', 222], [1, 'right', 290]] as const) {
    const [width, openHeight, centerY, rotation] = expressionEyes[expression][index];
    const height = openHeight - state.blink * (openHeight - 2);
    const y = centerY - height / 2;
    const transform = rotation === 0 ? '' : ` transform="rotate(${rotation} ${centerX} ${centerY})"`;
    result.push(`<rect data-character-eye="${side}" x="${numeric(centerX - width / 2)}" y="${numeric(y)}" width="${width}" height="${numeric(height)}" rx="${numeric(width / 2)}"${transform}>`);
    if (animated) {
      const common = `keyTimes="0;0.78;0.8;0.84;1" calcMode="spline" keySplines="0 0 1 1;0.4 0 1 1;0 0 0.2 1;0 0 1 1" dur="${numeric(duration)}s" begin="0s" repeatCount="indefinite"`;
      result.push(`<animate attributeName="height" values="${numeric(height)};${numeric(height)};2;${numeric(height)};${numeric(height)}" ${common}/>`);
      result.push(`<animate attributeName="y" values="${numeric(y)};${numeric(y)};${numeric(centerY - 1)};${numeric(y)};${numeric(y)}" ${common}/>`);
    }
    result.push('</rect>');
  }
  return result.join('') + '</g>';
}

/** Self-contained SVG character. Public DID-derived pixels are not identity proof. */
export function generateCharacter(did: string, options?: CharacterOptions): CharacterDescriptor {
  if (!isAgentAvatarDid(did)) {
    throw new TypeError('Characters require an agent or agent instance DID');
  }
  const normalized = normalizedOptions(options);
  // Literal legacy/current identifiers are deliberately distinct. Never rewrite them.
  const seed = blake3(encoder.encode(`oaid-character-v1\u0000${normalized.skin}\u0000${did}`));
  const family = catalog.find(entry => entry.id === normalized.skin)!;
  const shapes = family.shapes;
  const shape = normalized.shape ?? shapes[seed[0]! % shapes.length]!;
  const color = characterArt[normalized.skin]?.shapes[shape]?.color ?? characterArt[normalized.skin]?.color ?? palette[seed[1]! % palette.length]!;
  const fingerprint = [...seed].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const framing = characterFraming(normalized.skin, shape, normalized.view);
  const geometry = characterBody(normalized.skin, shape, color, `oaid-${fingerprint.slice(0, 16)}-${shape}`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${framing.viewBox}" width="${normalized.size}" height="${normalized.size}" role="img" data-character-skin="${normalized.skin}" data-character-version="1" data-character-shape="${shape}" data-character-view="${normalized.view}" data-character-expression="${normalized.expression}" data-character-seed="${fingerprint}"><title>OpenAgent ${family.label} character</title>${serializeCharacterBody(geometry)}<g data-character-face="true" transform="${framing.faceTransform}">${eyes(normalized.expression, normalized.state, normalized.animated, seed)}</g></svg>`;
  return Object.freeze({ did, skin: normalized.skin, skinVersion: 1, eyeStyle: 'live-v1',
    shape, expression: normalized.expression, color, view: normalized.view, size: normalized.size, animated: normalized.animated,
    state: normalized.state, svg });
}

/** Render a character without retaining its descriptor. */
export function renderCharacterSvg(did: string, options?: CharacterOptions): string {
  return generateCharacter(did, options).svg;
}
