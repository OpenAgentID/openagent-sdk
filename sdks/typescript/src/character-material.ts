/** One self-contained material for every package-owned silhouette. */
import type { CharacterArtNode } from './character-art-types.js';

export type CharacterFinish = 'plush' | 'flat';
const node = (tag: string, attributes: Record<string, string>, children?: readonly CharacterArtNode[]): CharacterArtNode =>
  ({ tag, attributes, ...(children ? { children } : {}) });

/** Static fibers and soft relief are applied to the body, never the animated eyes. */
export function characterMaterial(body: CharacterArtNode, finish: CharacterFinish, instance: string): CharacterArtNode {
  if (finish === 'flat') return body;
  const id = `plush-${instance}`;
  return node('g', { 'data-character-material': 'plush' }, [
    node('defs', {}, [node('filter', {
      id, x: '-4%', y: '-4%', width: '108%', height: '108%', 'color-interpolation-filters': 'sRGB',
    }, [
      node('feTurbulence', { type: 'fractalNoise', baseFrequency: '.72 .94', numOctaves: '3', seed: '23', result: 'fibers' }),
      node('feDiffuseLighting', { in: 'fibers', surfaceScale: '1.4', diffuseConstant: '1', 'lighting-color': '#ffffff', result: 'fiber-light' }, [
        node('feDistantLight', { azimuth: '225', elevation: '52' }),
      ]),
      node('feComposite', { in: 'fiber-light', in2: 'SourceGraphic', operator: 'in', result: 'fiber-mask' }),
      node('feBlend', { in: 'SourceGraphic', in2: 'fiber-mask', mode: 'multiply', result: 'fibrous' }),
      node('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: '24', result: 'volume-shape' }),
      node('feDiffuseLighting', { in: 'volume-shape', surfaceScale: '38', diffuseConstant: '1.15', 'lighting-color': '#ffffff', result: 'volume-light' }, [
        node('feDistantLight', { azimuth: '225', elevation: '58' }),
      ]),
      node('feComposite', { in: 'volume-light', in2: 'SourceAlpha', operator: 'in', result: 'volume-mask' }),
      node('feBlend', { in: 'fibrous', in2: 'volume-mask', mode: 'multiply', result: 'textured' }),
      node('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: '5', result: 'soft-shape' }),
      node('feSpecularLighting', { in: 'soft-shape', surfaceScale: '8', specularConstant: '.18', specularExponent: '9', 'lighting-color': '#ffffff', result: 'rim-light' }, [
        node('feDistantLight', { azimuth: '225', elevation: '48' }),
      ]),
      node('feComposite', { in: 'rim-light', in2: 'SourceAlpha', operator: 'in', result: 'rim-mask' }),
      node('feBlend', { in: 'textured', in2: 'rim-mask', mode: 'screen', result: 'plush' }),
      node('feComposite', { in: 'plush', in2: 'SourceAlpha', operator: 'in' }),
    ])]),
    node('g', { filter: `url(#${id})` }, [body]),
  ]);
}
