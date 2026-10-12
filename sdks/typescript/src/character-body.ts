/** Closed, validated character geometry shared by text and DOM renderers. */
import type { CharacterSkin, CharacterShape, CharacterView } from './characters.js';
import type { CharacterArtNode, CharacterArtFamily } from './character-art-types.js';
import { yearRoundArt } from './character-art-year-round.js';
import { seasonalArt } from './character-art-seasonal.js';
export const characterArt: Readonly<Record<string, CharacterArtFamily>> = { ...yearRoundArt, ...seasonalArt };
const number = (value: number): string => String(Number(value.toFixed(4)));
const escape = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Nodes come exclusively from the package-owned art registry. */
export function serializeCharacterBody(node: CharacterArtNode): string {
  const attributes = Object.entries(node.attributes).map(([key, value]) => `${key}="${escape(value)}"`).join(' ');
  return node.children?.length
    ? `<${node.tag} ${attributes}>${node.children.map(serializeCharacterBody).join('')}</${node.tag}>`
    : `<${node.tag} ${attributes}/>`;
}
function instanceNode(node: CharacterArtNode, instance: string): CharacterArtNode {
  return { tag: node.tag,
    attributes: Object.fromEntries(Object.entries(node.attributes).map(([key, value]) => [key, value.replaceAll('__INSTANCE__', instance)])),
    ...(node.children ? { children: node.children.map(child => instanceNode(child, instance)) } : {}) };
}

/** One geometry contract for SVG, browser player, and profile fallbacks. */
export function characterFraming(skin: CharacterSkin, shape: CharacterShape, view: CharacterView): { viewBox: string; faceTransform: string } {
  const art = characterArt[skin]?.shapes[shape];
  let x = 256, y = 264, scale = 1;
  let crop = { x: 96, y: 104, size: 320 };
  if (art) {
    x = 64 + art.face.x * 1.2; y = 16 + art.face.y * 1.2; scale = art.face.scale * 1.2;
    crop = { x: 64 + art.crop.x * 1.2, y: 16 + art.crop.y * 1.2, size: art.crop.size * 1.2 };
  } else if (skin === 'autos') {
    const face = shape === 'slender' ? [152, .75, 216] : shape === 'wide' ? [190, .95, 264] : [168, .85, 240];
    y = face[0]!; scale = face[1]!;
    crop = { x: x - face[2]! / 2, y: y - face[2]! / 2, size: face[2]! };
  }
  return { viewBox: view === 'full' ? '0 0 512 512' : [crop.x, crop.y, crop.size, crop.size].map(number).join(' '),
    faceTransform: `translate(${number(x)} ${number(y)}) scale(${number(scale)}) translate(-256 -264)` };
}

const autosShapes = ['standard', 'slender', 'wide'] as const;
export function characterBody(skin: CharacterSkin, shape: CharacterShape, color: string, instance = 'oaid'): CharacterArtNode {
  const art = characterArt[skin]?.shapes[shape];
  if (art) return { tag: 'g', attributes: { 'data-character-body': 'true', transform: 'translate(64 16) scale(1.2)' }, children: [instanceNode(art.body, instance)] };
  const attributes = { 'data-character-body': 'true', fill: color };
  if (skin === 'autos') {
    const variant = autosShapes.indexOf(shape as typeof autosShapes[number]);
    const dimensions = [[156, 64, 200, 384], [168, 48, 176, 416], [144, 80, 224, 352]][variant]!;
    const [x, y, width, height] = dimensions as [number, number, number, number];
    return { tag: 'rect', attributes: { ...attributes, 'x': `${x}`, 'y': `${y}`, 'width': `${width}`, 'height': `${height}`, 'rx': `${width / 2}` } };
  }
  switch (shape) {
    case 'droplet':
      return { tag: 'path', attributes: { ...attributes, 'd': `M256 84C227 84 208 112 185 142L135 205C104 244 94 273 94 306C94 388 163 438 256 438C349 438 418 388 418 306C418 273 408 244 377 205L327 142C304 112 285 84 256 84Z` } };
    case 'triangle':
      return { tag: 'path', attributes: { ...attributes, 'd': `M256 88C278 88 293 108 307 134L410 332C436 383 411 408 372 408H140C101 408 76 383 102 332L205 134C219 108 234 88 256 88Z` } };
    case 'cloud':
      return { tag: 'path', attributes: { ...attributes, 'd': `M256 134C214 86 141 103 128 165C73 181 75 264 127 289C105 352 153 412 217 399C255 445 326 418 334 369C398 359 430 293 394 244C433 193 394 118 331 126C309 104 278 108 256 134Z` } };
    case 'circle':
      return { tag: 'circle', attributes: { ...attributes, 'cx': `256`, 'cy': `256`, 'r': `168` } };
    case 'capsule':
      return { tag: 'rect', attributes: { ...attributes, 'x': `88`, 'y': `144`, 'width': `336`, 'height': `240`, 'rx': `120` } };
    case 'pebble':
      return { tag: 'ellipse', attributes: { ...attributes, 'cx': `256`, 'cy': `264`, 'rx': `178`, 'ry': `148`, 'transform': `rotate(-10 256 264)` } };
    case 'squircle':
      return { tag: 'rect', attributes: { ...attributes, 'x': `104`, 'y': `104`, 'width': `304`, 'height': `304`, 'rx': `88` } };
    case 'hexagon':
      return { tag: 'path', attributes: { ...attributes, 'd': `M176 112H336Q353 112 363 129L430 245Q441 264 430 283L363 399Q353 416 336 416H176Q159 416 149 399L82 283Q71 264 82 245L149 129Q159 112 176 112Z` } };
    default:
      throw new RangeError('Unknown character body shape');
  }
}

