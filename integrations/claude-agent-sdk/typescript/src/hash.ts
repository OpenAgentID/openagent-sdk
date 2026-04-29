/**
 * Cryptographic hashing utilities used by the audit chain.
 *
 * We prefer BLAKE3 (matches the rest of the OpenAgent ecosystem) but fall
 * back to Node's built-in SHA-256 when BLAKE3 is not installed. The hash
 * function name is recorded in audit metadata so verifiers know which
 * primitive was used.
 */

import { createHash, type BinaryLike } from 'node:crypto';

/** Identifier for the hash primitive in use. */
export type HashAlgo = 'blake3' | 'sha256';

let cachedAlgo: HashAlgo | null = null;
// Adapter seam: BLAKE3 implementation is loaded lazily so the package has
// no hard runtime dep on the `blake3` npm module.
type Blake3Module = { hash: (input: Uint8Array | string) => Uint8Array };
let cachedBlake3: Blake3Module | null = null;

/**
 * Resolve which hash algorithm to use, attempting to load `blake3` once.
 * Subsequent calls are cached.
 */
export function getHashAlgo(): HashAlgo {
  if (cachedAlgo !== null) return cachedAlgo;
  try {
    // Adapter seam: dynamic require so bundlers don't fail when blake3 is absent.
    const req: NodeRequire | undefined =
      typeof require === 'function'
        ? (require as NodeRequire)
        : // eslint-disable-next-line @typescript-eslint/no-require-imports
          undefined;
    if (req) {
      const mod = req('blake3') as Blake3Module;
      if (mod && typeof mod.hash === 'function') {
        cachedBlake3 = mod;
        cachedAlgo = 'blake3';
        return cachedAlgo;
      }
    }
  } catch {
    // ignore — we'll fall through to sha256
  }
  cachedAlgo = 'sha256';
  return cachedAlgo;
}

/** Hash a string or byte buffer and return lowercase hex. */
export function hashHex(data: string | Uint8Array): string {
  const algo = getHashAlgo();
  if (algo === 'blake3' && cachedBlake3) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const out = cachedBlake3.hash(bytes);
    return bufferToHex(out);
  }
  const h = createHash('sha256');
  h.update(data as BinaryLike);
  return h.digest('hex');
}

/** Stable JSON stringify (sorted keys) for deterministic hashing. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, sortKeys(v)] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = v;
    return out;
  }
  return value;
}

function bufferToHex(buf: Uint8Array): string {
  let s = '';
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i] ?? 0;
    s += v.toString(16).padStart(2, '0');
  }
  return s;
}

/** Test-only: reset the cached hash algorithm. */
export function __resetHashCacheForTests(): void {
  cachedAlgo = null;
  cachedBlake3 = null;
}
