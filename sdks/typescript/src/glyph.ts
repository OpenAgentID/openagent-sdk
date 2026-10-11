/** OAS Glyph v1 avatar encoding, ported from OpenAgentID/oas-glyph f0090dd. */
import { blake3 } from '@noble/hashes/blake3';
import { base58 } from '@scure/base';
import { didSchema } from './config.js';

export interface GlyphOptions {
  /** Square pixel dimensions, 32–2048. Geometry is independent of size. */
  size?: number;
  /** Transparent background when false. */
  background?: boolean;
}

export interface AgentAvatar {
  /** Optional user/agent-selected HTTPS image. Clearing it restores the glyph. */
  avatarOverride?: string | null;
}

const encoder = new TextEncoder();
const kinds = ['hmr', 'mhr', 'ao', 'agent', 'agent:instance', 'tool', 'skill', 'workflow', 'model', 'dataset', 'service'];
type Color = readonly [number, number, number];
type CellType = 'finder' | 'kind' | 'alignment' | 'format' | 'data';

function parts(did: string): { namespace: string; kind: number; identifier: string } {
  didSchema.parse(did);
  const fields = did.split(':');
  const legacy = fields[1] === 'l1fe';
  const namespace = legacy ? 'l1fe' : fields[2]!;
  const offset = legacy ? 2 : 3;
  const kind = fields.slice(offset, -1).join(':');
  // The older SDK used `enr` for the organization root kind.
  const code = kinds.indexOf(kind === 'enr' ? 'ao' : kind);
  if (code < 0) throw new Error('Unsupported OAS Glyph entity kind');
  return { namespace, kind: code, identifier: fields.at(-1)! };
}

/** Compact payload and BLAKE3 detection parity matching upstream glyph format v1.
 * This parity is not Reed–Solomon correction and is never authentication proof.
 */
export function glyphCodeword(did: string): Uint8Array {
  const parsed = parts(did);
  const encoded = parsed.identifier.startsWith('z') ? parsed.identifier.slice(1) : parsed.identifier;
  let identifier: Uint8Array;
  let version = 1;
  if (parsed.identifier.startsWith('z')) {
    // Explicit multibase identities must be valid; malformed keys are refused.
    identifier = base58.decode(encoded);
    if (identifier.length === 0 || identifier.length > 43) throw new Error('Glyph multibase identifier must encode 1–43 bytes');
  } else {
    try { identifier = base58.decode(encoded); } catch { identifier = new Uint8Array(); }
    if (identifier.length === 0 || identifier.length > 43) {
      // Legacy opaque/named identities are still readable. Avatar profile v2
      // uses a domain-separated full-DID digest, not a decodable key payload.
      version = 2;
      identifier = blake3(encoder.encode('oas-glyph-avatar-v2\u0000' + did));
    }
  }
  const raw = Uint8Array.from([(version << 4) | parsed.kind, blake3(encoder.encode(parsed.namespace))[0]!, identifier.length, ...identifier]);
  const payload = Uint8Array.from([...raw, ...blake3(raw).slice(0, 4)]);
  const parityLength = Math.max(4, Math.ceil(payload.length * 0.30 / 0.70));
  const parityInput = Uint8Array.from([...payload, ...encoder.encode(version === 1 ? 'oas-glyph-ecc-v1' : 'oas-glyph-avatar-parity-v2')]);
  const parity = blake3(parityInput, { dkLen: parityLength });
  const codeword = Uint8Array.from([...payload, ...parity]);
  // The actual upstream layout has 96 data cells, rather than the 120
  // estimated in its introductory comment. Refuse overflow explicitly.
  if (Math.ceil(codeword.length * 8 / 6) > 96) throw new Error('DID exceeds OAS Glyph v1 grid capacity');
  return codeword;
}

function hsl(hue: number, saturation: number, lightness: number): Color {
  const h = hue / 360;
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  function channel(t: number): number {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    const value = t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    return Math.floor(Math.max(0, Math.min(1, value)) * 255);
  }
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

const hex = (color: Color): string => '#' + color.map(v => v.toString(16).padStart(2, '0')).join('');
function lerp(a: Color, b: Color, t: number): Color {
  return a.map((v, i) => Math.floor(v + (b[i]! - v) * t)) as unknown as Color;
}
function palette(did: string) {
  const bytes = blake3(encoder.encode(did));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const primary = view.getUint32(0, true) / 0xffffffff * 360;
  const secondary = (primary + 60 + view.getUint32(4, true) / 0xffffffff * 120) % 360;
  const saturation = 0.5 + bytes[8]! / 255 * 0.4;
  const lightness = 0.35 + bytes[9]! / 255 * 0.2;
  return {
    background: hsl(primary, saturation * 0.15, 0.08),
    secondary: hsl(secondary, saturation, lightness),
    data: [hsl(primary, saturation, lightness + 0.15), hsl((primary + 30) % 360, saturation, lightness), hsl((primary + 60) % 360, saturation, lightness - 0.1), hsl(secondary, saturation * 0.8, lightness + 0.05)],
    dark: hsl(primary, saturation * 0.3, 0.12),
    light: hsl(primary, saturation * 0.2, 0.85),
    accent: hsl(secondary, 0.9, 0.6),
  };
}

function cellType(row: number, col: number): CellType {
  if ((row < 3 && (col < 3 || col >= 9)) || (row >= 9 && col >= 9)) return 'finder';
  if (row >= 9 && col < 3) return 'kind';
  if (row === 6 && col === 6) return 'alignment';
  if ((row === 3 && col >= 3 && col < 9) || (col === 3 && row >= 3 && row < 9)) return 'format';
  return 'data';
}

function sixBits(codeword: Uint8Array): number[] {
  const values: number[] = [];
  let buffer = 0, bits = 0;
  for (const byte of codeword) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 6) { bits -= 6; values.push((buffer >>> bits) & 63); }
  }
  if (bits) values.push((buffer << (6 - bits)) & 63);
  return values;
}

/** Deterministic SVG avatar. No network calls, private keys or raw DID markup. */
export function oasGlyph(did: string, options: GlyphOptions = {}): string {
  const size = options.size ?? 512;
  if (!Number.isInteger(size) || size < 32 || size > 2048) throw new Error('Glyph size must be an integer from 32 to 2048');
  if (options.background !== undefined && typeof options.background !== 'boolean') throw new Error('Invalid glyph background');
  const { kind } = parts(did);
  const values = sixBits(glyphCodeword(did));
  const colors = palette(did);
  // Fixed viewBox preserves geometry and caching across display dimensions.
  const svg: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}" role="img"><title>OAS Glyph</title>`];
  if (options.background !== false) svg.push(`<rect x="0" y="0" width="512" height="512" rx="16" fill="${hex(colors.background)}"/>`);
  const kindPatterns = [[48, 63, 48, 63, 63, 63, 48, 63, 48], [63, 0, 63, 0, 63, 0, 63, 0, 63], [21, 63, 21, 63, 21, 63, 21, 63, 21]];
  const multipliers = [3, 5, 7, 11, 13, 17, 19, 23, 29];
  const cell = 464 / 12;
  const f = (n: number): string => n.toFixed(1);
  let dataIndex = 0;
  for (let row = 0; row < 12; row++) for (let col = 0; col < 12; col++) {
    const type = cellType(row, col);
    const x = 24 + col * cell, y = 24 + row * cell;
    let value = 0;
    if (type === 'finder') value = row % 3 === 1 && col % 3 === 1 ? 63 : 42;
    if (type === 'kind') value = kindPatterns[kind]?.[(row - 9) * 3 + col] ?? (kind * 17 * multipliers[(row - 9) * 3 + col]!) & 63;
    if (type === 'data') { value = values[dataIndex] ?? (row * 12 + col) % 64; dataIndex++; }
    const rect = (color: Color, radius: number): string => `<rect x="${f(x + 0.75)}" y="${f(y + 0.75)}" width="${f(cell - 1.5)}" height="${f(cell - 1.5)}" rx="${radius}" fill="${hex(color)}"/>`;
    if (type === 'finder') svg.push(rect(value > 32 ? colors.dark : colors.light, 2));
    else if (type === 'kind') svg.push(rect(lerp(colors.background, colors.accent, value / 63), 1));
    else if (type === 'format') svg.push(rect(colors.background, 0));
    else if (type === 'alignment') {
      const cx = x + cell / 2, cy = y + cell / 2, r = cell / 2 - 1;
      svg.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${hex(colors.light)}"/><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 0.5)}" fill="${hex(colors.dark)}"/>`);
    } else {
      const block = cell * [0.35, 0.55, 0.75, 0.95][(value >> 4) & 3]!;
      const offset = (cell - block) / 2, half = block / 2;
      const cx = x + cell / 2, cy = y + cell / 2, fill = hex(colors.data[value & 3]!);
      switch ((value >> 2) & 3) {
        case 0: svg.push(`<rect x="${f(x + offset)}" y="${f(y + offset)}" width="${f(block)}" height="${f(block)}" rx="${f(Math.max(block * 0.1, 1))}" fill="${fill}"/>`); break;
        case 1: svg.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(half)}" fill="${fill}"/>`); break;
        case 2: svg.push(`<polygon points="${f(cx)},${f(cy - half)} ${f(cx + half)},${f(cy)} ${f(cx)},${f(cy + half)} ${f(cx - half)},${f(cy)}" fill="${fill}"/>`); break;
        case 3: svg.push(`<polygon points="${f(cx)},${f(cy - half)} ${f(cx + half)},${f(cy + half * 0.7)} ${f(cx - half)},${f(cy + half * 0.7)}" fill="${fill}"/>`); break;
      }
    }
  }
  return svg.join('') + '</svg>';
}

export function parseAvatarOverride(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid avatar override');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Avatar override must be an HTTPS URL without credentials');
  return url.href;
}

/** Return an external override or a self-contained deterministic SVG data URL. */
export function agentAvatar(did: string, profile: AgentAvatar = {}, options?: GlyphOptions): string {
  didSchema.parse(did);
  const override = parseAvatarOverride(profile.avatarOverride);
  return override ?? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(oasGlyph(did, options));
}

/** GET /v1/glyph/svg/:did. This endpoint always renders identity-derived pixels;
 * profile overrides are resolved by the caller, never fetched by this service.
 */
export function glyphEndpoint(request: Request): Response {
  const headers = { 'content-security-policy': "default-src 'none'; style-src 'none'; sandbox", 'x-content-type-options': 'nosniff' };
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { ...headers, allow: 'GET, HEAD' } });
  try {
    const url = new URL(request.url);
    const prefix = '/v1/glyph/svg/';
    if (!url.pathname.startsWith(prefix)) return new Response(null, { status: 404, headers });
    const did = decodeURIComponent(url.pathname.slice(prefix.length));
    const size = url.searchParams.has('size') ? Number(url.searchParams.get('size')) : 512;
    if (url.searchParams.get('background') !== null && !['true', 'false'].includes(url.searchParams.get('background')!)) throw new Error('Invalid background');
    const svg = oasGlyph(did, { size, background: url.searchParams.get('background') !== 'false' });
    const etag = '"' + [...blake3(encoder.encode(svg))].map(v => v.toString(16).padStart(2, '0')).join('') + '"';
    const responseHeaders = { ...headers, 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=31536000, immutable', etag };
    if (request.headers.get('if-none-match')?.split(',').map(v => v.trim()).includes(etag)) return new Response(null, { status: 304, headers: responseHeaders });
    return new Response(request.method === 'HEAD' ? null : svg, { headers: responseHeaders });
  } catch {
    return Response.json({ error: 'invalid_glyph_request' }, { status: 400, headers: { ...headers, 'cache-control': 'no-store' } });
  }
}
