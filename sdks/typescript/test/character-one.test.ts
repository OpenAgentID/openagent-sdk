import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { blake3 } from '@noble/hashes/blake3';
import { describe, expect, it } from 'vitest';
import * as eye from '../src/agent-eye.js';
import { createCharacterAnimator } from '../src/character-animation.js';
import {
  ONE_KINDS, ONE_NEUTRAL, getOneColors, nextOneColor, oneColorForDid, oneEyeOutline, oneFaceFor, oneGeometry, oneHeldPose, onePaint, oneTier,
  type OneColor, type OneFace,
} from '../src/character-one.js';
import { mountOne, renderOne } from '../src/one.js';
import { OneMotion, seededRandom, type OneMomentName } from '../src/character-one-motion.js';
import { getCharacterExpressions, getCharacterStatuses } from '../src/character-state.js';
import { agentAvatar } from '../src/glyph.js';
import { generateCharacter, getCharacterSkins, parseCharacterAppearance, type CharacterOptions } from '../src/characters.js';

// The byte-identical master contributed by JR (see test/fixtures/agent-eye/PROVENANCE.md).
const masterUrl = new URL('./fixtures/agent-eye/agent-eye.js', import.meta.url);
const MASTER_SHA256 = '83cc379a706b86899c56b41813030a721110071dbcd11274ebdc146a40b8bba4';
const master = await import(masterUrl.href) as typeof eye & {
  poseToFrame(pose: object): Record<string, number>;
  sampleCurve(curve: readonly unknown[], t: number): number;
};

const did = 'did:oas:openagent:agent:character-vector';
const order: readonly OneColor[] = ['blue', 'red', 'sky', 'green', 'yellow', 'pink', 'plum', 'teal', 'lime', 'mint', 'lilac', 'coral'];
const row = { x: 0.4, y: 0.1 } as const;
const DEG = Math.PI / 180;

// ── colour science for the palette gates (WCAG 2.x, CIEDE2000, Machado 2009 severity 1.0) ─────────
const rgb = (hex: string): number[] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const linear = (v: number): number => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const gamma = (v: number): number => v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
const luminance = (hex: string): number => { const [r, g, b] = rgb(hex).map(linear) as [number, number, number]; return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: string, b: string): number => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number]; return (x + 0.05) / (y + 0.05); };
const toHex = (values: number[]): string => '#' + values.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
function lab(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map(linear) as [number, number, number];
  const X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b, Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b, Z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  const f = (t: number): number => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  const [fx, fy, fz] = [X / 0.95047, Y, Z / 1.08883].map(f) as [number, number, number];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function de2000([L1, a1, b1]: number[], [L2, a2, b2]: number[]): number {
  const rad = DEG, deg = 1 / DEG;
  const C1 = Math.hypot(a1!, b1!), C2 = Math.hypot(a2!, b2!), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1!, a2p = (1 + G) * a2!;
  const C1p = Math.hypot(a1p, b1!), C2p = Math.hypot(a2p, b2!);
  const h = (a: number, b: number): number => { const v = Math.atan2(b, a) * deg; return v < 0 ? v + 360 : v; };
  const h1p = h(a1p, b1!), h2p = h(a2p, b2!);
  const dLp = L2! - L1!, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp / 2 * rad);
  const Lbp = (L1! + L2!) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) { if (Math.abs(h1p - h2p) > 180) hbp += h1p + h2p < 360 ? 360 : -360; hbp /= 2; }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + 0.015 * (Lbp - 50) ** 2 / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}
const deficiency: Record<string, number[][]> = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
function simulate(hex: string, condition: string): string {
  if (condition === 'normal') return hex;
  const value = rgb(hex).map(linear);
  return toHex(deficiency[condition]!.map(m => gamma(Math.min(1, Math.max(0, m[0]! * value[0]! + m[1]! * value[1]! + m[2]! * value[2]!)))));
}
const distance = (a: string, b: string, condition = 'normal'): number => de2000(lab(simulate(a, condition)), lab(simulate(b, condition)));
const surfaces = { light: ['#f4f2ec', '#eae7df', '#fbfaf6', '#e8e6de'], dark: ['#0d1510', '#152019', '#1d2b22', '#262927'] } as const;

// ── agent-eye containment (the master's tools/build.mjs check) ───────────────────────────────────
function eyeOutline(frame: eye.AgentEyeFrame): { r: number; points: [number, number][] } {
  const { r, a, b } = eye.barShape(frame);
  const k = frame.k, c = Math.cos(frame.tilt * DEG), s = Math.sin(frame.tilt * DEG);
  const quad = (p0: number, p1: number, p2: number, t: number): number => p0 * (1 - t) ** 2 + 2 * p1 * t * (1 - t) + p2 * t * t;
  const local: [number, number][] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    local.push([-a - k + 2 * a * t, -b], [-a - k + 2 * a * t, b]);
    local.push([quad(a - k, a + k, a - k, t), quad(-b, 0, b, t)], [quad(-a - k, -a + k, -a - k, t), quad(-b, 0, b, t)]);
  }
  return { r, points: local.map(([px, py]) => [frame.x + px * c - py * s, frame.y + px * s + py * c]) };
}
function contained(pose: Parameters<typeof eye.poseToFrame>[0]): { eye: number; mouth: number; gap: number } {
  const frame = eye.poseToFrame(pose);
  const outline = eyeOutline(frame);
  let eyeMax = 0, mouthMax = 0, gap = Infinity;
  for (const [x, y] of outline.points) eyeMax = Math.max(eyeMax, Math.hypot(x, y) + outline.r);
  if (frame.mo > 0.01) {
    const corner = eye.GEOMETRY.cornerRadius;
    const ix = frame.ma - corner, iy = frame.mt / 2 - corner;
    for (const [i, j] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) mouthMax = Math.max(mouthMax, Math.hypot(frame.mx + i * ix, frame.my + j * iy) + corner);
    for (let i = 0; i <= 32; i++) {
      const px = frame.mx - frame.ma + 2 * frame.ma * i / 32, py = frame.my - frame.mt / 2;
      for (const [ex, ey] of outline.points) gap = Math.min(gap, Math.hypot(px - ex, py - ey) - outline.r);
    }
  }
  return { eye: eyeMax, mouth: mouthMax, gap };
}

const faces: readonly OneFace[] = ['idle', 'listening', 'thinking', 'working', 'typing', 'speaking', 'done', 'attention',
  'waiting', 'paused', 'offline', 'error', ...getCharacterExpressions()];
const moments: readonly OneMomentName[] = ['settle', 'home', 'psst', 'aha', 'smile', 'nod', 'dizzy', 'dozeOff', 'wake', 'read', 'ponder', 'keys', 'wave', 'firstBlink',
  'lookAtYou', 'shrug', 'popIn'];
const sizes = [16, 24, 44, 96] as const;

describe('agent-eye port', () => {
  it('pins the contributed master byte for byte', () => {
    const bytes = readFileSync(masterUrl);
    expect(bytes.byteLength).toBe(43948);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(MASTER_SHA256);
  });

  it('matches the master geometry, mouth, path and constants across a grid of poses', () => {
    expect({ ...eye.GEOMETRY }).toEqual({ ...master.GEOMETRY });
    expect({ ...eye.MOTION }).toEqual({ ...master.MOTION });
    expect({ ...eye.MOUTH }).toEqual({ ...master.MOUTH });
    for (const look of [-1, -0.55, -0.1, 0, 0.3, 0.9, 1]) for (const lift of [-1, -0.45, 0, 0.4, 1]) {
      for (const open of [0, 0.42, 0.72, 1, 1.15]) for (const tilt of [-16, 0, 12]) for (const smile of [0, 0.35, 1, 1.12]) {
        const pose = { look, lift, open, tilt, smile, mouth: smile ? 1 : 0 };
        const ours = eye.poseToFrame(pose);
        const theirs = master.poseToFrame(pose);
        for (const key of ['x', 'y', 'w', 'h', 'k', 'tilt', 'mx', 'my', 'ma', 'mt', 'mo'] as const) expect(ours[key]).toBe(theirs[key]);
        expect(eye.barPath(eye.barShape(ours).n)).toBe(master.barPath(master.barShape(theirs as never).n));
      }
    }
  });

  it('matches the master eases, blink and smile curves', () => {
    for (const [name, values] of Object.entries(master.EASE)) {
      expect(eye.EASE[name as keyof typeof eye.EASE]).toEqual(values);
      const ours = eye.cubicBezier(...(values as [number, number, number, number]));
      const theirs = master.cubicBezier(...(values as [number, number, number, number]));
      for (let x = 0; x <= 1; x += 0.05) expect(ours(x)).toBe(theirs(x));
    }
    expect(eye.BLINK).toEqual(master.BLINK);
    expect(eye.SMILE).toEqual({ ...master.SMILE });
  });
});

describe('One palette', () => {
  it('lists the twelve colours in the default order with Digital One as the thirteenth kind', () => {
    expect(getOneColors().map(entry => entry.id)).toEqual(order);
    expect(getOneColors().map(entry => entry.label)).toEqual(['Blue', 'Red', 'Sky', 'Green', 'Yellow', 'Pink', 'Plum', 'Teal', 'Lime', 'Mint', 'Lilac', 'Coral']);
    expect(ONE_KINDS).toEqual([...order, 'charcoal']);
    expect(Object.isFrozen(getOneColors())).toBe(true);
    for (const entry of getOneColors()) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.light)).toBe(true);
      expect(Object.isFrozen(entry.dark)).toBe(true);
    }
  });

  it('keeps the plan-of-record values (AVATARS.md §1.3)', () => {
    expect(Object.fromEntries(getOneColors().map(entry => [entry.id, [entry.light.disc, entry.light.keyline, entry.dark.disc, entry.light.eye]]))).toEqual({
      blue: ['#3253e6', null, '#5366fd', '#fbfaf6'], red: ['#e51e59', null, '#e51e59', '#fbfaf6'],
      sky: ['#6fc9fe', '#3889b6', '#6fc9fe', '#141b16'], green: ['#0e9076', null, '#0e9076', '#fbfaf6'],
      yellow: ['#ffe93f', '#908207', '#ffe93f', '#141b16'], pink: ['#f85fa0', '#cd4882', '#f85fa0', '#141b16'],
      plum: ['#890f8e', null, '#a94cac', '#fbfaf6'], teal: ['#0aaead', '#3b8f8e', '#0aaead', '#141b16'],
      lime: ['#a9c21a', '#798a28', '#a9c21a', '#141b16'], mint: ['#3df0b0', '#21946b', '#3df0b0', '#141b16'],
      lilac: ['#b183f4', '#9068ca', '#b183f4', '#141b16'], coral: ['#fa8f77', '#bd624e', '#f29782', '#141b16'],
    });
    expect(onePaint('charcoal', 'light')).toEqual({ disc: '#141b16', discOpacity: 1, eye: null, keyline: null, temperament: 'dry' });
    expect(onePaint('charcoal', 'dark')).toEqual({ disc: '#f2f1ea', discOpacity: 1, eye: null, keyline: null, temperament: 'dry' });
    // A blank head is the surface's ink at 10 % with a muted eye (AVATARS.md §1.1), never a colour.
    expect(onePaint('blank', 'light')).toEqual({ disc: '#141b16', discOpacity: 0.1, eye: '#5a6256', keyline: null, temperament: 'neat' });
    expect(onePaint('blank', 'dark')).toEqual({ disc: '#f2f1ea', discOpacity: 0.1, eye: '#a9b2a2', keyline: null, temperament: 'neat' });
  });

  it('passes the eye and silhouette contrast gates on every surface', () => {
    for (const entry of getOneColors()) {
      expect(contrast(entry.light.eye, entry.light.disc)).toBeGreaterThanOrEqual(3);
      expect(contrast(entry.dark.eye, entry.dark.disc)).toBeGreaterThanOrEqual(3);
      const silhouette = entry.light.keyline ?? entry.light.disc;
      for (const surface of surfaces.light) expect(contrast(silhouette, surface)).toBeGreaterThanOrEqual(3);
      // A keyline appears exactly where the disc alone does not reach 3:1.
      expect(entry.light.keyline !== null).toBe(Math.min(...surfaces.light.map(surface => contrast(entry.light.disc, surface))) < 3);
      for (const surface of surfaces.dark) expect(contrast(entry.dark.disc, surface)).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps colours apart from One, amber, needs-you green, danger and Google', () => {
    const google = [
      '#4285F4', '#EA4335', '#FBBC05', '#34A853', // the logo
      '#1A73E8', '#D93025', '#F9AB00', '#1E8E3E', '#188038', // Material
      '#DB4437', '#F4B400', '#0F9D58', // the 2014–15 brand palette (its blue is the logo's)
      '#4885ED', '#DB3236', '#F4C20D', '#3CBA54', // the widely published 2015 logo values
    ];
    for (const entry of getOneColors()) {
      expect(distance(entry.light.disc, '#141b16')).toBeGreaterThanOrEqual(25);
      expect(distance(entry.dark.disc, '#f2f1ea')).toBeGreaterThanOrEqual(25);
      expect(distance(entry.light.disc, '#c8793a')).toBeGreaterThanOrEqual(15);
      expect(distance(entry.light.disc, '#2b6143')).toBeGreaterThanOrEqual(12);
      expect(distance(entry.dark.disc, '#bcd8a6')).toBeGreaterThanOrEqual(12);
      expect(distance(entry.light.disc, '#c2412d')).toBeGreaterThanOrEqual(10);
      expect(distance(entry.dark.disc, '#ff6b57')).toBeGreaterThanOrEqual(10);
      expect(Math.min(...google.map(value => distance(entry.light.disc, value)))).toBeGreaterThanOrEqual(10);
    }
  });

  it('gives small teams the most distinct colours under every colour-vision condition', () => {
    // Smallest pairwise distance among Digital One and the first n colours, worst of both surfaces and
    // four conditions: 13.4, 10.0 and 8.3. The first five's floor is Yellow beside Digital One's chalk on dark
    // surfaces under tritanopia; both are fixed by the shared palette, so no other colour can raise it.
    const minimum = (n: number): number => {
      let worst = Infinity;
      for (const theme of ['light', 'dark'] as const) for (const condition of ['normal', 'protan', 'deutan', 'tritan']) {
        const set = [onePaint('charcoal', theme).disc, ...getOneColors().slice(0, n).map(entry => entry[theme].disc)];
        for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) worst = Math.min(worst, distance(set[i]!, set[j]!, condition));
      }
      return worst;
    };
    expect(minimum(5)).toBeGreaterThanOrEqual(13.35);
    expect(minimum(8)).toBeGreaterThanOrEqual(9.95);
    expect(minimum(12)).toBeGreaterThanOrEqual(8.25);
  });
});

describe('One colour assignment', () => {
  it('derives a stable default colour from the literal DID and never picks Digital One', () => {
    // SDK-derived regression vectors for the documented rule: BLAKE3("oaid-character-v1\0one\0" + DID),
    // first four bytes little-endian, modulo twelve, indexing the default order.
    expect(oneColorForDid(did)).toBe('sky');
    expect(oneColorForDid('did:oas:agent-instance:01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe('green');
    expect(oneColorForDid('did:l1fe:agent:character-vector')).toBe('green');
    expect(oneColorForDid('did:oas:openagent:agent:preview')).toBe('lime');
    for (let index = 0; index < 64; index++) {
      const identifier = `did:oas:openagent:agent:assign-${index}`;
      const seed = blake3(new TextEncoder().encode(`oaid-character-v1\u0000one\u0000${identifier}`));
      const value = (seed[0]! | seed[1]! << 8 | seed[2]! << 16 | seed[3]! << 24) >>> 0;
      expect(oneColorForDid(identifier)).toBe(order[value % 12]);
      expect(generateCharacter(identifier, { skin: 'one' }).shape).toBe(order[value % 12]);
    }
    const counts = new Map<string, number>();
    for (let index = 0; index < 1200; index++) {
      const color = oneColorForDid(`did:oas:openagent:agent:spread-${index}`);
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([...order].sort());
    for (const count of counts.values()) expect(count).toBeGreaterThan(60);
  });

  it('refuses non-agent identities', () => {
    for (const identifier of ['did:oas:openagent:tool:hammer', 'not a did', '', 'did:oas:openagent:agent:<x>']) {
      expect(() => oneColorForDid(identifier)).toThrow();
    }
  });

  it('assigns the first free colour, then the least held, ties by order', () => {
    expect(nextOneColor([])).toBe('blue');
    expect(nextOneColor(['blue'])).toBe('red');
    expect(nextOneColor(['red', 'blue', 'green'])).toBe('sky');
    expect(nextOneColor(new Set<OneColor>(['blue', 'red', 'sky', 'green', 'yellow']))).toBe('pink');
    const held: OneColor[] = [];
    for (let n = 0; n < 12; n++) held.push(nextOneColor(held));
    expect(held).toEqual(order);
    expect(new Set(held).size).toBe(12);
    expect(nextOneColor(held)).toBe('blue');
    expect(nextOneColor([...order, 'blue', 'red'])).toBe('sky');
    expect(nextOneColor([...order, ...order.filter(color => color !== 'coral')])).toBe('coral');
  });

  it('refuses unknown or malformed held colours instead of skipping them', () => {
    for (const held of [['charcoal'], ['Blue'], [null], ['orange']]) expect(() => nextOneColor(held as OneColor[])).toThrow();
    for (const held of [null, undefined, 1, 'blue']) expect(() => nextOneColor(held as unknown as OneColor[])).toThrow();
  });

  it('lets stored appearance override the DID colour and select Digital One', () => {
    expect(parseCharacterAppearance({ skin: 'one', shape: 'teal' })).toEqual({ skin: 'one', shape: 'teal' });
    expect(parseCharacterAppearance({ skin: 'one', shape: 'charcoal' })).toEqual({ skin: 'one', shape: 'charcoal' });
    expect(() => parseCharacterAppearance({ skin: 'one', shape: 'standard' })).toThrow();
    expect(() => parseCharacterAppearance({ skin: 'autos', shape: 'teal' })).toThrow();
    expect(() => parseCharacterAppearance({ skin: 'one', theme: 'dark' })).toThrow();
    expect(() => parseCharacterAppearance({ skin: 'one', label: 'Scout' })).toThrow();
    const teal = generateCharacter(did, { skin: 'one', shape: 'teal' });
    expect(teal).toMatchObject({ skin: 'one', shape: 'teal', color: '#0aaead' });
    expect(generateCharacter(did, { skin: 'one', shape: 'charcoal' }).color).toBe('#141b16');
    expect(generateCharacter(did, { skin: 'one', shape: 'charcoal', theme: 'dark' }).color).toBe('#f2f1ea');
    expect(generateCharacter(did, { skin: 'one', shape: 'blue', theme: 'dark' }).color).toBe('#5366fd');
    const avatar = decodeURIComponent(agentAvatar(did, { avatarSkin: { skin: 'one', shape: 'plum' } }).split(',')[1]!);
    expect(avatar).toContain('data-character-skin="one"');
    expect(avatar).toContain('fill="#890f8e"');
  });
});

describe('One faces', () => {
  it('maps every status and expression to a face, activity statuses to their own faces', () => {
    const activity: Record<string, OneFace> = { idle: 'idle', listening: 'listening', reasoning: 'thinking', working: 'working',
      typing: 'typing', speaking: 'speaking', success: 'done', attention: 'attention', blocked: 'waiting', paused: 'paused',
      offline: 'offline', error: 'error' };
    for (const { status, expression } of getCharacterStatuses()) {
      const face = oneFaceFor({ status, expression });
      expect(face).toBe(activity[status] ?? expression);
      expect(() => oneHeldPose(face, row, 44)).not.toThrow();
    }
    // An explicit expression override shows that expression's face.
    expect(oneFaceFor({ status: 'working', expression: 'curious' })).toBe('curious');
    expect(oneFaceFor({ status: 'paused', expression: 'happy' })).toBe('happy');
  });

  it('keeps needs-you the only head looking at the viewer in a list', () => {
    for (const face of faces) for (const px of sizes) {
      const pose = oneHeldPose(face, row, px);
      const atViewer = Math.abs(pose.look) < 0.15 && Math.abs(pose.lift) < 0.2;
      // Listening and speaking are call faces, shown at the viewer by design.
      if (face === 'attention' || face === 'listening' || face === 'speaking') continue;
      expect(atViewer, `${face} at ${px}px`).toBe(false);
    }
    expect(oneHeldPose('attention', row, 44)).toMatchObject({ look: 0, lift: 0, open: 1.06 });
  });

  it('never holds a smile, a mouth or an eye that reads as a dot', () => {
    for (const face of faces) for (const px of sizes) for (const gaze of [row, { x: 0, y: 0 }, { x: -0.4, y: 0.1 }, { x: 1, y: -1 }]) {
      const pose = oneHeldPose(face, gaze, px);
      expect(pose.smile).toBe(0);
      expect(pose.mouth).toBe(0);
      expect(pose.open <= 0.08 || pose.open >= 0.35, `${face} open ${pose.open}`).toBe(true);
      if (pose.open <= 0.08) expect(px).toBeGreaterThanOrEqual(64);
    }
  });

  it('dozes with a visible eye below 64 px and closes the lid at 64 px and up', () => {
    expect(oneHeldPose('paused', row, 44).open).toBe(0.42);
    expect(oneHeldPose('paused', row, 64).open).toBe(0);
    expect(oneTier(16)).toBe('XS'); expect(oneTier(20)).toBe('XS'); expect(oneTier(24)).toBe('S'); expect(oneTier(36)).toBe('S');
    expect(oneTier(40)).toBe('M'); expect(oneTier(52)).toBe('M'); expect(oneTier(64)).toBe('L'); expect(oneTier(512)).toBe('L');
  });

  it('draws the mark itself at agent-eye REST, and keeps the centred face for needs-you', () => {
    const rest = oneGeometry(ONE_NEUTRAL, 'S', 'neat');
    const mark = eye.poseToFrame(eye.REST);
    expect(rest.bar).toBe(eye.barPath(eye.barShape(mark).n));
    expect(rest.eye).toBe('translate(0 0) rotate(0)');
    expect(rest.strokeWidth).toBe(eye.r2(2 * eye.barShape(mark).r));
    expect(rest.mouth).toBeNull();
    expect(rest.body).toBe('');
    // With no content direction (a hero), idle and neutral are warm at the viewer, so a head that needs you, centred
    // and a touch wide, is never mistaken for one at rest (AVATARS.md §2.2, Idle in heroes).
    for (const face of ['idle', 'neutral'] as const) {
      expect(oneHeldPose(face, { x: 0, y: 0 }, 96)).toMatchObject({ look: 0, lift: 0, tilt: 5, open: 0.92 });
      expect(oneHeldPose(face, { x: 0, y: 0.3 }, 40)).toMatchObject({ look: 0, lift: 0.3, tilt: 0, open: 1 });
    }
    expect(oneHeldPose('attention', { x: 0, y: 0 }, 96)).toMatchObject({ look: 0, lift: 0, tilt: 0, open: 1.06 });
  });

  it('mirrors faces for right-to-left content', () => {
    for (const face of faces) {
      const ltr = oneHeldPose(face, row, 44), rtl = oneHeldPose(face, { x: -row.x, y: row.y }, 44);
      expect(rtl.look).toBeCloseTo(-ltr.look, 10);
      expect(rtl.tilt).toBeCloseTo(-ltr.tilt, 10);
      expect(rtl.lift).toBe(ltr.lift);
    }
  });

  it('keeps every held face inside the safe radius', () => {
    for (const face of faces) for (const px of sizes) for (const gaze of [row, { x: 1, y: 1 }, { x: -1, y: -1 }]) {
      const result = contained(oneHeldPose(face, gaze, px));
      expect(result.eye).toBeLessThanOrEqual(eye.MOTION.safeRadius + 0.01);
    }
  });
});

describe('One moments', () => {
  const motion = (face: OneFace, px: number, temperament: 'quick' | 'bouncy' | 'neat' | 'slow' | 'dry' = 'neat', level?: () => number) =>
    new OneMotion({ face, gaze: row, px, temperament, random: seededRandom(new Uint8Array([1, 2, 3, 4])),
      cadence: 'brief', ...(level ? { level } : {}), motion: true, at: 0 });
  const check = (pose: Parameters<typeof contained>[0], context: string): void => {
    const result = contained(pose);
    expect(result.eye, context).toBeLessThanOrEqual(eye.MOTION.safeRadius + 0.01);
    expect(result.mouth, context).toBeLessThanOrEqual(eye.MOTION.safeRadius + 0.01);
    expect(result.gap, context).toBeGreaterThanOrEqual(eye.MOUTH.minGap);
  };

  it('keeps every frame of every moment inside the disc, with the smile clear of the eye, from every face (V2)', () => {
    for (const name of moments) for (const px of sizes) for (const temperament of ['quick', 'slow'] as const) for (const face of faces) {
      const head = motion(face, px, temperament);
      head.start({ name, priority: 0 }, 0);
      const end = head.timelineEnd!;
      expect(end).toBeGreaterThan(0);
      expect(end).toBeLessThan(5000);
      for (let t = 0; t <= end + 16; t += 16) check(head.sample(t).frame.pose, `${name} from ${face} at ${px}px, ${t} ms`);
      expect(head.moving).toBe(false);
      const settled = head.sample(end + 100).frame.pose, held = oneHeldPose(face, row, px);
      if (name === 'keys') continue; // keystrokes keep the typing face's level; the next state's entrance settles it
      for (const key of Object.keys(held) as (keyof typeof held)[]) expect(settled[key], `${name} from ${face} ${key}`).toBeCloseTo(held[key], 3);
    }
  });

  it('withdraws the smile line before an interrupting moment moves the eye (V2)', () => {
    for (const px of [44, 64, 96]) for (const name of moments) for (let offset = 0; offset <= 3300; offset += 50) {
      const head = motion('done', px, 'bouncy');
      head.start({ name: 'smile', priority: 4 }, 0);
      for (let t = 0; t < offset; t += 25) head.sample(t);
      head.sample(offset);
      head.start({ name, priority: 6 }, offset);
      const end = head.timelineEnd!;
      // Whole moments are checked above; here every frame that still shows the line is checked against the eye.
      for (let t = offset; t <= end; t += 4) {
        const { frame } = head.sample(t);
        if (frame.geometry.mouth) check(frame.pose, `${name} cutting the smile at ${offset} ms, ${px}px, ${t} ms`);
      }
    }
    for (const name of moments) for (let offset = 100; offset <= 2000; offset += 50) {
      let level = 0;
      const head = motion('speaking', 96, 'dry', () => level);
      expect(head.startTalk(0)).toBe(true);
      for (let t = 0; t <= offset; t += 16) { level = Math.abs(Math.sin(t / 130)); head.sample(t); }
      head.start({ name, priority: 6 }, offset);
      const end = head.timelineEnd!;
      for (let t = offset; t <= end; t += 4) {
        const { frame } = head.sample(t);
        if (frame.geometry.mouth) check(frame.pose, `${name} cutting talk at ${offset} ms, ${t} ms`);
      }
    }
  }, 60_000);

  it('smiles with a happy squint at 40 px and up, never a tall bar over the line', () => {
    for (const [px, open] of [[44, 0.42], [96, 0.6]] as const) for (const gaze of [row, { x: 0, y: 0.3 }]) {
      const head = new OneMotion({ face: 'done', gaze, px, temperament: 'neat', random: seededRandom(new Uint8Array(4)), cadence: 'brief', motion: true, at: 0 });
      head.start({ name: 'smile', priority: 4 }, 0);
      const peak = head.sample(1300).frame.pose;
      expect(peak.open).toBeCloseTo(open, 3);
      expect(peak.tilt).toBeCloseTo(10, 3);
      expect(peak.look).toBeCloseTo(gaze.x === 0 ? 0.12 : 0.2, 3);
      expect(peak.smile).toBeCloseTo(1, 2);
      expect(peak.mouth).toBeCloseTo(1, 2);
      // The eye's drawn height is less than half the mark's: it reads as a squinting face, not "!".
      expect(eye.poseToFrame(peak).h).toBeLessThan(eye.GEOMETRY.barHeight / 2);
    }
  });

  it('talks with a narrowed eye, a full smile and an opaque mouth that follows the voice level, inside the disc', () => {
    let level = 0;
    const head = motion('speaking', 96, 'dry', () => level);
    expect(head.startTalk(0)).toBe(true);
    let opened = 0;
    for (let t = 0; t < 4000; t += 16) {
      level = Math.abs(Math.sin(t / 180));
      const { frame } = head.sample(t);
      opened = Math.max(opened, frame.pose.mouth);
      check(frame.pose, `talk at ${t} ms`);
      // A drawn mouth line is always fully opaque: a quiet syllable never flickers like a status light.
      if (frame.geometry.mouth) expect(frame.geometry.mouth.opacity).toBe(1);
      if (t > 600) { expect(frame.pose.smile).toBeGreaterThan(0.99); expect(frame.pose.open).toBeCloseTo(0.6, 2); }
    }
    expect(opened).toBeGreaterThan(0.9);
    level = 0;
    let closed = 1;
    for (let t = 4000; t < 5000; t += 16) closed = head.sample(t).frame.pose.mouth;
    expect(closed).toBe(0);
    // No talk without a level source, below the largest tier or without motion.
    expect(motion('speaking', 44, 'dry', () => 1).startTalk(0)).toBe(false);
    expect(motion('speaking', 96).startTalk(0)).toBe(false);
  });

  it('chooses entrances from the state map, by priority, and settles the smallest heads without moments', () => {
    const entering = (from: OneFace, to: OneFace, px = 44) => motion(from, px).entrance(from, to);
    expect(entering('idle', 'attention')).toEqual({ name: 'psst', priority: 6 });
    expect(entering('idle', 'error')).toEqual({ name: 'dizzy', priority: 5 });
    expect(entering('working', 'done')).toEqual({ name: 'smile', priority: 4 });
    expect(entering('working', 'done', 28)).toEqual({ name: 'nod', priority: 4 });
    expect(entering('idle', 'paused')).toEqual({ name: 'dozeOff', priority: 3 });
    expect(entering('paused', 'idle')).toEqual({ name: 'wake', priority: 3 });
    expect(entering('thinking', 'idle')).toEqual({ name: 'aha', priority: 3 });
    expect(entering('idle', 'working')).toEqual({ name: 'read', priority: 2 });
    expect(entering('idle', 'typing')).toEqual({ name: 'keys', priority: 2 });
    expect(entering('idle', 'thinking')).toEqual({ name: 'ponder', priority: 1 });
    expect(entering('idle', 'curious')).toEqual({ name: 'home', priority: 0 });
    expect(entering('idle', 'attention', 16)).toEqual({ name: 'settle', priority: 0, uncounted: true });
    // Needs you, then error, then done, then the ongoing states (AVATARS.md §2.3 rule 2).
    expect(['attention', 'error', 'done', 'paused', 'working', 'thinking'].map(to => entering('idle', to as OneFace).priority))
      .toEqual([6, 5, 4, 3, 2, 1]);
  });

  it('shuts a centred eye tilted, so a blink at the viewer never shows a level bar', () => {
    for (const [from, to] of [['idle', 'attention'], ['paused', 'idle']] as const) for (const px of [24, 44, 96]) {
      const head = motion(from, px);
      head.setFace(to, row, 0);
      head.start(head.entrance(from, to), 0);
      let shut: { open: number; tilt: number } | null = null;
      for (let t = 0; t <= head.timelineEnd!; t += 4) {
        const pose = head.sample(t).frame.pose;
        if (Math.abs(pose.look) < 0.15 && (!shut || pose.open < shut.open)) shut = { open: pose.open, tilt: pose.tilt };
      }
      expect(shut!.open, `${from}→${to} ${px}`).toBeLessThan(0.1);
      expect(Math.abs(shut!.tilt), `${from}→${to} ${px}`).toBeGreaterThanOrEqual(6);
    }
  });

  it('starts thinking with a quick glance up and keeps read-along jumps at agent-eye speed for every temperament', () => {
    for (const temperament of ['quick', 'slow'] as const) {
      const ponder = motion('thinking', 96, temperament);
      ponder.start({ name: 'ponder', priority: 1 }, 0);
      expect(ponder.sample(400).frame.pose.lift).toBeLessThan(-0.4);
      const read = motion('working', 96, temperament);
      read.start({ name: 'read', priority: 2 }, 0);
      // The first saccade (110 ms + 110 per unit of look, then a 160 ms settle) lands on time whatever the tempo.
      expect(read.sample(400).frame.pose.look).toBeCloseTo(-0.55, 1);
    }
  });

  it('types with keystrokes of a pixel or two', () => {
    const head = motion('typing', 96);
    head.start({ name: 'keys', priority: 2 }, 0);
    let lowest = 0;
    for (let t = 0; t <= head.timelineEnd!; t += 8) lowest = Math.max(lowest, head.sample(t).frame.pose.lift);
    expect(lowest - oneHeldPose('typing', row, 96).lift).toBeGreaterThanOrEqual(0.2);
  });

  it('opens a new agent\'s eye for the first time, shut and tilted, then looks toward its name', () => {
    for (const px of [24, 44, 96]) {
      const head = motion('idle', px);
      head.start({ name: 'firstBlink', priority: 7, user: true }, 0);
      const first = head.sample(1).frame.pose;
      expect(first.open).toBe(0);
      expect(Math.abs(first.tilt)).toBeGreaterThanOrEqual(6);
      expect(head.sample(450).frame.pose.open).toBeGreaterThan(0.9);
      const end = head.timelineEnd!;
      expect(end).toBeLessThanOrEqual(px >= 40 ? 1800 : 1000);
      expect(head.sample(end + 50).frame.pose).toEqual(expect.objectContaining({ look: expect.closeTo(row.x, 3), lift: expect.closeTo(row.y, 3) }));
    }
  });

  it('plays the host\'s gestures, each ending on the held face: look-at-you, a shrug and an arrival', () => {
    const peak = (head: OneMotion, pick: (pose: ReturnType<typeof oneHeldPose>) => number, max = true): number => {
      let best = max ? -Infinity : Infinity;
      for (let t = 0; t <= head.timelineEnd!; t += 8) { const v = pick(head.sample(t).frame.pose); best = max ? Math.max(best, v) : Math.min(best, v); }
      return best;
    };
    for (const px of [24, 44, 96]) {
      // Look-at-you turns square to the viewer, then blinks shut tilted, never as a level bar.
      const look = motion('idle', px);
      look.start({ name: 'lookAtYou', priority: 5, user: true }, 0);
      const square = look.sample(300).frame.pose;
      expect(Math.abs(square.look)).toBeLessThan(0.05);
      expect(Math.abs(square.lift)).toBeLessThan(0.05);
      let shut = false;
      for (let t = 0; t <= look.timelineEnd!; t += 4) {
        const pose = look.sample(t).frame.pose;
        if (pose.open < 0.05) { shut = true; expect(Math.abs(pose.tilt)).toBeGreaterThanOrEqual(4); }
      }
      expect(shut).toBe(true);
      expect(look.timelineEnd!).toBeLessThan(2000);
    }
    // Digital One holds deadpan with a dry chuckle at 40 px and up; a coloured One opens a touch wide.
    const dry = motion('idle', 44, 'dry');
    dry.start({ name: 'lookAtYou', priority: 5 }, 0);
    expect(dry.sample(300).frame.pose.open).toBeCloseTo(0.92, 2);
    expect(peak(dry, pose => pose.squash)).toBeGreaterThan(1);
    // The shrug looks up and aside and tips its body at 40 px and up.
    const shrug = motion('idle', 64);
    shrug.start({ name: 'shrug', priority: 5 }, 0);
    expect(peak(shrug, pose => pose.lift, false)).toBeLessThan(-0.3);
    expect(peak(shrug, pose => Math.abs(pose.rotate))).toBeGreaterThan(8);
    // The arrival starts by shutting the eye (tilted), pops up and lands with the eye wide open.
    const arrive = motion('idle', 96, 'dry');
    arrive.start({ name: 'popIn', priority: 3 }, 0);
    const closed = arrive.sample(120).frame.pose; // 80 ms at tempo 1; Digital One at 96 px is paced 1.18×
    expect(closed.open).toBeLessThan(0.05);
    expect(Math.abs(closed.tilt)).toBeGreaterThanOrEqual(6);
    expect(peak(arrive, pose => pose.hop, false)).toBeLessThan(-0.05);
    expect(peak(arrive, pose => pose.open)).toBeGreaterThan(1.03);
    expect(arrive.timelineEnd!).toBeLessThan(1500);
  });

  it('follows a fine pointer with the eye only, at rest and at 40 px and up', () => {
    const head = motion('idle', 64);
    expect(head.follow({ x: 0.8, y: -0.5 })).toBe(true);
    expect(head.moving).toBe(true);
    for (let t = 0; t <= 600; t += 16) head.sample(t);
    const pose = head.sample(616).frame.pose;
    expect(pose.look).toBeCloseTo(0.8, 2);
    expect(pose.lift).toBeCloseTo(-0.5, 2);
    expect(pose.squash).toBe(0);
    expect(head.request).toBeNull();
    expect(head.follow(null)).toBe(false);
    expect(head.moving).toBe(false);
    expect(motion('working', 64).follow({ x: 1, y: 0 })).toBe(false);
    expect(motion('idle', 32).follow({ x: 1, y: 0 })).toBe(false);
    const still = new OneMotion({ face: 'idle', gaze: row, px: 64, temperament: 'neat', random: seededRandom(new Uint8Array(4)), cadence: 'brief', motion: false, at: 0 });
    expect(still.follow({ x: 1, y: 0 })).toBe(false);
    // A moment takes over from following; containment holds at the pointer's extremes.
    head.follow({ x: -1, y: 1 });
    for (let t = 700; t <= 1500; t += 16) check(head.sample(t).frame.pose, `follow ${t}`);
    head.start({ name: 'psst', priority: 6 }, 1500);
    expect(head.following).toBe(false);
  });

  it('repaints mid-moment without finishing it, so a host never loses track of a moving head', () => {
    const head = motion('idle', 44);
    head.start({ name: 'wave', priority: 4, user: true }, 0);
    const end = head.timelineEnd!;
    const peeked = head.peek(end + 10);
    expect(peeked.moving).toBe(true);
    expect(head.timelineEnd).toBe(end);
    expect(head.request).not.toBeNull();
    const { finished, frame } = head.sample(end + 10);
    expect(finished).toEqual({ name: 'wave', priority: 4, user: true });
    expect(frame.pose).toEqual(peeked.pose);
  });

  it('paces ongoing work briefly in lists and in clusters in headers, and never at rest', () => {
    const brief = motion('working', 44);
    expect(brief.cadenceRequest()).toMatchObject({ name: 'read', cadence: true });
    expect(brief.nextCadence(100)).toBeGreaterThanOrEqual(300);
    // The next cluster is drawn and measured up front, and is the one that plays.
    expect(brief.cadenceRequest()!.draws).toHaveLength(16);
    expect(brief.nextCadence(4000)).toBeNull();
    const repeat = new OneMotion({ face: 'thinking', gaze: row, px: 40, temperament: 'neat', random: seededRandom(new Uint8Array(4)), cadence: 'repeat', motion: true, at: 0 });
    const delay = repeat.nextCadence(10_000)!;
    expect(delay).toBeGreaterThanOrEqual(6000);
    expect(delay).toBeLessThanOrEqual(10_000);
    expect(repeat.nextCadence(70_000)).toBeNull();
    repeat.noteInput(70_000);
    expect(repeat.nextCadence(70_001)).not.toBeNull();
    // Typing in a header repeats like every ongoing state: one cluster every six to ten seconds, never back to back.
    const typing = new OneMotion({ face: 'typing', gaze: { x: 0, y: 0.3 }, px: 40, temperament: 'neat', random: seededRandom(new Uint8Array([9, 9, 9, 9])), cadence: 'repeat', motion: true, at: 0 });
    expect(typing.cadenceRequest()).toMatchObject({ name: 'keys', cadence: true });
    for (let i = 0; i < 50; i++) {
      const gap = typing.nextCadence(1000 + i)!;
      expect(gap).toBeGreaterThanOrEqual(6000);
      expect(gap).toBeLessThanOrEqual(10_000);
    }
    expect(motion('idle', 44).cadenceRequest()).toBeNull();
    expect(motion('working', 16).cadenceRequest()).toBeNull();
  });

  it('holds every face still without motion', () => {
    const head = new OneMotion({ face: 'idle', gaze: row, px: 44, temperament: 'neat', random: seededRandom(new Uint8Array(4)), cadence: 'brief', motion: false, at: 0 });
    expect(head.setFace('attention', row, 10)).toBeNull();
    expect(head.moving).toBe(false);
    expect(head.sample(20).frame.pose).toEqual(oneHeldPose('attention', row, 44));
    expect(head.cadenceRequest()).toBeNull();
  });
});

describe('One still glyph', () => {
  const attributes = (svg: string): Record<string, string> => Object.fromEntries([...svg.match(/^<svg\b[^>]*>/)![0]
    .matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1]!, match[2]!]));
  const shoelace = (d: string): number => {
    const points = d.slice(1, -1).split('L').map(pair => pair.split(' ').map(Number) as [number, number]);
    let area = 0;
    for (let i = 0; i < points.length; i++) { const [x1, y1] = points[i]!, [x2, y2] = points[(i + 1) % points.length]!; area += x1 * y2 - x2 * y1; }
    return Math.abs(area) / 2;
  };

  it('is a decorative, self-contained still SVG of the held face, with no element identifiers', () => {
    for (const kind of ONE_KINDS) for (const theme of ['light', 'dark'] as const) for (const status of ['idle', 'working', 'attention', 'paused', 'error'] as const) {
      const character = generateCharacter(did, { skin: 'one', shape: kind, theme, size: 44, state: { status, gaze: row } });
      const root = attributes(character.svg);
      expect(root).toMatchObject({ viewBox: '-100 -100 200 200', width: '44', height: '44', 'aria-hidden': 'true', overflow: 'visible',
        'data-character-skin': 'one', 'data-character-shape': kind, 'data-character-theme': theme, 'data-one-color': kind, 'data-one-tier': 'M' });
      expect(root).not.toHaveProperty('role');
      expect(character.svg).not.toContain('<title>');
      expect(character.svg).not.toMatch(/<(?:script|foreignObject|image|text|animate|animateTransform|set|style|mask|use)\b|\b(?:id|on\w+|href|xlink:href|style)=/i);
      expect(character.svg).not.toContain(did);
      const paint = onePaint(kind, theme);
      const pose = oneHeldPose(oneFaceFor({ status, expression: character.expression }), row, 44);
      const geometry = oneGeometry(pose, 'M', paint.temperament);
      expect(character.svg.includes('data-one-keyline')).toBe(paint.keyline !== null);
      expect(character.svg).not.toContain('data-one-mouth');
      if (kind === 'charcoal') {
        // Digital One's eye is cut out of the disc with the even-odd rule: the surface shows through, no mask.
        const outline = oneEyeOutline(eye.poseToFrame({ ...pose }));
        expect(character.svg).toContain(`<path data-one-disc="true" fill-rule="evenodd" d="M100 0A100 100 0 1 1 -100 0A100 100 0 1 1 100 0Z${outline}" fill="${paint.disc}"/>`);
        expect(character.svg).not.toContain('data-one-eye');
      } else {
        expect(character.svg).toContain(`<circle data-one-disc="true" r="100" fill="${paint.disc}"/>`);
        expect(character.svg).toContain(`<g data-character-eyes="agent-eye-v1" transform="${geometry.eye}"><path data-one-eye="true" d="${geometry.bar}"`);
      }
    }
  });

  it('cuts Digital One\'s eye exactly as the stroked bar it draws live', () => {
    for (const look of [-1, -0.5, 0, 0.3, 0.8]) for (const lift of [-0.45, 0, 0.55]) for (const open of [0, 0.42, 0.72, 1, 1.12]) for (const tilt of [-12, 0, 10]) {
      const frame = eye.poseToFrame({ look, lift, open, tilt });
      const { r, a, b } = eye.barShape(frame);
      const outline = oneEyeOutline(frame);
      const points = outline.slice(1, -1).split('L').map(pair => pair.split(' ').map(Number) as [number, number]);
      for (const [x, y] of points) expect(Math.hypot(x, y)).toBeLessThanOrEqual(eye.MOTION.safeRadius + 0.02);
      // Area of every point within r of the bar's filled outline (Steiner's formula): sides x = ±a - c·y².
      let expected: number;
      if (b < 1e-6) expected = 2 * r * (Math.max(a - frame.k, a) - Math.min(-a - frame.k, -a)) + Math.PI * r * r;
      else {
        const c = frame.k / (b * b);
        if (b * b / (2 * Math.abs(frame.k)) < r) continue; // a concave side tighter than the stroke folds over itself
        let side = 0;
        for (let i = 0; i < 2000; i++) { const y = -b + 2 * b * (i + 0.5) / 2000; side += Math.sqrt(1 + 4 * c * c * y * y) * 2 * b / 2000; }
        expected = 4 * a * b + r * (4 * a + 2 * side) + Math.PI * r * r;
      }
      expect(Math.abs(shoelace(outline) - expected), `look ${look} lift ${lift} open ${open} tilt ${tilt}`).toBeLessThanOrEqual(0.004 * expected + 0.6);
    }
  });

  it('names the head only from a supplied label and escapes it', () => {
    const named = generateCharacter(did, { skin: 'one', label: 'Scout & "Co" <agent>' });
    expect(attributes(named.svg)).toMatchObject({ role: 'img', 'aria-label': 'Scout &amp; &quot;Co&quot; &lt;agent&gt;' });
    expect(named.svg).toContain('<title>Scout &amp; &quot;Co&quot; &lt;agent&gt;</title>');
    expect(named.svg).not.toContain('aria-hidden');
    for (const label of ['', '   ', 'a'.repeat(201), 'line\nbreak', 7, null]) {
      expect(() => generateCharacter(did, { skin: 'one', label } as CharacterOptions)).toThrow();
    }
    // Other families keep their generic title unless a label is supplied.
    expect(generateCharacter(did).svg).toContain('<title>OpenAgent Autos character</title>');
    const autos = generateCharacter(did, { label: 'Scout' });
    expect(autos.svg).toContain('<title>Scout</title>');
    expect(attributes(autos.svg)['aria-label']).toBe('Scout');
  });

  it('scales the keyline to one pixel, two at 96 px and up', () => {
    const width = (size: number) => Number(generateCharacter(did, { skin: 'one', shape: 'yellow', size }).svg.match(/data-one-keyline="true" r="[^"]+" fill="none" stroke="#908207" stroke-width="([^"]+)"/)![1]);
    expect(width(16)).toBeCloseTo(200 / 16, 2);
    expect(width(24)).toBeCloseTo(200 / 24, 2);
    expect(width(32)).toBeCloseTo(200 / 32, 2);
    expect(width(64)).toBeCloseTo(200 / 64, 2);
    expect(width(96)).toBeCloseTo(400 / 96, 2);
    expect(generateCharacter(did, { skin: 'one', shape: 'yellow', theme: 'dark' }).svg).not.toContain('data-one-keyline');
  });

  it('renders One heads at the One app\'s smallest sizes, 16–28 px, and only One below 32 px', () => {
    for (const size of [16, 20, 24, 28]) {
      const head = generateCharacter(did, { skin: 'one', shape: 'teal', size, state: { status: 'working', gaze: row } });
      expect(head.size).toBe(size);
      expect(attributes(head.svg)).toMatchObject({ width: String(size), 'data-one-tier': size <= 20 ? 'XS' : 'S' });
      const animator = createCharacterAnimator(did, { skin: 'one', shape: 'teal', size, now: () => 0, state: { gaze: row } });
      animator.update({ status: 'attention' }, 0);
      expect(animator.sample(10).one!.tier).toBe(size <= 20 ? 'XS' : 'S');
    }
    for (const size of [15, 2049, 16.5]) expect(() => generateCharacter(did, { skin: 'one', size })).toThrow('One size must be an integer from 16 to 2048');
    for (const skin of ['autos', 'spacex', 'christmas'] as const) {
      expect(() => generateCharacter(did, { skin, size: 16 })).toThrow('Character size must be an integer from 32 to 2048');
    }
  });

  it('draws the slumped body of a paused head at 64 px and up, as the live head holds it', () => {
    const paused = generateCharacter(did, { skin: 'one', shape: 'red', size: 96, state: { status: 'paused', gaze: row } });
    const body = oneGeometry(oneHeldPose('paused', row, 96), 'L', 'quick').body;
    expect(body).toMatch(/rotate\(6\)/);
    expect(paused.svg).toContain(`<g data-character-body="true" transform="${body}">`);
    expect(generateCharacter(did, { skin: 'one', shape: 'red', size: 44, state: { status: 'paused', gaze: row } }).svg).toContain('<g data-character-body="true">');
  });

  it('keeps finish, eye placement and accessories in the descriptor without drawing them', () => {
    const plain = generateCharacter(did, { skin: 'one', shape: 'red', animated: false });
    const dressed = generateCharacter(did, { skin: 'one', shape: 'red', animated: false, finish: 'flat', eyePlacement: 'raised', accessories: ['glasses', 'headphones'] });
    expect(dressed).toMatchObject({ finish: 'flat', eyePlacement: 'raised', accessories: ['glasses', 'headphones'] });
    const body = (svg: string) => svg.slice(svg.indexOf('<g data-character-body'));
    expect(body(dressed.svg)).toBe(body(plain.svg));
    expect(dressed.svg).not.toMatch(/data-character-accessory|data-character-eye-mount|<filter/);
  });

  it('never embeds animation, whatever the animated option says', () => {
    const animated = generateCharacter(did, { skin: 'one', state: { status: 'working' } });
    const still = generateCharacter(did, { skin: 'one', animated: false, state: { status: 'working' } });
    expect(animated.animated).toBe(true);
    expect(animated.svg).toBe(still.svg);
    expect(animated.svg).not.toMatch(/<animate/);
  });

  it('applies an explicit blink to the held face', () => {
    const open = generateCharacter(did, { skin: 'one', shape: 'blue', state: { blink: 0 } });
    const shut = generateCharacter(did, { skin: 'one', shape: 'blue', state: { blink: 1 } });
    const bar = (svg: string) => svg.match(/data-one-eye="true" d="([^"]+)"/)![1];
    expect(bar(shut.svg)).toBe(eye.barPath(eye.barShape(eye.poseToFrame({ ...oneHeldPose('neutral', { x: 0, y: 0 }, 512), open: 0 })).n));
    expect(bar(open.svg)).not.toBe(bar(shut.svg));
  });

  it('lists the One family in the catalog with its thirteen kinds and its own eye style', () => {
    const family = getCharacterSkins().find(entry => entry.id === 'one')!;
    expect(family).toEqual({ id: 'one', label: 'One', version: 1, eyeStyles: ['agent-eye-v1'], shapes: ONE_KINDS, expressions: getCharacterExpressions() });
    expect(getCharacterSkins().at(-1)).toBe(family);
    for (const entry of getCharacterSkins()) if (entry.id !== 'one') expect(entry.eyeStyles).toEqual(['live-v1']);
  });

  it('refuses an eye style that belongs to another family, in options, stored appearance and descriptors', () => {
    expect(generateCharacter(did, { skin: 'one' }).eyeStyle).toBe('agent-eye-v1');
    expect(generateCharacter(did, { skin: 'one', eyeStyle: 'agent-eye-v1' }).eyeStyle).toBe('agent-eye-v1');
    expect(generateCharacter(did).eyeStyle).toBe('live-v1');
    expect(() => generateCharacter(did, { skin: 'one', eyeStyle: 'live-v1' })).toThrow('Unsupported eye style for character skin');
    expect(() => generateCharacter(did, { skin: 'autos', eyeStyle: 'agent-eye-v1' })).toThrow('Unsupported eye style for character skin');
    expect(parseCharacterAppearance({ skin: 'one', eyeStyle: 'agent-eye-v1', shape: 'teal' })).toEqual({ skin: 'one', eyeStyle: 'agent-eye-v1', shape: 'teal' });
    expect(() => parseCharacterAppearance({ skin: 'one', eyeStyle: 'live-v1' })).toThrow();
    expect(() => parseCharacterAppearance({ skin: 'autos', eyeStyle: 'agent-eye-v1' })).toThrow();
  });
});

describe('One colours by group', () => {
  it('repeats from the thirteenth agent with the least-held colour whose holders sit in another group', () => {
    const mixed = order.map((color, index) => ({ color, group: index % 2 ? 'company' : 'team' }));
    expect(nextOneColor(mixed, { group: 'team' })).toBe('red');
    expect(nextOneColor(mixed, { group: 'company' })).toBe('blue');
    // Fewest holders first; among those, another group; then the order.
    const red = [...mixed, { color: 'red' as const, group: 'company' }];
    expect(nextOneColor(red, { group: 'team' })).toBe('green');
    // Everyone in one group: the least held, by the order. A holder with no group is never another group.
    expect(nextOneColor(order.map(color => ({ color, group: 'team' })), { group: 'team' })).toBe('blue');
    expect(nextOneColor([...order], { group: 'team' })).toBe('blue');
    // Free colours always come first, whatever the groups.
    expect(nextOneColor([{ color: 'blue', group: 'company' }], { group: 'team' })).toBe('red');
    // Without a group the rule is the plain one.
    expect(nextOneColor(mixed)).toBe('blue');
  });

  it('refuses malformed holders and options', () => {
    const bad: unknown[][] = [[{ color: 'blue', group: '' }], [{ color: 'blue', extra: 1 }], [{ color: 'orange' }], [{ group: 'team' }], [['blue']],
      [{ color: 'blue', group: 'x'.repeat(201) }]];
    for (const held of bad) expect(() => nextOneColor(held as OneColor[])).toThrow();
    for (const options of [{ group: '' }, { group: 5 }, { other: 1 }, null, []]) expect(() => nextOneColor([], options as never)).toThrow();
  });
});

describe('the light One entry', () => {
  it('renders the same still glyph as generateCharacter for the One family', () => {
    for (const kind of ONE_KINDS) for (const theme of ['light', 'dark'] as const) for (const size of [16, 44, 96]) {
      for (const state of [{}, { status: 'paused', gaze: row }, { status: 'reasoning', expression: 'curious', blink: 0.3 }] as const) {
        const options = { size, theme, state, label: 'Scout, agent' };
        expect(renderOne({ did, color: kind, ...options })).toBe(generateCharacter(did, { skin: 'one', shape: kind, ...options }).svg);
      }
    }
    expect(renderOne({ did })).toBe(generateCharacter(did, { skin: 'one' }).svg);
    expect(renderOne({ did, expression: 'happy' })).toBe(generateCharacter(did, { skin: 'one', expression: 'happy' }).svg);
  });

  it('renders a blank head for a ready-made agent without a DID, and never stores or assigns one', () => {
    const blank = renderOne({ color: 'blank', size: 40, state: { gaze: row } });
    expect(blank).toContain('data-one-color="blank"');
    expect(blank).toContain('<circle data-one-disc="true" r="100" fill="#141b16" fill-opacity="0.1"/>');
    expect(blank).toContain('fill="#5a6256"');
    expect(blank).not.toContain('data-character-seed');
    expect(renderOne({ color: 'blank', theme: 'dark' })).toContain('fill="#f2f1ea" fill-opacity="0.1"');
    expect(ONE_KINDS).not.toContain('blank');
    expect(() => parseCharacterAppearance({ skin: 'one', shape: 'blank' })).toThrow();
    expect(() => generateCharacter(did, { skin: 'one', shape: 'blank' as never })).toThrow();
  });

  it('validates its options and fails closed', () => {
    for (const options of [{}, { did: 'did:oas:openagent:tool:hammer' }, { color: 'orange' }, { did, size: 15 }, { did, size: 2049 },
      { did, theme: 'dim' }, { did, label: '' }, { did, view: 'full' }, { did, shape: 'teal' }, { did, state: { status: 'flying' } }, null]) {
      expect(() => renderOne(options as never)).toThrow();
    }
    expect(() => mountOne({} as never, { color: 'teal' })).toThrow('One head requires a browser element');
  });
});

describe('One on the clock-driven animator', () => {
  it('holds still at rest and moves only on a state change, ending on the held face', () => {
    const animator = createCharacterAnimator(did, { skin: 'one', shape: 'teal', size: 44, now: () => 0, state: { gaze: row } });
    const rest = animator.sample(0).one!;
    expect(rest).toMatchObject({ face: 'neutral', tier: 'M', moving: false });
    for (let t = 0; t <= 20_000; t += 500) expect(animator.sample(t).one!.moving).toBe(false);
    animator.update({ status: 'attention' }, 20_000);
    expect(animator.sample(20_100).one!.moving).toBe(true);
    const frame = animator.sample(30_000).one!;
    expect(frame).toMatchObject({ face: 'attention', moving: false });
    expect(frame.pose).toEqual(oneHeldPose('attention', row, 44));
  });

  it('moves for at most five seconds of brief cadence for every temperament and size, then holds', () => {
    // red quick, yellow bouncy, blue neat, green slow, charcoal dry.
    for (const shape of ['red', 'yellow', 'blue', 'green', 'charcoal'] as const) for (const size of [24, 44, 96]) {
      for (const status of ['working', 'reasoning', 'typing'] as const) for (const subject of ['did:oas:openagent:agent:a', 'did:oas:openagent:agent:b', did]) {
        const animator = createCharacterAnimator(subject, { skin: 'one', shape, size, now: () => 0, state: { gaze: row } });
        animator.update({ status }, 1000);
        let lastMoving = 0;
        for (let t = 1000; t <= 12_000; t += 10) if (animator.sample(t).one!.moving) lastMoving = t;
        expect(lastMoving, `${shape} ${size} ${status}`).toBeGreaterThan(1300);
        expect(lastMoving, `${shape} ${size} ${status}`).toBeLessThanOrEqual(1000 + 5000);
        expect(animator.sample(25_000).one!.moving).toBe(false);
      }
    }
  });

  it('replays identically for the same DID and clock', () => {
    const run = () => {
      const animator = createCharacterAnimator(did, { skin: 'one', shape: 'pink', size: 96, cadence: 'repeat', now: () => 0, state: { gaze: row } });
      animator.update({ status: 'typing' }, 0);
      const out: string[] = [];
      for (let t = 0; t < 30_000; t += 50) out.push(animator.sample(t).one!.geometry.bar);
      return out;
    };
    const first = run();
    expect(run()).toEqual(first);
    expect(new Set(first).size).toBeGreaterThan(3);
  });

  it('has no motion under reduced motion, and resumes when allowed', () => {
    const animator = createCharacterAnimator(did, { skin: 'one', size: 64, reducedMotion: true, now: () => 0, state: { gaze: row } });
    animator.update({ status: 'error' }, 10);
    expect(animator.sample(20).one).toMatchObject({ face: 'error', moving: false });
    expect(animator.sample(20).one!.pose).toEqual(oneHeldPose('error', row, 64));
    animator.setReducedMotion(false, 30);
    animator.update({ status: 'success' }, 40);
    expect(animator.sample(100).one!.moving).toBe(true);
  });

  it('validates One live options', () => {
    for (const options of [{ cadence: 'often' }, { cadence: null }, { voiceLevel: 1 }, { voiceLevel: 'loud' }]) {
      expect(() => createCharacterAnimator(did, { skin: 'one', ...options } as never)).toThrow();
    }
    expect(createCharacterAnimator(did, { now: () => 0 }).sample(0).one).toBeUndefined();
  });
});
