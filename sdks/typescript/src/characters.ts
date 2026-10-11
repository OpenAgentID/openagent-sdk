/** OpenAgent character profile v1: deterministic bodies and shared live-v1 eyes. */
import { blake3 } from '@noble/hashes/blake3';
import { isAgentAvatarDid } from './avatar-did.js';
export { isAgentAvatarDid } from './avatar-did.js';

export type CharacterSkin = 'autos' | 'spacex';
export type CharacterEyeStyle = 'live-v1';
export type CharacterShape = 'standard' | 'slender' | 'wide' | 'circle' | 'pebble' |
  'squircle' | 'capsule' | 'triangle' | 'hexagon' | 'cloud' | 'droplet';
export type AvatarExpression = 'neutral' | 'attentive' | 'surprised' | 'excited' | 'happy' |
  'laughing' | 'angry' | 'sad' | 'scared' | 'suspicious' | 'confused' | 'curious' |
  'proud' | 'shy' | 'unimpressed' | 'sleepy';

export interface CharacterAppearance {
  readonly skin: CharacterSkin;
  readonly skinVersion?: 1;
  readonly eyeStyle?: CharacterEyeStyle;
  readonly shape?: CharacterShape;
}

export interface LiveEyeState {
  /** Zero is open; one is closed. Blink shrinks the bars' height, never width. */
  readonly blink?: number;
  /** Both eyes move together. Each normalized coordinate is from -1 to 1. */
  readonly gaze?: { readonly x: number; readonly y: number };
}

export interface CharacterOptions extends Omit<CharacterAppearance, 'skin'> {
  readonly skin?: CharacterSkin;
  readonly expression?: AvatarExpression;
  /** Square pixel dimensions, 32–2048. The geometry uses a fixed 512 viewBox. */
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
  readonly size: number;
  readonly animated: boolean;
  readonly state: {
    readonly blink: number;
    readonly gaze: { readonly x: number; readonly y: number };
  };
  readonly svg: string;
}

const encoder = new TextEncoder();
const eyeStyles: readonly CharacterEyeStyle[] = Object.freeze(['live-v1'] as const);
const autosShapes = Object.freeze(['standard', 'slender', 'wide'] as const);
const spaceShapes = Object.freeze(['circle', 'pebble', 'squircle', 'capsule', 'triangle', 'hexagon', 'cloud', 'droplet'] as const);
const expressions: readonly AvatarExpression[] = Object.freeze(['neutral', 'attentive', 'surprised', 'excited',
  'happy', 'laughing', 'angry', 'sad', 'scared', 'suspicious', 'confused', 'curious',
  'proud', 'shy', 'unimpressed', 'sleepy'] as const);
const catalog: readonly CharacterSkinDescription[] = Object.freeze([
  Object.freeze({ id: 'autos' as const, label: 'Autos', version: 1 as const, eyeStyles, shapes: autosShapes, expressions }),
  Object.freeze({ id: 'spacex' as const, label: 'SpaceX', version: 1 as const, eyeStyles, shapes: spaceShapes, expressions }),
]);
const palette = Object.freeze(['#757575', '#1687ff', '#ff6a00', '#161616', '#00c875', '#96663c', '#7656d6', '#e84770']);

/** Immutable versioned body/face skins. Eye expression is independent of skin. */
export function getCharacterSkins(): readonly CharacterSkinDescription[] {
  return catalog;
}

/** Shared expression IDs supported by both skins under the live-v1 eye contract. */
export function getCharacterExpressions(): readonly AvatarExpression[] {
  return expressions;
}

function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => !keys.includes(key))) {
    throw new TypeError(`Invalid character ${label}`);
  }
  return value as Record<string, unknown>;
}

function coordinate(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`Character ${label} must be finite and between ${min} and ${max}`);
  }
  return value === 0 ? 0 : value;
}

function normalizedOptions(options: CharacterOptions | undefined): {
  skin: CharacterSkin; shape?: CharacterShape; expression: AvatarExpression;
  size: number; animated: boolean; state: CharacterDescriptor['state'];
} {
  const value: Record<string, unknown> = options === undefined ? {} : record(options,
    ['skin', 'skinVersion', 'eyeStyle', 'shape', 'expression', 'size', 'animated', 'state'], 'options');
  const skin = value.skin === undefined ? 'autos' : value.skin;
  if (skin !== 'autos' && skin !== 'spacex') throw new TypeError('Unsupported character skin');
  if (value.skinVersion !== undefined && value.skinVersion !== 1) throw new TypeError('Unsupported character skin version');
  if (value.eyeStyle !== undefined && value.eyeStyle !== 'live-v1') throw new TypeError('Unsupported character eye style');
  const shapes: readonly CharacterShape[] = skin === 'autos' ? autosShapes : spaceShapes;
  if (value.shape !== undefined && !shapes.includes(value.shape as CharacterShape)) {
    throw new TypeError('Unsupported shape for character skin');
  }
  const expression = value.expression === undefined ? 'neutral' : value.expression;
  if (!expressions.includes(expression as AvatarExpression)) throw new TypeError('Unsupported avatar expression');
  const size = value.size === undefined ? 512 : value.size;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 32 || size > 2048) {
    throw new RangeError('Character size must be an integer from 32 to 2048');
  }
  const animated = value.animated === undefined ? true : value.animated;
  if (typeof animated !== 'boolean') throw new TypeError('Character animated must be boolean');
  const state: Record<string, unknown> = value.state === undefined ? {} : record(value.state, ['blink', 'gaze'], 'eye state');
  const blink = state.blink === undefined ? 0 : coordinate(state.blink, 0, 1, 'blink');
  let x = 0;
  let y = 0;
  if (state.gaze !== undefined) {
    const gaze = record(state.gaze, ['x', 'y'], 'gaze');
    x = coordinate(gaze.x, -1, 1, 'gaze x');
    y = coordinate(gaze.y, -1, 1, 'gaze y');
  }
  return { skin, shape: value.shape as CharacterShape | undefined, expression: expression as AvatarExpression, size, animated,
    state: Object.freeze({ blink, gaze: Object.freeze({ x, y }) }) };
}

/** Strict stored body/face selection; expression and live state belong elsewhere. */
export function parseCharacterAppearance(value: unknown): CharacterAppearance {
  const selection = record(value, ['skin', 'skinVersion', 'eyeStyle', 'shape'], 'appearance');
  if (!Object.hasOwn(selection, 'skin') || (selection.skin !== 'autos' && selection.skin !== 'spacex')) {
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

function body(skin: CharacterSkin, shape: CharacterShape, color: string): string {
  const attributes = `data-character-body="true" fill="${color}"`;
  if (skin === 'autos') {
    const variant = autosShapes.indexOf(shape as typeof autosShapes[number]);
    const dimensions = [[156, 64, 200, 384], [168, 48, 176, 416], [144, 80, 224, 352]][variant]!;
    const [x, y, width, height] = dimensions as [number, number, number, number];
    return `<rect ${attributes} x="${x}" y="${y}" width="${width}" height="${height}" rx="${width / 2}"/>`;
  }
  switch (shape) {
    case 'droplet':
      return `<path ${attributes} d="M256 84C227 84 208 112 185 142L135 205C104 244 94 273 94 306C94 388 163 438 256 438C349 438 418 388 418 306C418 273 408 244 377 205L327 142C304 112 285 84 256 84Z"/>`;
    case 'triangle':
      return `<path ${attributes} d="M256 88C278 88 293 108 307 134L410 332C436 383 411 408 372 408H140C101 408 76 383 102 332L205 134C219 108 234 88 256 88Z"/>`;
    case 'cloud':
      return `<path ${attributes} d="M256 134C214 86 141 103 128 165C73 181 75 264 127 289C105 352 153 412 217 399C255 445 326 418 334 369C398 359 430 293 394 244C433 193 394 118 331 126C309 104 278 108 256 134Z"/>`;
    case 'circle':
      return `<circle ${attributes} cx="256" cy="256" r="168"/>`;
    case 'capsule':
      return `<rect ${attributes} x="88" y="144" width="336" height="240" rx="120"/>`;
    case 'pebble':
      return `<ellipse ${attributes} cx="256" cy="264" rx="178" ry="148" transform="rotate(-10 256 264)"/>`;
    case 'squircle':
      return `<rect ${attributes} x="104" y="104" width="304" height="304" rx="88"/>`;
    case 'hexagon':
      return `<path ${attributes} d="M176 112H336Q353 112 363 129L430 245Q441 264 430 283L363 399Q353 416 336 416H176Q159 416 149 399L82 283Q71 264 82 245L149 129Q159 112 176 112Z"/>`;
    default:
      throw new RangeError('Unknown character body shape');
  }
}

type EyeGeometry = readonly [width: number, height: number, centerY: number, rotation: number];
const expressionEyes: Readonly<Record<AvatarExpression, readonly [EyeGeometry, EyeGeometry]>> = {
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
};

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
    result.push(`<animateTransform attributeName="transform" type="translate" values="${poses.map(([x, y]) => `${numeric(x!)} ${numeric(y!)}`).join(';')}" keyTimes="0;0.35;0.7;1" dur="${numeric(duration * 2)}s" begin="0s" repeatCount="indefinite"/>`);
  }
  for (const [index, side, centerX] of [[0, 'left', 222], [1, 'right', 290]] as const) {
    const [width, openHeight, centerY, rotation] = expressionEyes[expression][index];
    const height = openHeight - state.blink * (openHeight - 2);
    const y = centerY - height / 2;
    const transform = rotation === 0 ? '' : ` transform="rotate(${rotation} ${centerX} ${centerY})"`;
    result.push(`<rect data-character-eye="${side}" x="${numeric(centerX - width / 2)}" y="${numeric(y)}" width="${width}" height="${numeric(height)}" rx="${numeric(width / 2)}"${transform}>`);
    if (animated) {
      const common = `keyTimes="0;0.78;0.8;0.82;1" dur="${numeric(duration)}s" begin="0s" repeatCount="indefinite"`;
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
  const shapes: readonly CharacterShape[] = normalized.skin === 'autos' ? autosShapes : spaceShapes;
  const shape = normalized.shape ?? shapes[seed[0]! % shapes.length]!;
  const color = palette[seed[1]! % palette.length]!;
  const fingerprint = [...seed].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${normalized.size}" height="${normalized.size}" role="img" data-character-skin="${normalized.skin}" data-character-version="1" data-character-shape="${shape}" data-character-expression="${normalized.expression}" data-character-seed="${fingerprint}"><title>OpenAgent ${normalized.skin === 'autos' ? 'Autos' : 'SpaceX'} character</title>${body(normalized.skin, shape, color)}${eyes(normalized.expression, normalized.state, normalized.animated, seed)}</svg>`;
  return Object.freeze({ did, skin: normalized.skin, skinVersion: 1, eyeStyle: 'live-v1',
    shape, expression: normalized.expression, color, size: normalized.size, animated: normalized.animated,
    state: normalized.state, svg });
}

/** Render a character without retaining its descriptor. */
export function renderCharacterSvg(did: string, options?: CharacterOptions): string {
  return generateCharacter(did, options).svg;
}
