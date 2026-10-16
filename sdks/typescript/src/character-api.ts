import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { generateCharacter, getCharacterExpressions, getCharacterSkins, getCharacterStatuses, isAgentAvatarDid, type CharacterOptions } from './characters.js';
import { getCharacterAccessories, parseCharacterAccessories } from './character-accessories.js';

export interface CharacterApiHandlerOptions {
  /** The complete mount path, without a trailing slash. Default: /v1/characters. */
  readonly basePath?: string;
}

const DEFAULT_BASE_PATH = '/v1/characters';
const MAX_BODY_BYTES = 16_384;
const MAX_URL_LENGTH = 8192;
const encoder = new TextEncoder();
const queryKeys = new Set(['skin', 'skinVersion', 'eyeStyle', 'finish', 'eyePlacement', 'shape', 'view', 'accessories', 'expression', 'status', 'size', 'animated', 'blink', 'gazeX', 'gazeY', 'theme']);
// The SDK's label option is deliberately absent: the public API renders decorative heads and never echoes caller text.
const optionKeys = new Set(['did', 'skin', 'skinVersion', 'eyeStyle', 'finish', 'eyePlacement', 'shape', 'view', 'accessories', 'expression', 'size', 'animated', 'state', 'theme']);
const numericQuery = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

class CharacterRequestError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

function invalid(): never {
  throw new CharacterRequestError(400, 'invalid_request');
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  if (Object.keys(value).some(key => !allowed.has(key))) invalid();
}

function agentDid(value: unknown): string {
  if (!isAgentAvatarDid(value)) invalid();
  return value;
}

function boundedNumber(value: unknown, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max ||
      (integer && !Number.isSafeInteger(value))) invalid();
  return value;
}

function member<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) invalid();
  return value as T;
}

function characterOptions(value: Record<string, unknown>): CharacterOptions {
  onlyKeys(value, optionKeys);
  const skin = member(value.skin === undefined ? 'autos' : value.skin, getCharacterSkins().map(entry => entry.id));
  const result: { -readonly [Key in keyof CharacterOptions]: CharacterOptions[Key] } = { skin };
  if ('skinVersion' in value) {
    if (value.skinVersion !== 1) invalid();
    result.skinVersion = 1;
  }
  if ('eyeStyle' in value) {
    result.eyeStyle = member(value.eyeStyle, getCharacterSkins().find(entry => entry.id === skin)!.eyeStyles);
  }
  if ('shape' in value) {
    result.shape = member(value.shape, getCharacterSkins().find(entry => entry.id === skin)!.shapes);
  }
  if ('finish' in value) result.finish = member(value.finish, ['plush', 'flat'] as const);
  if ('eyePlacement' in value) result.eyePlacement = member(value.eyePlacement, ['face', 'raised'] as const);
  if ('view' in value) result.view = member(value.view, ['avatar', 'full'] as const);
  if ('theme' in value) result.theme = member(value.theme, ['light', 'dark'] as const);
  if ('accessories' in value) result.accessories = parseCharacterAccessories(value.accessories);
  if ('expression' in value) result.expression = member(value.expression, getCharacterExpressions());
  if ('size' in value) result.size = boundedNumber(value.size, skin === 'one' ? 16 : 32, 2048, true);
  if ('animated' in value) {
    if (typeof value.animated !== 'boolean') invalid();
    result.animated = value.animated;
  }
  if ('state' in value) {
    if (!object(value.state)) invalid();
    onlyKeys(value.state, new Set(['blink', 'gaze', 'expression', 'status']));
    const state: { -readonly [Key in keyof NonNullable<CharacterOptions['state']>]: NonNullable<CharacterOptions['state']>[Key] } = {};
    if ('expression' in value.state) state.expression = member(value.state.expression, getCharacterExpressions());
    if ('status' in value.state) state.status = member(value.state.status, getCharacterStatuses().map(entry => entry.status));
    if ('blink' in value.state) state.blink = boundedNumber(value.state.blink, 0, 1);
    if ('gaze' in value.state) {
      if (!object(value.state.gaze)) invalid();
      onlyKeys(value.state.gaze, new Set(['x', 'y']));
      state.gaze = {
        x: boundedNumber(value.state.gaze.x, -1, 1),
        y: boundedNumber(value.state.gaze.y, -1, 1),
      };
    }
    result.state = state;
  }
  return result;
}

function queryOptions(query: URLSearchParams): CharacterOptions {
  const values: Record<string, unknown> = {};
  for (const [key, value] of query) {
    if (!queryKeys.has(key) || Object.hasOwn(values, key)) invalid();
    values[key] = value;
  }
  const input: Record<string, unknown> = {};
  for (const key of ['skin', 'eyeStyle', 'finish', 'eyePlacement', 'shape', 'view', 'expression', 'theme']) {
    if (key in values) input[key] = values[key];
  }
  if ('accessories' in values) {
    if (typeof values.accessories !== 'string') invalid();
    input.accessories = values.accessories === '' ? [] : values.accessories.split(',');
  }
  if ('skinVersion' in values) {
    if (values.skinVersion !== '1') invalid();
    input.skinVersion = 1;
  }
  if ('size' in values) {
    if (typeof values.size !== 'string' || !/^(?:0|[1-9]\d*)$/.test(values.size)) invalid();
    input.size = Number(values.size);
  }
  if ('animated' in values) {
    if (values.animated !== 'true' && values.animated !== 'false') invalid();
    input.animated = values.animated === 'true';
  }
  const number = (key: string): number => {
    const value = values[key];
    if (typeof value !== 'string' || !numericQuery.test(value)) invalid();
    return Number(value);
  };
  const state: Record<string, unknown> = {};
  if ('status' in values) state.status = values.status;
  if ('blink' in values) state.blink = number('blink');
  if (('gazeX' in values) !== ('gazeY' in values)) invalid();
  if ('gazeX' in values) state.gaze = { x: number('gazeX'), y: number('gazeY') };
  if (Object.keys(state).length > 0) input.state = state;
  return characterOptions(input);
}

async function readBody(request: Request): Promise<unknown> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) invalid();
    if (contentLength.length > 10 || Number(contentLength) > MAX_BODY_BYTES) {
      throw new CharacterRequestError(413, 'body_too_large');
    }
  }
  if (!request.body) invalid();
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let chunks = 0;
  let text = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (++chunks > MAX_BODY_BYTES) invalid();
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new CharacterRequestError(413, 'body_too_large');
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function headers(methods: string, svg = false): Headers {
  const result = new Headers({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': methods,
    'access-control-allow-headers': 'Content-Type, If-None-Match',
    'access-control-expose-headers': 'ETag, Content-Length',
    'x-content-type-options': 'nosniff',
  });
  if (svg) result.set('content-security-policy', "default-src 'none'; img-src 'none'; style-src 'none'; sandbox");
  return result;
}

function matchesEtag(value: string | null, etag: string): boolean {
  if (value === null || value.length > 4096) return false;
  return value.split(',').some(candidate => {
    const tag = candidate.trim();
    return tag === '*' || tag === etag || tag === `W/${etag}`;
  });
}

function representation(request: Request, body: string, type: string, methods: string, cacheable: boolean): Response {
  const bytes = encoder.encode(body);
  const result = headers(methods, type.startsWith('image/svg+xml'));
  result.set('content-type', type);
  result.set('cache-control', cacheable ? 'public, max-age=3600, must-revalidate' : 'no-store');
  if (cacheable) {
    const etag = `"${bytesToHex(sha256(bytes))}"`;
    result.set('etag', etag);
    if (matchesEtag(request.headers.get('if-none-match'), etag)) {
      return new Response(null, { status: 304, headers: result });
    }
  }
  result.set('content-length', String(bytes.byteLength));
  return new Response(request.method === 'HEAD' ? null : body, { headers: result });
}

function errorResponse(request: Request, status: number, error: string, methods: string): Response {
  const body = JSON.stringify({ error });
  const result = headers(methods);
  result.set('cache-control', 'no-store');
  result.set('content-type', 'application/json; charset=utf-8');
  result.set('content-length', String(encoder.encode(body).byteLength));
  if (status === 405) result.set('allow', methods);
  return new Response(request.method === 'HEAD' ? null : body, { status, headers: result });
}

/**
 * Unauthenticated, stateless decoration only. This handler never resolves,
 * registers, authenticates or verifies the requested agent identity.
 */
export function createCharacterApiHandler(
  options: CharacterApiHandlerOptions = {},
): (request: Request) => Promise<Response> {
  const basePath = options.basePath ?? DEFAULT_BASE_PATH;
  if (typeof basePath !== 'string' || basePath.length > 256 ||
      !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(basePath)) {
    throw new TypeError('Character API basePath must be an absolute mount path without a trailing slash');
  }
  const openapi = JSON.stringify({ ...characterApiOpenApi, servers: [{ url: basePath }] });
  return async request => {
    let methods = 'GET, HEAD, POST, OPTIONS';
    try {
      if (request.url.length > MAX_URL_LENGTH) invalid();
      const url = new URL(request.url);
      if (!url.pathname.startsWith(`${basePath}/`)) return errorResponse(request, 404, 'not_found', methods);
      const path = url.pathname.slice(basePath.length + 1);
      const generate = path === 'generate';
      const catalog = path === 'skins';
      const accessories = path === 'accessories';
      const statuses = path === 'statuses';
      const schema = path === 'openapi.json';
      const svg = path.startsWith('svg/');
      const rawDid = svg ? path.slice(4) : path;
      if (!generate && !catalog && !accessories && !statuses && !schema && (rawDid.includes('/') || !rawDid)) {
        return errorResponse(request, 404, 'not_found', methods);
      }
      // Reserved routes are handled before the DID route. Every request is
      // still schema-checked before rendering or issuing cache validators.
      methods = generate ? 'POST, OPTIONS' : 'GET, HEAD, OPTIONS';
      if (request.method === 'OPTIONS') {
        if (generate || catalog || accessories || statuses || schema) {
          if (url.search) invalid();
        } else {
          agentDid(decodeURIComponent(rawDid));
          queryOptions(url.searchParams);
        }
        const result = headers(methods);
        result.set('access-control-max-age', '86400');
        return new Response(null, { status: 204, headers: result });
      }
      if (generate ? request.method !== 'POST' : request.method !== 'GET' && request.method !== 'HEAD') {
        return errorResponse(request, 405, 'method_not_allowed', methods);
      }
      if (generate || catalog || accessories || statuses || schema) {
        if (url.search) invalid();
      }
      if (catalog || accessories || statuses || schema) {
        const body = catalog ? JSON.stringify(getCharacterSkins()) : accessories ? JSON.stringify(getCharacterAccessories())
          : statuses ? JSON.stringify(getCharacterStatuses()) : openapi;
        return representation(request, body, 'application/json; charset=utf-8', methods, true);
      }
      if (generate) {
        if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.test(
          request.headers.get('content-type')?.trim() ?? '',
        ) || ![null, 'identity'].includes(request.headers.get('content-encoding'))) {
          throw new CharacterRequestError(415, 'unsupported_media_type');
        }
        const body = await readBody(request);
        if (!object(body)) invalid();
        const did = agentDid(body.did);
        const character = generateCharacter(did, characterOptions(body));
        return representation(request, JSON.stringify(character), 'application/json; charset=utf-8', methods, false);
      }
      const did = agentDid(decodeURIComponent(rawDid));
      const character = generateCharacter(did, queryOptions(url.searchParams));
      return representation(request, svg ? character.svg : JSON.stringify(character),
        svg ? 'image/svg+xml; charset=utf-8' : 'application/json; charset=utf-8', methods, true);
    } catch (error) {
      return errorResponse(request, error instanceof CharacterRequestError ? error.status : 400,
        error instanceof CharacterRequestError ? error.code : 'invalid_request', methods);
    }
  };
}

/** Bundled OpenAPI 3.1 contract; mirrored in docs/character-api.openapi.json. */
export const characterApiOpenApi = {
  "openapi": "3.1.0",
  "info": {
    "title": "OpenAgentID Character API",
    "version": "0.8.0",
    "description": "Public, unauthenticated stateless deterministic agent decoration. Autos is the default rounded pill family. The catalog contains 18 families and 75 distinct character kinds, including Halloween, Thanksgiving, Christmas and One. Avatar rendering frames the face by default; view=full restores the complete character. Skin controls body and face geometry; expressions are shared across skins, and the two-eyed families share live-v1 eyes. This API neither mints identities nor verifies possession, ownership, lineage, revocation or permissions. No secrets, external assets, JavaScript, CSS or fonts. Every response including errors and 304 includes wildcard CORS; credentials are not required. Unknown and duplicate query parameters are rejected. Input, streamed body chunks and geometry are bounded; hosted infrastructure supplies request rate and duration limits. Runtime state resolves state.expression before status mapping, then outer preferred expression, then neutral. Status is presentation state only and establishes no agent activity or authority. Independent glasses and headphones can be combined on every family. Accessories default to an empty selection, do not change identity-derived shape/color or live-eye state, and normalize to catalog order. Unknown, duplicate or malformed selections are refused. Every family supports shared finish (plush default, flat optional) and eyePlacement (face default, raised optional). These strictly closed appearance selectors do not change identity-derived shape/color or runtime state. Descriptors include both resolved values. The One family is a disc with one bar for an eye, drawn only from agent-eye geometry (eye style agent-eye-v1): its kinds are twelve agent colours and charcoal (Digital One), and an omitted kind selects one of the twelve colours from the DID. A One renders the held face of its resolved state as a still glyph without animation or element identifiers, decorative (aria-hidden), at 16\u20132048 px, and keeps finish, eyePlacement and accessories in the descriptor without drawing them. theme selects light (default) or dark surface tones; it is presentation only, is never stored appearance, and changes only the One family today."
  },
  "servers": [
    {
      "url": "/v1/characters"
    }
  ],
  "security": [],
  "paths": {
    "/skins": {
      "get": {
        "summary": "List versioned character skins",
        "parameters": [
          {
            "$ref": "#/components/parameters/IfNoneMatch"
          }
        ],
        "x-reject-unknown-query-parameters": true,
        "x-reject-duplicate-query-parameters": true,
        "responses": {
          "200": {
            "description": "Deterministic representation; public max-age=3600, must-revalidate.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Content-Length": {
                "$ref": "#/components/headers/ContentLength"
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/CharacterSkinV1"
                  }
                }
              }
            }
          },
          "304": {
            "description": "Matching validator, no body. CORS, ETag and SVG security headers are preserved.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Content-Length": {
                "$ref": "#/components/headers/ContentLength"
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/InvalidRequest"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "405": {
            "$ref": "#/components/responses/MethodNotAllowed"
          }
        }
      },
      "head": {
        "summary": "Headers for list versioned character skins",
        "parameters": [
          {
            "$ref": "#/components/parameters/IfNoneMatch"
          }
        ],
        "x-reject-unknown-query-parameters": true,
        "x-reject-duplicate-query-parameters": true,
        "description": "Same status, headers and Content-Length as GET, no response body.",
        "responses": {
          "200": {
            "description": "Deterministic representation; public max-age=3600, must-revalidate.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Content-Length": {
                "$ref": "#/components/headers/ContentLength"
              }
            }
          },
          "304": {
            "description": "Matching validator, no body. CORS, ETag and SVG security headers are preserved.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Content-Length": {
                "$ref": "#/components/headers/ContentLength"
              }
            }
          },
          "400": {
            "description": "Invalid request, no body.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              }
            }
          },
          "404": {
            "description": "Not found, no body.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              }
            }
          },
          "405": {
            "description": "Not allowed, no body.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "Allow": {
                "schema": {
                  "type": "string"
                }
              }
            }
          }
        }
      },
      "options": {
        "summary": "Public CORS preflight",
        "parameters": [],
        "responses": {
          "204": {
            "description": "No body; schema-valid requests can be made cross-origin without credentials.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "Access-Control-Allow-Methods": {
                "schema": {
                  "type": "string",
                  "const": "GET, HEAD, OPTIONS"
                }
              },
              "Access-Control-Allow-Headers": {
                "schema": {
                  "type": "string",
                  "const": "Content-Type, If-None-Match"
                }
              },
              "Access-Control-Max-Age": {
                "schema": {
                  "type": "integer",
                  "const": 86400
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/InvalidRequest"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "405": {
            "$ref": "#/components/responses/MethodNotAllowed"
          }
        }
      }
    },
    "/statuses": {
      "get": {
        "summary": "List runtime status-to-expression mappings",
        "parameters": [
          {
            "$ref": "#/components/parameters/IfNoneMatch"
          }
        ],
        "x-reject-unknown-query-parameters": true,
        "x-reject-duplicate-query-parameters": true,
        "responses": {
          "200": {
            "description": "Deterministic representation; public max-age=3600, must-revalidate.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Content-Length": {
                "$ref": "#/components/headers/ContentLength"
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/CharacterStatusV1"
                  },
                  "minItems": 26,
                  "maxItems": 26,
                  "description": "Immutable SDK mapping catalog serialized as JSON, including all expressions and runtime aliases."
                }
              }
            }
          },
          "304": {
            "description": "Matching validator, no body. CORS, ETag and SVG security headers are preserved.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Content-Length": {
                "$ref": "#/components/headers/ContentLength"
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/InvalidRequest"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "405": {
            "$ref": "#/components/responses/MethodNotAllowed"
          }
        }
      },
      "head": {
        "summary": "Headers for runtime status-to-expression mappings",
        "parameters": [
          {
            "$ref": "#/components/parameters/IfNoneMatch"
          }
        ],
        "x-reject-unknown-query-parameters": true,
        "x-reject-duplicate-query-parameters": true,
        "description": "Same status, headers and Content-Length as GET, no response body.",
        "responses": {
          "200": {
            "description": "Deterministic representation; public max-age=3600, must-revalidate.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Content-Length": {
                "$ref": "#/components/headers/ContentLength"
              }
            }
          },
          "304": {
            "description": "Matching validator, no body. CORS, ETag and SVG security headers are preserved.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Content-Length": {
                "$ref": "#/components/headers/ContentLength"
              }
            }
          },
          "400": {
            "description": "Invalid request, no body.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              }
            }
          },
          "404": {
            "description": "Not found, no body.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              }
            }
          },
          "405": {
            "description": "Not allowed, no body.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "Allow": {
                "schema": {
                  "type": "string"
                }
              }
            }
          }
        }
      },
      "options": {
        "summary": "Public CORS preflight",
        "parameters": [],
        "responses": {
          "204": {
            "description": "No body; schema-valid requests can be made cross-origin without credentials.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "Access-Control-Allow-Methods": {
                "schema": {
                  "type": "string",
                  "const": "GET, HEAD, OPTIONS"
                }
              },
              "Access-Control-Allow-Headers": {
                "schema": {
                  "type": "string",
                  "const": "Content-Type, If-None-Match"
                }
              },
              "Access-Control-Max-Age": {
                "schema": {
                  "type": "integer",
                  "const": 86400
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/InvalidRequest"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "405": {
            "$ref": "#/components/responses/MethodNotAllowed"
          }
        }
      }
    },
    "/svg/{did}": {
      "get": {
        "summary": "Render a character SVG",
        "parameters": [
          {
            "$ref": "#/components/parameters/did"
          },
          {
            "$ref": "#/components/parameters/skin"
          },
          {
            "$ref": "#/components/parameters/skinVersion"
          },
          {
            "$ref": "#/components/parameters/eyeStyle"
          },
          {
            "$ref": "#/components/parameters/size"
          },
          {
            "$ref": "#/components/parameters/animated"
          },
          {
            "$ref": "#/components/parameters/blink"
          },
          {
            "$ref": "#/components/parameters/gazeX"
          },
          {
            "$ref": "#/components/parameters/gazeY"
          },
          {
            "$ref": "#/components/parameters/IfNoneMatch"
          },
          {
            "$ref": "#/components/parameters/shape"
          },
          {
            "$ref": "#/components/parameters/expression"
          },
          {
            "$ref": "#/components/parameters/status"
          },
          {
            "$ref": "#/components/parameters/view"
          },
          {
            "$ref": "#/components/parameters/accessories"
          },
          {
            "$ref": "#/components/parameters/finish"
          },
          {
            "$ref": "#/components/parameters/eyePlacement"
          },
          {
            "$ref": "#/components/parameters/theme"
          }
        ],
        "x-reject-unknown-query-parameters": true,
        "x-reject-duplicate-query-parameters": true,
        "responses": {
          "200": {
            "description": "Deterministic representation; public max-age=3600, must-revalidate.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Content-Length": {
                "$ref": "#/components/headers/ContentLength"
              },
              "Content-Security-Policy": {
                "$ref": "#/components/headers/SvgCsp"
              }
            },
            "content": {
              "image/svg+xml": {
                "schema": {
                  "type": "string"
                }
              }
            }
          },
          "304": {
            "description": "Matching validator, no body. CORS, ETag and SVG security headers are preserved.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Content-Length": {
                "$ref": "#/components/headers/ContentLength"
              },
              "Content-Security-Policy": {
                "$ref": "#/components/headers/SvgCsp"
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/InvalidRequest"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "405": {
            "$ref": "#/components/responses/MethodNotAllowed"
          }
        }
      },
      "head": {
        "summary": "Headers for render a character svg",
        "parameters": [
          {
            "$ref": "#/components/parameters/did"
          },
          {
            "$ref": "#/components/parameters/skin"
          },
          {
            "$ref": "#/components/parameters/skinVersion"
          },
          {
            "$ref": "#/components/parameters/eyeStyle"
          },
          {
            "$ref": "#/components/parameters/size"
          },
          {
            "$ref": "#/components/parameters/animated"
          },
          {
            "$ref": "#/components/parameters/blink"
          },
          {
            "$ref": "#/components/parameters/gazeX"
          },
          {
            "$ref": "#/components/parameters/gazeY"
          },
          {
            "$ref": "#/components/parameters/IfNoneMatch"
          },
          {
            "$ref": "#/components/parameters/shape"
          },
          {
            "$ref": "#/components/parameters/expression"
          },
          {
            "$ref": "#/components/parameters/status"
          },
          {
            "$ref": "#/components/parameters/view"
          },
          {
            "$ref": "#/components/parameters/accessories"
          },
          {
            "$ref": "#/components/parameters/finish"
          },
          {
            "$ref": "#/components/parameters/eyePlacement"
          },
          {
            "$ref": "#/components/parameters/theme"
          }
        ],
        "x-reject-unknown-query-parameters": true,
        "x-reject-duplicate-query-parameters": true,
        "description": "Same status, headers and Content-Length as GET, no response body.",
        "responses": {
          "200": {
            "description": "Deterministic representation; public max-age=3600, must-revalidate.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Content-Length": {
                "$ref": "#/components/headers/ContentLength"
              },
              "Content-Security-Policy": {
                "$ref": "#/components/headers/SvgCsp"
              }
            }
          },
          "304": {
            "description": "Matching validator, no body. CORS, ETag and SVG security headers are preserved.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Content-Length": {
                "$ref": "#/components/headers/ContentLength"
              },
              "Content-Security-Policy": {
                "$ref": "#/components/headers/SvgCsp"
              }
            }
          },
          "400": {
            "description": "Invalid request, no body.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              }
            }
          },
          "404": {
            "description": "Not found, no body.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              }
            }
          },
          "405": {
            "description": "Not allowed, no body.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "Allow": {
                "schema": {
                  "type": "string"
                }
              }
            }
          }
        }
      },
      "options": {
        "summary": "Public CORS preflight",
        "parameters": [
          {
            "$ref": "#/components/parameters/did"
          },
          {
            "$ref": "#/components/parameters/skin"
          },
          {
            "$ref": "#/components/parameters/skinVersion"
          },
          {
            "$ref": "#/components/parameters/eyeStyle"
          },
          {
            "$ref": "#/components/parameters/size"
          },
          {
            "$ref": "#/components/parameters/animated"
          },
          {
            "$ref": "#/components/parameters/blink"
          },
          {
            "$ref": "#/components/parameters/gazeX"
          },
          {
            "$ref": "#/components/parameters/gazeY"
          },
          {
            "$ref": "#/components/parameters/shape"
          },
          {
            "$ref": "#/components/parameters/expression"
          },
          {
            "$ref": "#/components/parameters/status"
          },
          {
            "$ref": "#/components/parameters/view"
          },
          {
            "$ref": "#/components/parameters/accessories"
          },
          {
            "$ref": "#/components/parameters/finish"
          },
          {
            "$ref": "#/components/parameters/eyePlacement"
          },
          {
            "$ref": "#/components/parameters/theme"
          }
        ],
        "responses": {
          "204": {
            "description": "No body; schema-valid requests can be made cross-origin without credentials.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "Access-Control-Allow-Methods": {
                "schema": {
                  "type": "string",
                  "const": "GET, HEAD, OPTIONS"
                }
              },
              "Access-Control-Allow-Headers": {
                "schema": {
                  "type": "string",
                  "const": "Content-Type, If-None-Match"
                }
              },
              "Access-Control-Max-Age": {
                "schema": {
                  "type": "integer",
                  "const": 86400
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/InvalidRequest"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "405": {
            "$ref": "#/components/responses/MethodNotAllowed"
          }
        }
      }
    },
    "/{did}": {
      "get": {
        "summary": "Generate a character descriptor",
        "parameters": [
          {
            "$ref": "#/components/parameters/did"
          },
          {
            "$ref": "#/components/parameters/skin"
          },
          {
            "$ref": "#/components/parameters/skinVersion"
          },
          {
            "$ref": "#/components/parameters/eyeStyle"
          },
          {
            "$ref": "#/components/parameters/size"
          },
          {
            "$ref": "#/components/parameters/animated"
          },
          {
            "$ref": "#/components/parameters/blink"
          },
          {
            "$ref": "#/components/parameters/gazeX"
          },
          {
            "$ref": "#/components/parameters/gazeY"
          },
          {
            "$ref": "#/components/parameters/IfNoneMatch"
          },
          {
            "$ref": "#/components/parameters/shape"
          },
          {
            "$ref": "#/components/parameters/expression"
          },
          {
            "$ref": "#/components/parameters/status"
          },
          {
            "$ref": "#/components/parameters/view"
          },
          {
            "$ref": "#/components/parameters/accessories"
          },
          {
            "$ref": "#/components/parameters/finish"
          },
          {
            "$ref": "#/components/parameters/eyePlacement"
          },
          {
            "$ref": "#/components/parameters/theme"
          }
        ],
        "x-reject-unknown-query-parameters": true,
        "x-reject-duplicate-query-parameters": true,
        "responses": {
          "200": {
            "description": "Deterministic representation; public max-age=3600, must-revalidate.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Content-Length": {
                "$ref": "#/components/headers/ContentLength"
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/CharacterDescriptorV1"
                }
              }
            }
          },
          "304": {
            "description": "Matching validator, no body. CORS, ETag and SVG security headers are preserved.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Content-Length": {
                "$ref": "#/components/headers/ContentLength"
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/InvalidRequest"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "405": {
            "$ref": "#/components/responses/MethodNotAllowed"
          }
        }
      },
      "head": {
        "summary": "Headers for generate a character descriptor",
        "parameters": [
          {
            "$ref": "#/components/parameters/did"
          },
          {
            "$ref": "#/components/parameters/skin"
          },
          {
            "$ref": "#/components/parameters/skinVersion"
          },
          {
            "$ref": "#/components/parameters/eyeStyle"
          },
          {
            "$ref": "#/components/parameters/size"
          },
          {
            "$ref": "#/components/parameters/animated"
          },
          {
            "$ref": "#/components/parameters/blink"
          },
          {
            "$ref": "#/components/parameters/gazeX"
          },
          {
            "$ref": "#/components/parameters/gazeY"
          },
          {
            "$ref": "#/components/parameters/IfNoneMatch"
          },
          {
            "$ref": "#/components/parameters/shape"
          },
          {
            "$ref": "#/components/parameters/expression"
          },
          {
            "$ref": "#/components/parameters/status"
          },
          {
            "$ref": "#/components/parameters/view"
          },
          {
            "$ref": "#/components/parameters/accessories"
          },
          {
            "$ref": "#/components/parameters/finish"
          },
          {
            "$ref": "#/components/parameters/eyePlacement"
          },
          {
            "$ref": "#/components/parameters/theme"
          }
        ],
        "x-reject-unknown-query-parameters": true,
        "x-reject-duplicate-query-parameters": true,
        "description": "Same status, headers and Content-Length as GET, no response body.",
        "responses": {
          "200": {
            "description": "Deterministic representation; public max-age=3600, must-revalidate.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Content-Length": {
                "$ref": "#/components/headers/ContentLength"
              }
            }
          },
          "304": {
            "description": "Matching validator, no body. CORS, ETag and SVG security headers are preserved.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Content-Length": {
                "$ref": "#/components/headers/ContentLength"
              }
            }
          },
          "400": {
            "description": "Invalid request, no body.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              }
            }
          },
          "404": {
            "description": "Not found, no body.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              }
            }
          },
          "405": {
            "description": "Not allowed, no body.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "Allow": {
                "schema": {
                  "type": "string"
                }
              }
            }
          }
        }
      },
      "options": {
        "summary": "Public CORS preflight",
        "parameters": [
          {
            "$ref": "#/components/parameters/did"
          },
          {
            "$ref": "#/components/parameters/skin"
          },
          {
            "$ref": "#/components/parameters/skinVersion"
          },
          {
            "$ref": "#/components/parameters/eyeStyle"
          },
          {
            "$ref": "#/components/parameters/size"
          },
          {
            "$ref": "#/components/parameters/animated"
          },
          {
            "$ref": "#/components/parameters/blink"
          },
          {
            "$ref": "#/components/parameters/gazeX"
          },
          {
            "$ref": "#/components/parameters/gazeY"
          },
          {
            "$ref": "#/components/parameters/shape"
          },
          {
            "$ref": "#/components/parameters/expression"
          },
          {
            "$ref": "#/components/parameters/status"
          },
          {
            "$ref": "#/components/parameters/view"
          },
          {
            "$ref": "#/components/parameters/accessories"
          },
          {
            "$ref": "#/components/parameters/finish"
          },
          {
            "$ref": "#/components/parameters/eyePlacement"
          },
          {
            "$ref": "#/components/parameters/theme"
          }
        ],
        "responses": {
          "204": {
            "description": "No body; schema-valid requests can be made cross-origin without credentials.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "Access-Control-Allow-Methods": {
                "schema": {
                  "type": "string",
                  "const": "GET, HEAD, OPTIONS"
                }
              },
              "Access-Control-Allow-Headers": {
                "schema": {
                  "type": "string",
                  "const": "Content-Type, If-None-Match"
                }
              },
              "Access-Control-Max-Age": {
                "schema": {
                  "type": "integer",
                  "const": 86400
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/InvalidRequest"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "405": {
            "$ref": "#/components/responses/MethodNotAllowed"
          }
        }
      }
    },
    "/generate": {
      "post": {
        "summary": "Generate a character descriptor from JSON",
        "description": "Stateless and unauthenticated; no query parameters. Unknown fields are rejected at every level. Streamed body size is checked independently of Content-Length.",
        "x-max-body-bytes": 16384,
        "x-reject-unknown-query-parameters": true,
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/CharacterGenerateRequestV1"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Generated descriptor; no-store, no ETag.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/CharacterDescriptorV1"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/InvalidRequest"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "405": {
            "$ref": "#/components/responses/MethodNotAllowed"
          },
          "413": {
            "$ref": "#/components/responses/BodyTooLarge"
          },
          "415": {
            "$ref": "#/components/responses/UnsupportedMediaType"
          }
        }
      },
      "options": {
        "summary": "Public CORS preflight",
        "parameters": [],
        "responses": {
          "204": {
            "description": "No body; schema-valid requests can be made cross-origin without credentials.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "Access-Control-Allow-Methods": {
                "schema": {
                  "type": "string",
                  "const": "POST, OPTIONS"
                }
              },
              "Access-Control-Allow-Headers": {
                "schema": {
                  "type": "string",
                  "const": "Content-Type, If-None-Match"
                }
              },
              "Access-Control-Max-Age": {
                "schema": {
                  "type": "integer",
                  "const": 86400
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/InvalidRequest"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "405": {
            "$ref": "#/components/responses/MethodNotAllowed"
          }
        }
      }
    },
    "/openapi.json": {
      "get": {
        "summary": "Read this OpenAPI schema",
        "parameters": [
          {
            "$ref": "#/components/parameters/IfNoneMatch"
          }
        ],
        "x-reject-unknown-query-parameters": true,
        "x-reject-duplicate-query-parameters": true,
        "responses": {
          "200": {
            "description": "Deterministic representation; public max-age=3600, must-revalidate.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Content-Length": {
                "$ref": "#/components/headers/ContentLength"
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "description": "OpenAPI 3.1 document; servers[0].url reflects the configured mount path."
                }
              }
            }
          },
          "304": {
            "description": "Matching validator, no body. CORS, ETag and SVG security headers are preserved.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Content-Length": {
                "$ref": "#/components/headers/ContentLength"
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/InvalidRequest"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "405": {
            "$ref": "#/components/responses/MethodNotAllowed"
          }
        }
      },
      "head": {
        "summary": "Headers for read this openapi schema",
        "parameters": [
          {
            "$ref": "#/components/parameters/IfNoneMatch"
          }
        ],
        "x-reject-unknown-query-parameters": true,
        "x-reject-duplicate-query-parameters": true,
        "description": "Same status, headers and Content-Length as GET, no response body.",
        "responses": {
          "200": {
            "description": "Deterministic representation; public max-age=3600, must-revalidate.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Content-Length": {
                "$ref": "#/components/headers/ContentLength"
              }
            }
          },
          "304": {
            "description": "Matching validator, no body. CORS, ETag and SVG security headers are preserved.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Content-Length": {
                "$ref": "#/components/headers/ContentLength"
              }
            }
          },
          "400": {
            "description": "Invalid request, no body.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              }
            }
          },
          "404": {
            "description": "Not found, no body.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              }
            }
          },
          "405": {
            "description": "Not allowed, no body.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "Allow": {
                "schema": {
                  "type": "string"
                }
              }
            }
          }
        }
      },
      "options": {
        "summary": "Public CORS preflight",
        "parameters": [],
        "responses": {
          "204": {
            "description": "No body; schema-valid requests can be made cross-origin without credentials.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "Access-Control-Allow-Methods": {
                "schema": {
                  "type": "string",
                  "const": "GET, HEAD, OPTIONS"
                }
              },
              "Access-Control-Allow-Headers": {
                "schema": {
                  "type": "string",
                  "const": "Content-Type, If-None-Match"
                }
              },
              "Access-Control-Max-Age": {
                "schema": {
                  "type": "integer",
                  "const": 86400
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/InvalidRequest"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "405": {
            "$ref": "#/components/responses/MethodNotAllowed"
          }
        }
      }
    },
    "/accessories": {
      "get": {
        "summary": "List combinable character accessories",
        "parameters": [
          {
            "$ref": "#/components/parameters/IfNoneMatch"
          }
        ],
        "x-reject-unknown-query-parameters": true,
        "x-reject-duplicate-query-parameters": true,
        "responses": {
          "200": {
            "description": "Deterministic representation; public max-age=3600, must-revalidate.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Content-Length": {
                "$ref": "#/components/headers/ContentLength"
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/CharacterAccessoryDescriptionV1"
                  }
                }
              }
            }
          },
          "304": {
            "description": "Matching validator, no body. CORS, ETag and SVG security headers are preserved.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Content-Length": {
                "$ref": "#/components/headers/ContentLength"
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/InvalidRequest"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "405": {
            "$ref": "#/components/responses/MethodNotAllowed"
          }
        }
      },
      "head": {
        "summary": "Headers for the character accessory catalog",
        "parameters": [
          {
            "$ref": "#/components/parameters/IfNoneMatch"
          }
        ],
        "x-reject-unknown-query-parameters": true,
        "x-reject-duplicate-query-parameters": true,
        "description": "Same status, headers and Content-Length as GET, no response body.",
        "responses": {
          "200": {
            "description": "Deterministic representation; public max-age=3600, must-revalidate.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Content-Length": {
                "$ref": "#/components/headers/ContentLength"
              }
            }
          },
          "304": {
            "description": "Matching validator, no body. CORS, ETag and SVG security headers are preserved.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "ETag": {
                "$ref": "#/components/headers/ETag"
              },
              "Content-Length": {
                "$ref": "#/components/headers/ContentLength"
              }
            }
          },
          "400": {
            "description": "Invalid request, no body.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              }
            }
          },
          "404": {
            "description": "Not found, no body.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              }
            }
          },
          "405": {
            "description": "Not allowed, no body.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "Allow": {
                "schema": {
                  "type": "string"
                }
              }
            }
          }
        }
      },
      "options": {
        "summary": "Preflight for the character accessory catalog",
        "parameters": [],
        "responses": {
          "204": {
            "description": "No body; schema-valid requests can be made cross-origin without credentials.",
            "headers": {
              "Access-Control-Allow-Origin": {
                "$ref": "#/components/headers/CorsOrigin"
              },
              "Access-Control-Expose-Headers": {
                "$ref": "#/components/headers/CorsExpose"
              },
              "X-Content-Type-Options": {
                "$ref": "#/components/headers/NoSniff"
              },
              "Cache-Control": {
                "$ref": "#/components/headers/CacheControl"
              },
              "Access-Control-Allow-Methods": {
                "schema": {
                  "type": "string",
                  "const": "GET, HEAD, OPTIONS"
                }
              },
              "Access-Control-Allow-Headers": {
                "schema": {
                  "type": "string",
                  "const": "Content-Type, If-None-Match"
                }
              },
              "Access-Control-Max-Age": {
                "schema": {
                  "type": "integer",
                  "const": 86400
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/InvalidRequest"
          },
          "404": {
            "$ref": "#/components/responses/NotFound"
          },
          "405": {
            "$ref": "#/components/responses/MethodNotAllowed"
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "AgentDid": {
        "type": "string",
        "maxLength": 512,
        "pattern": "^did:(?:(?:oas:[a-z0-9][a-z0-9-]{0,63}|l1fe):agent(?::instance)?:[A-Za-z0-9._-]+|oas:agent-instance:[0-7][0-9A-HJKMNP-TV-Z]{25})(?![\\s\\S])",
        "description": "Existing agent or agent:instance DID, including the literal IAM did:oas:agent-instance:<canonical uppercase ULID> avatar format. Generation preserves the assigned DID and neither verifies nor registers a principal; authentication schemas are unchanged."
      },
      "CharacterAppearanceV1": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "skin"
        ],
        "properties": {
          "skin": {
            "type": "string",
            "enum": [
              "autos",
              "spacex",
              "fold",
              "sprig",
              "ripple",
              "halo",
              "purl",
              "prism",
              "coil",
              "kiln",
              "wisp",
              "relay",
              "cairn",
              "tuft",
              "halloween",
              "thanksgiving",
              "christmas",
              "one"
            ],
            "default": "autos"
          },
          "skinVersion": {
            "type": "integer",
            "const": 1,
            "default": 1
          },
          "eyeStyle": {
            "$ref": "#/components/schemas/CharacterEyeStyle"
          },
          "shape": {
            "type": "string",
            "enum": [
              "standard",
              "slender",
              "wide",
              "circle",
              "pebble",
              "squircle",
              "capsule",
              "triangle",
              "hexagon",
              "cloud",
              "droplet",
              "kite",
              "fan",
              "bud",
              "leaf",
              "drop",
              "wave",
              "comet",
              "satellite",
              "mitt",
              "hood",
              "crystal",
              "obelisk",
              "spring",
              "bellows",
              "vase",
              "teapot",
              "flame",
              "curl",
              "radio",
              "beacon",
              "tower",
              "arch",
              "pom",
              "bear",
              "pumpkin",
              "ghost",
              "bat",
              "witch-hat",
              "candy-corn",
              "turkey",
              "acorn",
              "squash",
              "pie",
              "corn",
              "light",
              "tree",
              "snowman",
              "ornament",
              "gift",
              "blue",
              "red",
              "sky",
              "green",
              "yellow",
              "pink",
              "plum",
              "teal",
              "lime",
              "mint",
              "lilac",
              "coral",
              "charcoal"
            ],
            "description": "Optional body override; must belong to the selected skin. Omitted shape is deterministically selected from the DID and skin."
          },
          "accessories": {
            "$ref": "#/components/schemas/CharacterAccessoriesV1"
          },
          "finish": {
            "$ref": "#/components/schemas/CharacterFinish"
          },
          "eyePlacement": {
            "$ref": "#/components/schemas/CharacterEyePlacement"
          }
        },
        "allOf": [
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "autos"
                }
              }
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "slender",
                    "wide"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "spacex"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "circle",
                    "pebble",
                    "squircle",
                    "capsule",
                    "triangle",
                    "hexagon",
                    "cloud",
                    "droplet"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "fold"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "kite",
                    "fan"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "sprig"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "bud",
                    "leaf"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "ripple"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "drop",
                    "wave"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "halo"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "comet",
                    "satellite"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "purl"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "mitt",
                    "hood"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "prism"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "crystal",
                    "obelisk"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "coil"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "spring",
                    "bellows"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "kiln"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "vase",
                    "teapot"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "wisp"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "flame",
                    "curl"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "relay"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "radio",
                    "beacon"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "cairn"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "tower",
                    "arch"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "tuft"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "pom",
                    "bear"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "halloween"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "pumpkin",
                    "ghost",
                    "bat",
                    "witch-hat",
                    "candy-corn"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "thanksgiving"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "turkey",
                    "acorn",
                    "squash",
                    "pie",
                    "corn"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "christmas"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "light",
                    "tree",
                    "snowman",
                    "ornament",
                    "gift"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "one"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "blue",
                    "red",
                    "sky",
                    "green",
                    "yellow",
                    "pink",
                    "plum",
                    "teal",
                    "lime",
                    "mint",
                    "lilac",
                    "coral",
                    "charcoal"
                  ]
                },
                "eyeStyle": {
                  "const": "agent-eye-v1"
                }
              }
            }
          }
        ]
      },
      "GazeV1": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "x",
          "y"
        ],
        "properties": {
          "x": {
            "type": "number",
            "minimum": -1,
            "maximum": 1,
            "default": 0
          },
          "y": {
            "type": "number",
            "minimum": -1,
            "maximum": 1,
            "default": 0
          }
        }
      },
      "LiveEyeStateV1": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "blink": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
            "default": 0
          },
          "gaze": {
            "$ref": "#/components/schemas/GazeV1"
          },
          "status": {
            "$ref": "#/components/schemas/AvatarStatus",
            "description": "Runtime status alias or literal expression. Overrides the outer preferred expression."
          },
          "expression": {
            "$ref": "#/components/schemas/AvatarExpression",
            "description": "Explicit runtime expression; overrides state.status mapping and outer preferred expression. Null is not accepted by this stateless API."
          }
        },
        "description": "Optional stateless snapshot. Resolution: state.expression > state.status mapping > outer expression > neutral. Unknown fields and null values are refused."
      },
      "CharacterOptionsV1": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "skin": {
            "type": "string",
            "enum": [
              "autos",
              "spacex",
              "fold",
              "sprig",
              "ripple",
              "halo",
              "purl",
              "prism",
              "coil",
              "kiln",
              "wisp",
              "relay",
              "cairn",
              "tuft",
              "halloween",
              "thanksgiving",
              "christmas",
              "one"
            ],
            "default": "autos"
          },
          "skinVersion": {
            "type": "integer",
            "const": 1,
            "default": 1
          },
          "eyeStyle": {
            "$ref": "#/components/schemas/CharacterEyeStyle"
          },
          "size": {
            "type": "integer",
            "minimum": 16,
            "maximum": 2048,
            "default": 512,
            "description": "Square pixel size: 16\u20132048 for the One family, 32\u20132048 for every other family."
          },
          "animated": {
            "type": "boolean",
            "default": true,
            "description": "Native SMIL animation with no JavaScript or CSS."
          },
          "state": {
            "$ref": "#/components/schemas/LiveEyeStateV1"
          },
          "shape": {
            "type": "string",
            "enum": [
              "standard",
              "slender",
              "wide",
              "circle",
              "pebble",
              "squircle",
              "capsule",
              "triangle",
              "hexagon",
              "cloud",
              "droplet",
              "kite",
              "fan",
              "bud",
              "leaf",
              "drop",
              "wave",
              "comet",
              "satellite",
              "mitt",
              "hood",
              "crystal",
              "obelisk",
              "spring",
              "bellows",
              "vase",
              "teapot",
              "flame",
              "curl",
              "radio",
              "beacon",
              "tower",
              "arch",
              "pom",
              "bear",
              "pumpkin",
              "ghost",
              "bat",
              "witch-hat",
              "candy-corn",
              "turkey",
              "acorn",
              "squash",
              "pie",
              "corn",
              "light",
              "tree",
              "snowman",
              "ornament",
              "gift",
              "blue",
              "red",
              "sky",
              "green",
              "yellow",
              "pink",
              "plum",
              "teal",
              "lime",
              "mint",
              "lilac",
              "coral",
              "charcoal"
            ],
            "description": "Optional body override; must belong to the selected skin. Omitted shape is deterministically selected from the DID and skin."
          },
          "expression": {
            "type": "string",
            "enum": [
              "neutral",
              "attentive",
              "surprised",
              "excited",
              "happy",
              "laughing",
              "angry",
              "sad",
              "scared",
              "suspicious",
              "confused",
              "curious",
              "proud",
              "shy",
              "unimpressed",
              "sleepy",
              "thoughtful",
              "concerned"
            ],
            "default": "neutral",
            "description": "Outer preferred expression fallback. Explicit state.expression wins, then state.status mapping, then this preference, then neutral."
          },
          "view": {
            "type": "string",
            "enum": [
              "avatar",
              "full"
            ],
            "default": "avatar",
            "description": "Face crop for avatars by default; full shows the complete body. Rendering only, independent of stored appearance and runtime eye state."
          },
          "accessories": {
            "$ref": "#/components/schemas/CharacterAccessoriesV1"
          },
          "finish": {
            "$ref": "#/components/schemas/CharacterFinish"
          },
          "eyePlacement": {
            "$ref": "#/components/schemas/CharacterEyePlacement"
          },
          "theme": {
            "$ref": "#/components/schemas/CharacterTheme"
          }
        },
        "allOf": [
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "autos"
                }
              }
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "slender",
                    "wide"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "spacex"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "circle",
                    "pebble",
                    "squircle",
                    "capsule",
                    "triangle",
                    "hexagon",
                    "cloud",
                    "droplet"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "fold"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "kite",
                    "fan"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "sprig"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "bud",
                    "leaf"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "ripple"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "drop",
                    "wave"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "halo"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "comet",
                    "satellite"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "purl"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "mitt",
                    "hood"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "prism"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "crystal",
                    "obelisk"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "coil"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "spring",
                    "bellows"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "kiln"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "vase",
                    "teapot"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "wisp"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "flame",
                    "curl"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "relay"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "radio",
                    "beacon"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "cairn"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "tower",
                    "arch"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "tuft"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "pom",
                    "bear"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "halloween"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "pumpkin",
                    "ghost",
                    "bat",
                    "witch-hat",
                    "candy-corn"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "thanksgiving"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "turkey",
                    "acorn",
                    "squash",
                    "pie",
                    "corn"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "christmas"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "light",
                    "tree",
                    "snowman",
                    "ornament",
                    "gift"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "one"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "blue",
                    "red",
                    "sky",
                    "green",
                    "yellow",
                    "pink",
                    "plum",
                    "teal",
                    "lime",
                    "mint",
                    "lilac",
                    "coral",
                    "charcoal"
                  ]
                },
                "eyeStyle": {
                  "const": "agent-eye-v1"
                }
              }
            }
          }
        ]
      },
      "CharacterGenerateRequestV1": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "did"
        ],
        "properties": {
          "did": {
            "$ref": "#/components/schemas/AgentDid"
          },
          "skin": {
            "type": "string",
            "enum": [
              "autos",
              "spacex",
              "fold",
              "sprig",
              "ripple",
              "halo",
              "purl",
              "prism",
              "coil",
              "kiln",
              "wisp",
              "relay",
              "cairn",
              "tuft",
              "halloween",
              "thanksgiving",
              "christmas",
              "one"
            ],
            "default": "autos"
          },
          "skinVersion": {
            "type": "integer",
            "const": 1,
            "default": 1
          },
          "eyeStyle": {
            "$ref": "#/components/schemas/CharacterEyeStyle"
          },
          "size": {
            "type": "integer",
            "minimum": 16,
            "maximum": 2048,
            "default": 512,
            "description": "Square pixel size: 16\u20132048 for the One family, 32\u20132048 for every other family."
          },
          "animated": {
            "type": "boolean",
            "default": true,
            "description": "Native SMIL animation with no JavaScript or CSS."
          },
          "state": {
            "$ref": "#/components/schemas/LiveEyeStateV1"
          },
          "shape": {
            "type": "string",
            "enum": [
              "standard",
              "slender",
              "wide",
              "circle",
              "pebble",
              "squircle",
              "capsule",
              "triangle",
              "hexagon",
              "cloud",
              "droplet",
              "kite",
              "fan",
              "bud",
              "leaf",
              "drop",
              "wave",
              "comet",
              "satellite",
              "mitt",
              "hood",
              "crystal",
              "obelisk",
              "spring",
              "bellows",
              "vase",
              "teapot",
              "flame",
              "curl",
              "radio",
              "beacon",
              "tower",
              "arch",
              "pom",
              "bear",
              "pumpkin",
              "ghost",
              "bat",
              "witch-hat",
              "candy-corn",
              "turkey",
              "acorn",
              "squash",
              "pie",
              "corn",
              "light",
              "tree",
              "snowman",
              "ornament",
              "gift",
              "blue",
              "red",
              "sky",
              "green",
              "yellow",
              "pink",
              "plum",
              "teal",
              "lime",
              "mint",
              "lilac",
              "coral",
              "charcoal"
            ],
            "description": "Optional body override; must belong to the selected skin. Omitted shape is deterministically selected from the DID and skin."
          },
          "expression": {
            "type": "string",
            "enum": [
              "neutral",
              "attentive",
              "surprised",
              "excited",
              "happy",
              "laughing",
              "angry",
              "sad",
              "scared",
              "suspicious",
              "confused",
              "curious",
              "proud",
              "shy",
              "unimpressed",
              "sleepy",
              "thoughtful",
              "concerned"
            ],
            "default": "neutral",
            "description": "Outer preferred expression fallback. Explicit state.expression wins, then state.status mapping, then this preference, then neutral."
          },
          "view": {
            "type": "string",
            "enum": [
              "avatar",
              "full"
            ],
            "default": "avatar",
            "description": "Face crop for avatars by default; full shows the complete body. Rendering only, independent of stored appearance and runtime eye state."
          },
          "accessories": {
            "$ref": "#/components/schemas/CharacterAccessoriesV1"
          },
          "finish": {
            "$ref": "#/components/schemas/CharacterFinish"
          },
          "eyePlacement": {
            "$ref": "#/components/schemas/CharacterEyePlacement"
          },
          "theme": {
            "$ref": "#/components/schemas/CharacterTheme"
          }
        },
        "allOf": [
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "autos"
                }
              }
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "slender",
                    "wide"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "spacex"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "circle",
                    "pebble",
                    "squircle",
                    "capsule",
                    "triangle",
                    "hexagon",
                    "cloud",
                    "droplet"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "fold"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "kite",
                    "fan"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "sprig"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "bud",
                    "leaf"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "ripple"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "drop",
                    "wave"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "halo"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "comet",
                    "satellite"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "purl"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "mitt",
                    "hood"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "prism"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "crystal",
                    "obelisk"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "coil"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "spring",
                    "bellows"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "kiln"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "vase",
                    "teapot"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "wisp"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "flame",
                    "curl"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "relay"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "radio",
                    "beacon"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "cairn"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "tower",
                    "arch"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "tuft"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "pom",
                    "bear"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "halloween"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "pumpkin",
                    "ghost",
                    "bat",
                    "witch-hat",
                    "candy-corn"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "thanksgiving"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "turkey",
                    "acorn",
                    "squash",
                    "pie",
                    "corn"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "christmas"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "light",
                    "tree",
                    "snowman",
                    "ornament",
                    "gift"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "one"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "blue",
                    "red",
                    "sky",
                    "green",
                    "yellow",
                    "pink",
                    "plum",
                    "teal",
                    "lime",
                    "mint",
                    "lilac",
                    "coral",
                    "charcoal"
                  ]
                },
                "eyeStyle": {
                  "const": "agent-eye-v1"
                }
              }
            }
          }
        ]
      },
      "CharacterDescriptorV1": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "did",
          "skin",
          "skinVersion",
          "eyeStyle",
          "shape",
          "color",
          "size",
          "animated",
          "state",
          "svg",
          "expression",
          "view",
          "accessories",
          "finish",
          "eyePlacement",
          "theme"
        ],
        "properties": {
          "did": {
            "$ref": "#/components/schemas/AgentDid"
          },
          "skin": {
            "type": "string",
            "enum": [
              "autos",
              "spacex",
              "fold",
              "sprig",
              "ripple",
              "halo",
              "purl",
              "prism",
              "coil",
              "kiln",
              "wisp",
              "relay",
              "cairn",
              "tuft",
              "halloween",
              "thanksgiving",
              "christmas",
              "one"
            ],
            "default": "autos"
          },
          "skinVersion": {
            "type": "integer",
            "const": 1,
            "default": 1
          },
          "eyeStyle": {
            "$ref": "#/components/schemas/CharacterEyeStyle"
          },
          "size": {
            "type": "integer",
            "minimum": 16,
            "maximum": 2048,
            "default": 512,
            "description": "Square pixel size: 16\u20132048 for the One family, 32\u20132048 for every other family."
          },
          "animated": {
            "type": "boolean",
            "default": true,
            "description": "Native SMIL animation with no JavaScript or CSS."
          },
          "state": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "blink",
              "gaze"
            ],
            "properties": {
              "blink": {
                "type": "number",
                "minimum": 0,
                "maximum": 1,
                "default": 0
              },
              "gaze": {
                "$ref": "#/components/schemas/GazeV1"
              },
              "status": {
                "$ref": "#/components/schemas/AvatarStatus"
              },
              "expression": {
                "$ref": "#/components/schemas/AvatarExpression"
              }
            },
            "description": "Normalized blink/gaze, retaining status/expression only when explicitly supplied in input state. Descriptor.expression is the resolved expression; old snapshots without state status/expression preserve their prior shape."
          },
          "color": {
            "type": "string",
            "pattern": "^#[0-9a-fA-F]{6}$"
          },
          "svg": {
            "type": "string",
            "description": "Escaped, self-contained SVG on a transparent background. No external resources, JavaScript, CSS or fonts."
          },
          "shape": {
            "type": "string",
            "enum": [
              "standard",
              "slender",
              "wide",
              "circle",
              "pebble",
              "squircle",
              "capsule",
              "triangle",
              "hexagon",
              "cloud",
              "droplet",
              "kite",
              "fan",
              "bud",
              "leaf",
              "drop",
              "wave",
              "comet",
              "satellite",
              "mitt",
              "hood",
              "crystal",
              "obelisk",
              "spring",
              "bellows",
              "vase",
              "teapot",
              "flame",
              "curl",
              "radio",
              "beacon",
              "tower",
              "arch",
              "pom",
              "bear",
              "pumpkin",
              "ghost",
              "bat",
              "witch-hat",
              "candy-corn",
              "turkey",
              "acorn",
              "squash",
              "pie",
              "corn",
              "light",
              "tree",
              "snowman",
              "ornament",
              "gift",
              "blue",
              "red",
              "sky",
              "green",
              "yellow",
              "pink",
              "plum",
              "teal",
              "lime",
              "mint",
              "lilac",
              "coral",
              "charcoal"
            ],
            "description": "Optional body override; must belong to the selected skin. Omitted shape is deterministically selected from the DID and skin."
          },
          "expression": {
            "type": "string",
            "enum": [
              "neutral",
              "attentive",
              "surprised",
              "excited",
              "happy",
              "laughing",
              "angry",
              "sad",
              "scared",
              "suspicious",
              "confused",
              "curious",
              "proud",
              "shy",
              "unimpressed",
              "sleepy",
              "thoughtful",
              "concerned"
            ],
            "default": "neutral",
            "description": "Resolved expression: state.expression > state.status mapping > outer preferred expression > neutral. Body shape/color remain unchanged."
          },
          "view": {
            "type": "string",
            "enum": [
              "avatar",
              "full"
            ],
            "default": "avatar",
            "description": "Face crop for avatars by default; full shows the complete body. Rendering only, independent of stored appearance and runtime eye state."
          },
          "accessories": {
            "$ref": "#/components/schemas/CharacterAccessoriesV1"
          },
          "finish": {
            "$ref": "#/components/schemas/CharacterFinish"
          },
          "eyePlacement": {
            "$ref": "#/components/schemas/CharacterEyePlacement"
          },
          "theme": {
            "$ref": "#/components/schemas/CharacterTheme"
          }
        },
        "allOf": [
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "autos"
                }
              }
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "slender",
                    "wide"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "spacex"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "circle",
                    "pebble",
                    "squircle",
                    "capsule",
                    "triangle",
                    "hexagon",
                    "cloud",
                    "droplet"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "fold"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "kite",
                    "fan"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "sprig"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "bud",
                    "leaf"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "ripple"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "drop",
                    "wave"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "halo"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "comet",
                    "satellite"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "purl"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "mitt",
                    "hood"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "prism"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "crystal",
                    "obelisk"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "coil"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "spring",
                    "bellows"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "kiln"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "vase",
                    "teapot"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "wisp"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "flame",
                    "curl"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "relay"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "radio",
                    "beacon"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "cairn"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "tower",
                    "arch"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "tuft"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "standard",
                    "pom",
                    "bear"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "halloween"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "pumpkin",
                    "ghost",
                    "bat",
                    "witch-hat",
                    "candy-corn"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "thanksgiving"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "turkey",
                    "acorn",
                    "squash",
                    "pie",
                    "corn"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "christmas"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "light",
                    "tree",
                    "snowman",
                    "ornament",
                    "gift"
                  ]
                },
                "eyeStyle": {
                  "const": "live-v1"
                },
                "size": {
                  "minimum": 32
                }
              }
            }
          },
          {
            "if": {
              "properties": {
                "skin": {
                  "const": "one"
                }
              },
              "required": [
                "skin"
              ]
            },
            "then": {
              "properties": {
                "shape": {
                  "enum": [
                    "blue",
                    "red",
                    "sky",
                    "green",
                    "yellow",
                    "pink",
                    "plum",
                    "teal",
                    "lime",
                    "mint",
                    "lilac",
                    "coral",
                    "charcoal"
                  ]
                },
                "eyeStyle": {
                  "const": "agent-eye-v1"
                }
              }
            }
          }
        ]
      },
      "CharacterSkinV1": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "label",
          "version",
          "eyeStyles",
          "shapes",
          "expressions"
        ],
        "properties": {
          "id": {
            "type": "string",
            "enum": [
              "autos",
              "spacex",
              "fold",
              "sprig",
              "ripple",
              "halo",
              "purl",
              "prism",
              "coil",
              "kiln",
              "wisp",
              "relay",
              "cairn",
              "tuft",
              "halloween",
              "thanksgiving",
              "christmas",
              "one"
            ],
            "default": "autos"
          },
          "label": {
            "type": "string"
          },
          "version": {
            "type": "integer",
            "const": 1
          },
          "eyeStyles": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/CharacterEyeStyle"
            },
            "minItems": 1,
            "uniqueItems": true,
            "description": "The family\u2019s eye styles; the first is its default."
          },
          "shapes": {
            "type": "array",
            "items": {
              "type": "string",
              "enum": [
                "standard",
                "slender",
                "wide",
                "circle",
                "pebble",
                "squircle",
                "capsule",
                "triangle",
                "hexagon",
                "cloud",
                "droplet",
                "kite",
                "fan",
                "bud",
                "leaf",
                "drop",
                "wave",
                "comet",
                "satellite",
                "mitt",
                "hood",
                "crystal",
                "obelisk",
                "spring",
                "bellows",
                "vase",
                "teapot",
                "flame",
                "curl",
                "radio",
                "beacon",
                "tower",
                "arch",
                "pom",
                "bear",
                "pumpkin",
                "ghost",
                "bat",
                "witch-hat",
                "candy-corn",
                "turkey",
                "acorn",
                "squash",
                "pie",
                "corn",
                "light",
                "tree",
                "snowman",
                "ornament",
                "gift",
                "blue",
                "red",
                "sky",
                "green",
                "yellow",
                "pink",
                "plum",
                "teal",
                "lime",
                "mint",
                "lilac",
                "coral",
                "charcoal"
              ],
              "description": "Optional body override; must belong to the selected skin. Omitted shape is deterministically selected from the DID and skin."
            },
            "minItems": 1,
            "uniqueItems": true
          },
          "expressions": {
            "type": "array",
            "items": {
              "type": "string",
              "enum": [
                "neutral",
                "attentive",
                "surprised",
                "excited",
                "happy",
                "laughing",
                "angry",
                "sad",
                "scared",
                "suspicious",
                "confused",
                "curious",
                "proud",
                "shy",
                "unimpressed",
                "sleepy",
                "thoughtful",
                "concerned"
              ],
              "default": "neutral",
              "description": "Shared eye expression across all skins. Body shape and color remain unchanged. Explicit blink shrinks expression eye bars and gaze translates both together."
            },
            "minItems": 18,
            "maxItems": 18,
            "uniqueItems": true
          }
        },
        "allOf": [
          {
            "if": {
              "required": [
                "id"
              ],
              "properties": {
                "id": {
                  "const": "autos"
                }
              }
            },
            "then": {
              "properties": {
                "shapes": {
                  "items": {
                    "enum": [
                      "standard",
                      "slender",
                      "wide"
                    ]
                  },
                  "minItems": 3,
                  "maxItems": 3
                },
                "eyeStyles": {
                  "items": {
                    "const": "live-v1"
                  },
                  "minItems": 1,
                  "maxItems": 1
                }
              }
            }
          },
          {
            "if": {
              "required": [
                "id"
              ],
              "properties": {
                "id": {
                  "const": "spacex"
                }
              }
            },
            "then": {
              "properties": {
                "shapes": {
                  "items": {
                    "enum": [
                      "circle",
                      "pebble",
                      "squircle",
                      "capsule",
                      "triangle",
                      "hexagon",
                      "cloud",
                      "droplet"
                    ]
                  },
                  "minItems": 8,
                  "maxItems": 8
                },
                "eyeStyles": {
                  "items": {
                    "const": "live-v1"
                  },
                  "minItems": 1,
                  "maxItems": 1
                }
              }
            }
          },
          {
            "if": {
              "required": [
                "id"
              ],
              "properties": {
                "id": {
                  "const": "fold"
                }
              }
            },
            "then": {
              "properties": {
                "shapes": {
                  "items": {
                    "enum": [
                      "standard",
                      "kite",
                      "fan"
                    ]
                  },
                  "minItems": 3,
                  "maxItems": 3
                },
                "eyeStyles": {
                  "items": {
                    "const": "live-v1"
                  },
                  "minItems": 1,
                  "maxItems": 1
                }
              }
            }
          },
          {
            "if": {
              "required": [
                "id"
              ],
              "properties": {
                "id": {
                  "const": "sprig"
                }
              }
            },
            "then": {
              "properties": {
                "shapes": {
                  "items": {
                    "enum": [
                      "standard",
                      "bud",
                      "leaf"
                    ]
                  },
                  "minItems": 3,
                  "maxItems": 3
                },
                "eyeStyles": {
                  "items": {
                    "const": "live-v1"
                  },
                  "minItems": 1,
                  "maxItems": 1
                }
              }
            }
          },
          {
            "if": {
              "required": [
                "id"
              ],
              "properties": {
                "id": {
                  "const": "ripple"
                }
              }
            },
            "then": {
              "properties": {
                "shapes": {
                  "items": {
                    "enum": [
                      "standard",
                      "drop",
                      "wave"
                    ]
                  },
                  "minItems": 3,
                  "maxItems": 3
                },
                "eyeStyles": {
                  "items": {
                    "const": "live-v1"
                  },
                  "minItems": 1,
                  "maxItems": 1
                }
              }
            }
          },
          {
            "if": {
              "required": [
                "id"
              ],
              "properties": {
                "id": {
                  "const": "halo"
                }
              }
            },
            "then": {
              "properties": {
                "shapes": {
                  "items": {
                    "enum": [
                      "standard",
                      "comet",
                      "satellite"
                    ]
                  },
                  "minItems": 3,
                  "maxItems": 3
                },
                "eyeStyles": {
                  "items": {
                    "const": "live-v1"
                  },
                  "minItems": 1,
                  "maxItems": 1
                }
              }
            }
          },
          {
            "if": {
              "required": [
                "id"
              ],
              "properties": {
                "id": {
                  "const": "purl"
                }
              }
            },
            "then": {
              "properties": {
                "shapes": {
                  "items": {
                    "enum": [
                      "standard",
                      "mitt",
                      "hood"
                    ]
                  },
                  "minItems": 3,
                  "maxItems": 3
                },
                "eyeStyles": {
                  "items": {
                    "const": "live-v1"
                  },
                  "minItems": 1,
                  "maxItems": 1
                }
              }
            }
          },
          {
            "if": {
              "required": [
                "id"
              ],
              "properties": {
                "id": {
                  "const": "prism"
                }
              }
            },
            "then": {
              "properties": {
                "shapes": {
                  "items": {
                    "enum": [
                      "standard",
                      "crystal",
                      "obelisk"
                    ]
                  },
                  "minItems": 3,
                  "maxItems": 3
                },
                "eyeStyles": {
                  "items": {
                    "const": "live-v1"
                  },
                  "minItems": 1,
                  "maxItems": 1
                }
              }
            }
          },
          {
            "if": {
              "required": [
                "id"
              ],
              "properties": {
                "id": {
                  "const": "coil"
                }
              }
            },
            "then": {
              "properties": {
                "shapes": {
                  "items": {
                    "enum": [
                      "standard",
                      "spring",
                      "bellows"
                    ]
                  },
                  "minItems": 3,
                  "maxItems": 3
                },
                "eyeStyles": {
                  "items": {
                    "const": "live-v1"
                  },
                  "minItems": 1,
                  "maxItems": 1
                }
              }
            }
          },
          {
            "if": {
              "required": [
                "id"
              ],
              "properties": {
                "id": {
                  "const": "kiln"
                }
              }
            },
            "then": {
              "properties": {
                "shapes": {
                  "items": {
                    "enum": [
                      "standard",
                      "vase",
                      "teapot"
                    ]
                  },
                  "minItems": 3,
                  "maxItems": 3
                },
                "eyeStyles": {
                  "items": {
                    "const": "live-v1"
                  },
                  "minItems": 1,
                  "maxItems": 1
                }
              }
            }
          },
          {
            "if": {
              "required": [
                "id"
              ],
              "properties": {
                "id": {
                  "const": "wisp"
                }
              }
            },
            "then": {
              "properties": {
                "shapes": {
                  "items": {
                    "enum": [
                      "standard",
                      "flame",
                      "curl"
                    ]
                  },
                  "minItems": 3,
                  "maxItems": 3
                },
                "eyeStyles": {
                  "items": {
                    "const": "live-v1"
                  },
                  "minItems": 1,
                  "maxItems": 1
                }
              }
            }
          },
          {
            "if": {
              "required": [
                "id"
              ],
              "properties": {
                "id": {
                  "const": "relay"
                }
              }
            },
            "then": {
              "properties": {
                "shapes": {
                  "items": {
                    "enum": [
                      "standard",
                      "radio",
                      "beacon"
                    ]
                  },
                  "minItems": 3,
                  "maxItems": 3
                },
                "eyeStyles": {
                  "items": {
                    "const": "live-v1"
                  },
                  "minItems": 1,
                  "maxItems": 1
                }
              }
            }
          },
          {
            "if": {
              "required": [
                "id"
              ],
              "properties": {
                "id": {
                  "const": "cairn"
                }
              }
            },
            "then": {
              "properties": {
                "shapes": {
                  "items": {
                    "enum": [
                      "standard",
                      "tower",
                      "arch"
                    ]
                  },
                  "minItems": 3,
                  "maxItems": 3
                },
                "eyeStyles": {
                  "items": {
                    "const": "live-v1"
                  },
                  "minItems": 1,
                  "maxItems": 1
                }
              }
            }
          },
          {
            "if": {
              "required": [
                "id"
              ],
              "properties": {
                "id": {
                  "const": "tuft"
                }
              }
            },
            "then": {
              "properties": {
                "shapes": {
                  "items": {
                    "enum": [
                      "standard",
                      "pom",
                      "bear"
                    ]
                  },
                  "minItems": 3,
                  "maxItems": 3
                },
                "eyeStyles": {
                  "items": {
                    "const": "live-v1"
                  },
                  "minItems": 1,
                  "maxItems": 1
                }
              }
            }
          },
          {
            "if": {
              "required": [
                "id"
              ],
              "properties": {
                "id": {
                  "const": "halloween"
                }
              }
            },
            "then": {
              "properties": {
                "shapes": {
                  "items": {
                    "enum": [
                      "pumpkin",
                      "ghost",
                      "bat",
                      "witch-hat",
                      "candy-corn"
                    ]
                  },
                  "minItems": 5,
                  "maxItems": 5
                },
                "eyeStyles": {
                  "items": {
                    "const": "live-v1"
                  },
                  "minItems": 1,
                  "maxItems": 1
                }
              }
            }
          },
          {
            "if": {
              "required": [
                "id"
              ],
              "properties": {
                "id": {
                  "const": "thanksgiving"
                }
              }
            },
            "then": {
              "properties": {
                "shapes": {
                  "items": {
                    "enum": [
                      "turkey",
                      "acorn",
                      "squash",
                      "pie",
                      "corn"
                    ]
                  },
                  "minItems": 5,
                  "maxItems": 5
                },
                "eyeStyles": {
                  "items": {
                    "const": "live-v1"
                  },
                  "minItems": 1,
                  "maxItems": 1
                }
              }
            }
          },
          {
            "if": {
              "required": [
                "id"
              ],
              "properties": {
                "id": {
                  "const": "christmas"
                }
              }
            },
            "then": {
              "properties": {
                "shapes": {
                  "items": {
                    "enum": [
                      "light",
                      "tree",
                      "snowman",
                      "ornament",
                      "gift"
                    ]
                  },
                  "minItems": 5,
                  "maxItems": 5
                },
                "eyeStyles": {
                  "items": {
                    "const": "live-v1"
                  },
                  "minItems": 1,
                  "maxItems": 1
                }
              }
            }
          },
          {
            "if": {
              "required": [
                "id"
              ],
              "properties": {
                "id": {
                  "const": "one"
                }
              }
            },
            "then": {
              "properties": {
                "shapes": {
                  "items": {
                    "enum": [
                      "blue",
                      "red",
                      "sky",
                      "green",
                      "yellow",
                      "pink",
                      "plum",
                      "teal",
                      "lime",
                      "mint",
                      "lilac",
                      "coral",
                      "charcoal"
                    ]
                  },
                  "minItems": 13,
                  "maxItems": 13
                },
                "eyeStyles": {
                  "items": {
                    "const": "agent-eye-v1"
                  },
                  "minItems": 1,
                  "maxItems": 1
                }
              }
            }
          }
        ]
      },
      "CharacterApiError": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "error"
        ],
        "properties": {
          "error": {
            "type": "string",
            "enum": [
              "invalid_request",
              "body_too_large",
              "unsupported_media_type",
              "method_not_allowed",
              "not_found"
            ]
          }
        }
      },
      "AvatarExpression": {
        "type": "string",
        "enum": [
          "neutral",
          "attentive",
          "surprised",
          "excited",
          "happy",
          "laughing",
          "angry",
          "sad",
          "scared",
          "suspicious",
          "confused",
          "curious",
          "proud",
          "shy",
          "unimpressed",
          "sleepy",
          "thoughtful",
          "concerned"
        ],
        "description": "Shared eye expression across all families; does not change identity-derived shape or color."
      },
      "AvatarStatus": {
        "type": "string",
        "enum": [
          "neutral",
          "attentive",
          "surprised",
          "excited",
          "happy",
          "laughing",
          "angry",
          "sad",
          "scared",
          "suspicious",
          "confused",
          "curious",
          "proud",
          "shy",
          "unimpressed",
          "sleepy",
          "thoughtful",
          "concerned",
          "idle",
          "listening",
          "reasoning",
          "working",
          "speaking",
          "success",
          "blocked",
          "error",
          "typing",
          "attention",
          "paused",
          "offline"
        ],
        "description": "Expressions map to themselves. Aliases: idle\u2192neutral, listening\u2192attentive, reasoning\u2192thoughtful, working\u2192attentive, speaking/success\u2192happy, blocked/error\u2192concerned, typing/attention\u2192attentive, paused/offline\u2192sleepy. Presentation only; not evidence of actual agent activity."
      },
      "CharacterStatusV1": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "status",
          "expression"
        ],
        "properties": {
          "status": {
            "$ref": "#/components/schemas/AvatarStatus"
          },
          "expression": {
            "$ref": "#/components/schemas/AvatarExpression"
          }
        }
      },
      "CharacterAccessory": {
        "type": "string",
        "enum": [
          "glasses",
          "headphones"
        ],
        "description": "Closed package-owned accessory identifier; independent of character family."
      },
      "CharacterAccessoriesV1": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/CharacterAccessory"
        },
        "maxItems": 2,
        "uniqueItems": true,
        "default": [],
        "description": "Optional independent accessories, canonicalized to glasses then headphones. Omitted selection resolves to []; no null, unknown identifier or duplicate is accepted."
      },
      "CharacterAccessoryDescriptionV1": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "label",
          "description"
        ],
        "properties": {
          "id": {
            "$ref": "#/components/schemas/CharacterAccessory"
          },
          "label": {
            "type": "string",
            "minLength": 1
          },
          "description": {
            "type": "string",
            "minLength": 1
          }
        }
      },
      "CharacterFinish": {
        "type": "string",
        "enum": [
          "plush",
          "flat"
        ],
        "default": "plush",
        "description": "Shared body finish on every family: plush by default, flat for the vector material. Appearance only; identity and live state stay independent."
      },
      "CharacterEyePlacement": {
        "type": "string",
        "enum": [
          "face",
          "raised"
        ],
        "default": "face",
        "description": "Shared live-v1 eye placement on every family: on the face by default, or raised above the head. Appearance only; all eighteen expressions remain available."
      },
      "CharacterTheme": {
        "type": "string",
        "enum": [
          "light",
          "dark"
        ],
        "default": "light",
        "description": "Surface the character is drawn on. Presentation only, never stored appearance. The One family uses lifted disc tones and no keyline on dark surfaces; other families render identically on both."
      },
      "CharacterEyeStyle": {
        "type": "string",
        "enum": [
          "live-v1",
          "agent-eye-v1"
        ],
        "description": "Eye geometry. live-v1 is shared geometry across the two-eyed families; the One family uses agent-eye-v1, agent-eye\u2019s single bar. A family accepts only its own eye style, and an omitted style selects it. Future eye geometries receive new identifiers."
      }
    },
    "parameters": {
      "did": {
        "name": "did",
        "in": "path",
        "required": true,
        "schema": {
          "$ref": "#/components/schemas/AgentDid"
        },
        "description": "Percent-encode the entire DID as one path segment."
      },
      "IfNoneMatch": {
        "name": "If-None-Match",
        "in": "header",
        "schema": {
          "type": "string",
          "maxLength": 4096
        },
        "description": "GET/HEAD accepts a strong/weak validator, comma-separated list or *. Headers over 4096 characters are ignored."
      },
      "skin": {
        "name": "skin",
        "in": "query",
        "schema": {
          "type": "string",
          "enum": [
            "autos",
            "spacex",
            "fold",
            "sprig",
            "ripple",
            "halo",
            "purl",
            "prism",
            "coil",
            "kiln",
            "wisp",
            "relay",
            "cairn",
            "tuft",
            "halloween",
            "thanksgiving",
            "christmas",
            "one"
          ],
          "default": "autos"
        }
      },
      "skinVersion": {
        "name": "skinVersion",
        "in": "query",
        "schema": {
          "type": "integer",
          "const": 1,
          "default": 1
        }
      },
      "eyeStyle": {
        "name": "eyeStyle",
        "in": "query",
        "schema": {
          "$ref": "#/components/schemas/CharacterEyeStyle"
        }
      },
      "size": {
        "name": "size",
        "in": "query",
        "schema": {
          "type": "integer",
          "minimum": 16,
          "maximum": 2048,
          "default": 512,
          "description": "Square pixel size: 16\u20132048 for the One family, 32\u20132048 for every other family."
        },
        "description": "Unsigned decimal integer, no leading zeroes. 16\u20132048 for the One family, 32\u20132048 for every other family."
      },
      "animated": {
        "name": "animated",
        "in": "query",
        "schema": {
          "type": "boolean",
          "default": true,
          "description": "Native SMIL animation with no JavaScript or CSS."
        },
        "description": "Exactly true or false."
      },
      "blink": {
        "name": "blink",
        "in": "query",
        "schema": {
          "type": "number",
          "minimum": 0,
          "maximum": 1,
          "default": 0
        },
        "description": "Finite ordinary decimal notation, no exponent, whitespace or leading +."
      },
      "gazeX": {
        "name": "gazeX",
        "in": "query",
        "schema": {
          "type": "number",
          "minimum": -1,
          "maximum": 1,
          "default": 0
        },
        "description": "Finite ordinary decimal notation, no exponent, whitespace or leading +. gazeX and gazeY must be supplied together."
      },
      "gazeY": {
        "name": "gazeY",
        "in": "query",
        "schema": {
          "type": "number",
          "minimum": -1,
          "maximum": 1,
          "default": 0
        },
        "description": "Finite ordinary decimal notation, no exponent, whitespace or leading +. gazeX and gazeY must be supplied together."
      },
      "shape": {
        "name": "shape",
        "in": "query",
        "schema": {
          "type": "string",
          "enum": [
            "standard",
            "slender",
            "wide",
            "circle",
            "pebble",
            "squircle",
            "capsule",
            "triangle",
            "hexagon",
            "cloud",
            "droplet",
            "kite",
            "fan",
            "bud",
            "leaf",
            "drop",
            "wave",
            "comet",
            "satellite",
            "mitt",
            "hood",
            "crystal",
            "obelisk",
            "spring",
            "bellows",
            "vase",
            "teapot",
            "flame",
            "curl",
            "radio",
            "beacon",
            "tower",
            "arch",
            "pom",
            "bear",
            "pumpkin",
            "ghost",
            "bat",
            "witch-hat",
            "candy-corn",
            "turkey",
            "acorn",
            "squash",
            "pie",
            "corn",
            "light",
            "tree",
            "snowman",
            "ornament",
            "gift",
            "blue",
            "red",
            "sky",
            "green",
            "yellow",
            "pink",
            "plum",
            "teal",
            "lime",
            "mint",
            "lilac",
            "coral",
            "charcoal"
          ],
          "description": "Optional body override; must belong to the selected skin. Omitted shape is deterministically selected from the DID and skin."
        }
      },
      "expression": {
        "name": "expression",
        "in": "query",
        "schema": {
          "type": "string",
          "enum": [
            "neutral",
            "attentive",
            "surprised",
            "excited",
            "happy",
            "laughing",
            "angry",
            "sad",
            "scared",
            "suspicious",
            "confused",
            "curious",
            "proud",
            "shy",
            "unimpressed",
            "sleepy",
            "thoughtful",
            "concerned"
          ],
          "default": "neutral",
          "description": "Shared eye expression across all skins. Body shape and color remain unchanged. Explicit blink shrinks expression eye bars and gaze translates both together."
        },
        "description": "Outer preferred expression fallback. A status query is state.status and overrides this preference. Explicit runtime expression overrides can be supplied in POST state.expression."
      },
      "status": {
        "name": "status",
        "in": "query",
        "schema": {
          "$ref": "#/components/schemas/AvatarStatus"
        },
        "description": "Parsed as state.status. Overrides expression query preference with its mapped expression. Duplicate/unknown status values are refused before rendering or cache validation."
      },
      "view": {
        "name": "view",
        "in": "query",
        "schema": {
          "type": "string",
          "enum": [
            "avatar",
            "full"
          ],
          "default": "avatar",
          "description": "Face crop for avatars by default; full shows the complete body. Rendering only, independent of stored appearance and runtime eye state."
        }
      },
      "accessories": {
        "name": "accessories",
        "in": "query",
        "required": false,
        "style": "form",
        "explode": false,
        "allowEmptyValue": true,
        "schema": {
          "$ref": "#/components/schemas/CharacterAccessoriesV1"
        },
        "description": "One comma-separated selection, for example glasses,headphones. Empty string means []; either input order normalizes to catalog order. Repeated query parameters, duplicates, unknown IDs, whitespace and empty elements are refused."
      },
      "finish": {
        "name": "finish",
        "in": "query",
        "schema": {
          "$ref": "#/components/schemas/CharacterFinish"
        }
      },
      "eyePlacement": {
        "name": "eyePlacement",
        "in": "query",
        "schema": {
          "$ref": "#/components/schemas/CharacterEyePlacement"
        }
      },
      "theme": {
        "name": "theme",
        "in": "query",
        "schema": {
          "$ref": "#/components/schemas/CharacterTheme"
        }
      }
    },
    "headers": {
      "CorsOrigin": {
        "schema": {
          "type": "string",
          "const": "*"
        }
      },
      "CorsExpose": {
        "schema": {
          "type": "string",
          "const": "ETag, Content-Length"
        }
      },
      "NoSniff": {
        "schema": {
          "type": "string",
          "const": "nosniff"
        }
      },
      "CacheControl": {
        "schema": {
          "type": "string"
        }
      },
      "ETag": {
        "schema": {
          "type": "string"
        },
        "description": "Strong SHA-256 validator for exact response bytes."
      },
      "ContentLength": {
        "schema": {
          "type": "integer",
          "minimum": 0
        }
      },
      "SvgCsp": {
        "schema": {
          "type": "string",
          "const": "default-src 'none'; img-src 'none'; style-src 'none'; sandbox"
        }
      }
    },
    "responses": {
      "InvalidRequest": {
        "description": "Invalid DID, malformed value or JSON, unknown field, unknown or duplicate query parameter.",
        "headers": {
          "Access-Control-Allow-Origin": {
            "$ref": "#/components/headers/CorsOrigin"
          },
          "Access-Control-Expose-Headers": {
            "$ref": "#/components/headers/CorsExpose"
          },
          "X-Content-Type-Options": {
            "$ref": "#/components/headers/NoSniff"
          },
          "Cache-Control": {
            "$ref": "#/components/headers/CacheControl"
          }
        },
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/CharacterApiError"
            }
          }
        }
      },
      "NotFound": {
        "description": "Route outside this handler or unsupported route shape.",
        "headers": {
          "Access-Control-Allow-Origin": {
            "$ref": "#/components/headers/CorsOrigin"
          },
          "Access-Control-Expose-Headers": {
            "$ref": "#/components/headers/CorsExpose"
          },
          "X-Content-Type-Options": {
            "$ref": "#/components/headers/NoSniff"
          },
          "Cache-Control": {
            "$ref": "#/components/headers/CacheControl"
          }
        },
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/CharacterApiError"
            }
          }
        }
      },
      "MethodNotAllowed": {
        "description": "Method not supported; Allow identifies allowed methods.",
        "headers": {
          "Access-Control-Allow-Origin": {
            "$ref": "#/components/headers/CorsOrigin"
          },
          "Access-Control-Expose-Headers": {
            "$ref": "#/components/headers/CorsExpose"
          },
          "X-Content-Type-Options": {
            "$ref": "#/components/headers/NoSniff"
          },
          "Cache-Control": {
            "$ref": "#/components/headers/CacheControl"
          },
          "Allow": {
            "schema": {
              "type": "string"
            }
          }
        },
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/CharacterApiError"
            }
          }
        }
      },
      "BodyTooLarge": {
        "description": "Announced or streamed body exceeds 16384 bytes.",
        "headers": {
          "Access-Control-Allow-Origin": {
            "$ref": "#/components/headers/CorsOrigin"
          },
          "Access-Control-Expose-Headers": {
            "$ref": "#/components/headers/CorsExpose"
          },
          "X-Content-Type-Options": {
            "$ref": "#/components/headers/NoSniff"
          },
          "Cache-Control": {
            "$ref": "#/components/headers/CacheControl"
          }
        },
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/CharacterApiError"
            }
          }
        }
      },
      "UnsupportedMediaType": {
        "description": "Requires uncompressed UTF-8 application/json, optionally charset=utf-8.",
        "headers": {
          "Access-Control-Allow-Origin": {
            "$ref": "#/components/headers/CorsOrigin"
          },
          "Access-Control-Expose-Headers": {
            "$ref": "#/components/headers/CorsExpose"
          },
          "X-Content-Type-Options": {
            "$ref": "#/components/headers/NoSniff"
          },
          "Cache-Control": {
            "$ref": "#/components/headers/CacheControl"
          }
        },
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/CharacterApiError"
            }
          }
        }
      }
    }
  }
} as const;
