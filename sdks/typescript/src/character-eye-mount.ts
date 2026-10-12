import type { CharacterArtNode } from './character-art-types.js';
import type { CharacterHeadAnchor, CharacterGaze, AccessoryMotion } from './character-accessories.js';
import { characterMaterial, type CharacterFinish } from './character-material.js';

const n = (value: number): string => String(Number(value.toFixed(4)));
const node = (tag: string, attributes: Record<string, string>, children?: readonly CharacterArtNode[]): CharacterArtNode =>
  ({ tag, attributes, ...(children ? { children } : {}) });

export function raisedEyeStems(head: CharacterHeadAnchor, gaze: CharacterGaze): string {
  return [210, 302].map(x => `M${x} ${n(head.top + 25)}Q${x} ${n(head.top - 12)} ${n(x + gaze.x * 20)} ${n(286 + gaze.y * 14)}`).join('');
}

/** Eye pods are body geometry; the two live pill bars remain the only eye renderer. */
export function characterEyeMount(head: CharacterHeadAnchor, color: string, finish: CharacterFinish,
  instance: string, gaze: CharacterGaze, motion?: AccessoryMotion): CharacterArtNode {
  const timing: Record<string, string> = motion ? { keyTimes: '0;0.35;0.7;1', calcMode: 'spline',
    keySplines: '0.4 0 0.2 1;0.4 0 0.2 1;0.4 0 0.2 1', dur: `${n(motion.duration)}s`, begin: '0s', repeatCount: 'indefinite' } : {};
  const stems = node('path', { 'data-raised-eye-stems': 'true', d: raisedEyeStems(head, gaze), fill: 'none', stroke: color,
    'stroke-width': '19', 'stroke-linecap': 'round' }, motion ? [node('animate', { attributeName: 'd',
      values: motion.poses.map(p => raisedEyeStems(head, p)).join(';'), ...timing })] : undefined);
  const shells = characterMaterial(node('g', {}, [210, 302].map(cx => node('ellipse', {
    cx: String(cx), cy: '264', rx: '43', ry: '64', fill: color, stroke: '#ffffff', 'stroke-opacity': '.12', 'stroke-width': '1',
  }))), finish, `${instance}-eyes`);
  const sockets = [210, 302].map(cx => node('ellipse', { cx: String(cx), cy: '264', rx: '31', ry: '53', fill: '#17202c', 'fill-opacity': '.9' }));
  const animation = motion ? [node('animateTransform', { attributeName: 'transform', type: 'translate',
    values: motion.poses.map(p => `${n(p.x * 20)} ${n(p.y * 14)}`).join(';'), ...timing })] : [];
  return node('g', { 'data-character-eye-mount': 'raised' }, [stems,
    node('g', { 'data-raised-eye-pods': 'true', transform: `translate(${n(gaze.x * 20)} ${n(gaze.y * 14)})` }, [...animation, shells, ...sockets]),
  ]);
}
