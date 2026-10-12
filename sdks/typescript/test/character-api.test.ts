import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { characterApiOpenApi, createCharacterApiHandler } from '../src/character-api.js';
import { generateCharacter, getCharacterExpressions, getCharacterSkins, getCharacterStatuses } from '../src/characters.js';
import { getCharacterAccessories, type CharacterAccessory } from '../src/character-accessories.js';

// Public conformance identifier, not a secret or an assertion of control.
const did = 'did:oas:openagent:agent:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';
const base = 'https://characters.example.org/v1/characters';
const handler = createCharacterApiHandler();
const jsonHeaders = { 'content-type': 'application/json' };
const path = (identity = did, svg = false): string => `${base}/${svg ? 'svg/' : ''}${encodeURIComponent(identity)}`;
const familyKinds = {
  autos: ['standard', 'slender', 'wide'],
  spacex: ['circle', 'pebble', 'squircle', 'capsule', 'triangle', 'hexagon', 'cloud', 'droplet'],
  fold: ['standard', 'kite', 'fan'], sprig: ['standard', 'bud', 'leaf'],
  ripple: ['standard', 'drop', 'wave'], halo: ['standard', 'comet', 'satellite'],
  purl: ['standard', 'mitt', 'hood'], prism: ['standard', 'crystal', 'obelisk'],
  coil: ['standard', 'spring', 'bellows'], kiln: ['standard', 'vase', 'teapot'],
  wisp: ['standard', 'flame', 'curl'], relay: ['standard', 'radio', 'beacon'],
  cairn: ['standard', 'tower', 'arch'], tuft: ['standard', 'pom', 'bear'],
  halloween: ['pumpkin', 'ghost', 'bat', 'witch-hat', 'candy-corn'],
  thanksgiving: ['turkey', 'acorn', 'squash', 'pie', 'corn'],
  christmas: ['light', 'tree', 'snowman', 'ornament', 'gift'],
} as const;

function post(body: unknown, headers: HeadersInit = jsonHeaders): Request {
  return new Request(`${base}/generate`, { method: 'POST', headers, body: JSON.stringify(body) });
}

function expectCors(response: Response, methods?: string): void {
  expect(response.headers.get('access-control-allow-origin')).toBe('*');
  expect(response.headers.get('access-control-allow-credentials')).toBeNull();
  expect(response.headers.get('access-control-expose-headers')).toBe('ETag, Content-Length');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  if (methods) expect(response.headers.get('access-control-allow-methods')).toBe(methods);
}

describe('public stateless character API', () => {
  it('serves the real versioned skin catalog and exact bundled OpenAPI contract', async () => {
    const response = await handler(new Request(`${base}/skins`));
    expect(response.status).toBe(200);
    expectCors(response, 'GET, HEAD, OPTIONS');
    expect(await response.json()).toEqual(getCharacterSkins());
    const schema = await handler(new Request(`${base}/openapi.json`));
    expect(schema.status).toBe(200);
    expect(await schema.json()).toEqual(characterApiOpenApi);
    expect(characterApiOpenApi).toEqual(JSON.parse(readFileSync(
      new URL('../../../docs/character-api.openapi.json', import.meta.url), 'utf8',
    )));
    expect(characterApiOpenApi.openapi).toBe('3.1.0');
    expect(characterApiOpenApi.info.version).toBe('0.6.0');
    expect(characterApiOpenApi.security).toEqual([]);
    expect(characterApiOpenApi.components.schemas.CharacterGenerateRequestV1.additionalProperties).toBe(false);
    expect(characterApiOpenApi.components.schemas.LiveEyeStateV1.additionalProperties).toBe(false);
  });

  it('serves the independent accessory catalog with a closed schema and credential-free catalog semantics', async () => {
    const response = await handler(new Request(`${base}/accessories`));
    expect(response.status).toBe(200);
    expectCors(response, 'GET, HEAD, OPTIONS');
    const catalog = await response.json();
    expect(catalog).toEqual(getCharacterAccessories());
    expect(catalog.map((entry: { id: string }) => entry.id)).toEqual(['glasses', 'headphones']);
    for (const entry of catalog) {
      expect(Object.keys(entry).sort()).toEqual(['description', 'id', 'label']);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry).not.toHaveProperty('owner');
      expect(entry).not.toHaveProperty('verified');
    }
    const schemas = characterApiOpenApi.components.schemas;
    expect(schemas.CharacterAccessory.enum).toEqual(['glasses', 'headphones']);
    expect(schemas.CharacterAccessoriesV1).toMatchObject({
      type: 'array', items: { $ref: '#/components/schemas/CharacterAccessory' },
      maxItems: 2, uniqueItems: true, default: [],
    });
    expect(schemas.CharacterAccessoryDescriptionV1.additionalProperties).toBe(false);
    expect(schemas.CharacterAccessoryDescriptionV1.required).toEqual(['id', 'label', 'description']);
    for (const schema of [schemas.CharacterAppearanceV1, schemas.CharacterOptionsV1,
      schemas.CharacterGenerateRequestV1, schemas.CharacterDescriptorV1]) {
      expect(schema.properties.accessories).toEqual({ $ref: '#/components/schemas/CharacterAccessoriesV1' });
    }
    expect(schemas.CharacterDescriptorV1.required).toContain('accessories');
    expect(schemas.LiveEyeStateV1.properties).not.toHaveProperty('accessories');
    expect(characterApiOpenApi.components.parameters.accessories).toMatchObject({
      name: 'accessories', in: 'query', style: 'form', explode: false, allowEmptyValue: true,
      schema: { $ref: '#/components/schemas/CharacterAccessoriesV1' },
    });
    const catalogSchema = characterApiOpenApi.paths['/accessories'].get.responses['200']
      .content['application/json'].schema;
    expect(catalogSchema.items).toEqual({ $ref: '#/components/schemas/CharacterAccessoryDescriptionV1' });
    for (const route of ['/{did}', '/svg/{did}'] as const) {
      for (const method of ['get', 'head', 'options'] as const) {
        expect(characterApiOpenApi.paths[route][method].parameters).toContainEqual({ $ref: '#/components/parameters/accessories' });
      }
    }
  });

  it('combines either accessory on every family kind in avatar/full JSON, SVG and POST without changing identity or eye state', async () => {
    const selections: readonly (readonly CharacterAccessory[])[] = [[], ['glasses'], ['headphones'], ['headphones', 'glasses']];
    for (const skin of getCharacterSkins()) {
      for (const shape of skin.shapes) {
        const common = { skin: skin.id, shape, animated: false,
          state: { status: 'reasoning' as const, blink: 0.5, gaze: { x: -1, y: 1 } } };
        const plain = generateCharacter(did, common);
        for (const view of ['avatar', 'full'] as const) {
          for (const accessories of selections) {
            const expected = generateCharacter(did, { ...common, view, accessories });
            expect(expected).toMatchObject({ did, shape: plain.shape, color: plain.color,
              expression: 'thoughtful', state: plain.state });
            const canonical = accessories.length === 2 ? ['glasses', 'headphones'] : [...accessories];
            expect(expected.accessories).toEqual(canonical);
            expect((expected.svg.match(/data-character-eye="(?:left|right)"/g) ?? [])).toHaveLength(2);
            expect((expected.svg.match(/data-character-accessory="/g) ?? [])).toHaveLength(accessories.length);
            for (const id of canonical) expect(expected.svg).toContain(`data-character-accessory="${id}"`);
            const query = `?skin=${skin.id}&shape=${shape}&view=${view}&accessories=${accessories.join(',')}&animated=false&status=reasoning&blink=0.5&gazeX=-1&gazeY=1`;
            const response = await handler(new Request(path() + query));
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual(expected);
            const image = await handler(new Request(path(did, true) + query));
            expect(image.status).toBe(200);
            expect(await image.text()).toBe(expected.svg);
            const generated = await handler(post({ did, ...common, view, accessories }));
            expect(generated.status).toBe(200);
            expect(generated.headers.get('cache-control')).toBe('no-store');
            expect(await generated.json()).toEqual(expected);
          }
        }
      }
    }
  }, 20_000);

  it('normalizes input order for identical descriptors and byte validators, with empty selection equal to omitted defaults', async () => {
    const pair = [];
    for (const query of ['?accessories=glasses,headphones', '?accessories=headphones,glasses']) {
      const response = await handler(new Request(path() + query));
      expect(response.status).toBe(200);
      pair.push({ body: await response.text(), tag: response.headers.get('etag') });
    }
    expect(pair[1]).toEqual(pair[0]);
    const cached = await handler(new Request(path() + '?accessories=headphones,glasses', {
      headers: { 'if-none-match': pair[0]!.tag! },
    }));
    expect(cached.status).toBe(304);
    expectCors(cached);
    const implicit = await handler(new Request(path()));
    const explicit = await handler(new Request(path() + '?accessories='));
    expect(explicit.headers.get('etag')).toBe(implicit.headers.get('etag'));
    expect(await explicit.text()).toBe(await implicit.text());
    expect(generateCharacter(did).accessories).toEqual([]);
    expect(generateCharacter(did).svg).toBe(generateCharacter(did, { accessories: [] }).svg);
    expect(pair[0]!.tag).not.toBe(implicit.headers.get('etag'));
  });

  it('publishes exactly 17 families and 62 family kinds with closed, cross-family OpenAPI schemas', () => {
    const catalog = getCharacterSkins();
    const families = Object.keys(familyKinds);
    const kinds = [...new Set(Object.values(familyKinds).flat())];
    expect(catalog.map(entry => entry.id)).toEqual(families);
    expect(catalog).toHaveLength(17);
    expect(catalog.reduce((total, entry) => total + entry.shapes.length, 0)).toBe(62);
    expect(Object.fromEntries(catalog.map(entry => [entry.id, entry.shapes]))).toEqual(familyKinds);
    for (const entry of catalog) {
      expect(entry.version).toBe(1);
      expect(entry.eyeStyles).toEqual(['live-v1']);
      expect(entry.expressions).toEqual(getCharacterExpressions());
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.shapes)).toBe(true);
    }
    const schemas = characterApiOpenApi.components.schemas;
    for (const schema of [schemas.CharacterAppearanceV1, schemas.CharacterOptionsV1,
      schemas.CharacterGenerateRequestV1, schemas.CharacterDescriptorV1]) {
      expect(schema.additionalProperties).toBe(false);
      expect(schema.properties.skin.enum).toEqual(families);
      expect(schema.properties.shape.enum).toEqual(kinds);
      expect(schema.allOf).toHaveLength(17);
      expect(Object.fromEntries(schema.allOf.map(rule => [
        rule.if.properties.skin.const, rule.then.properties.shape.enum,
      ]))).toEqual(familyKinds);
    }
    expect(schemas.CharacterAppearanceV1.required).toEqual(['skin']);
    expect(schemas.CharacterAppearanceV1.properties).not.toHaveProperty('view');
    for (const schema of [schemas.CharacterOptionsV1, schemas.CharacterGenerateRequestV1,
      schemas.CharacterDescriptorV1]) {
      expect(schema.properties.view.enum).toEqual(['avatar', 'full']);
      expect(schema.properties.view.default).toBe('avatar');
    }
    expect(schemas.CharacterDescriptorV1.required).toContain('view');
    expect(schemas.CharacterSkinV1.additionalProperties).toBe(false);
    expect(schemas.CharacterSkinV1.properties.id.enum).toEqual(families);
    expect(schemas.CharacterSkinV1.properties.shapes.items.enum).toEqual(kinds);
    expect(schemas.CharacterSkinV1.allOf).toHaveLength(17);
    for (const rule of schemas.CharacterSkinV1.allOf) {
      const expected = familyKinds[rule.if.properties.id.const];
      expect(rule.then.properties.shapes.items.enum).toEqual(expected);
      expect(rule.then.properties.shapes.minItems).toBe(expected.length);
      expect(rule.then.properties.shapes.maxItems).toBe(expected.length);
    }
    expect(characterApiOpenApi.components.parameters.skin.schema.enum).toEqual(families);
    expect(characterApiOpenApi.components.parameters.shape.schema.enum).toEqual(kinds);
    expect(characterApiOpenApi.components.parameters.view.schema).toMatchObject({
      enum: ['avatar', 'full'], default: 'avatar',
    });
  });

  it('returns identical avatar/full JSON, SVG and POST geometry for every family kind', async () => {
    for (const skin of getCharacterSkins()) {
      for (const shape of skin.shapes) {
        const common = { skin: skin.id, shape, animated: false, expression: 'concerned' as const,
          state: { blink: 0.5, gaze: { x: -1, y: 1 } } };
        const cropped = generateCharacter(did, { ...common, view: 'avatar' });
        const full = generateCharacter(did, { ...common, view: 'full' });
        expect(cropped).toMatchObject({ did, skin: skin.id, shape, view: 'avatar' });
        expect(full).toMatchObject({ did, skin: skin.id, shape, view: 'full', color: cropped.color,
          expression: cropped.expression, state: cropped.state });
        expect(full.svg).toContain('viewBox="0 0 512 512"');
        expect(cropped.svg).not.toContain('viewBox="0 0 512 512"');
        // Framing changes only the square crop and its presentation attribute.
        const geometry = (svg: string): string => svg.replace(/viewBox="[^"]*"/, '')
          .replace(/data-character-view="[^"]*"/, '');
        expect(geometry(cropped.svg)).toBe(geometry(full.svg));
        for (const view of ['avatar', 'full'] as const) {
          const expected = view === 'avatar' ? cropped : full;
          const query = `?skin=${skin.id}&shape=${shape}&view=${view}&animated=false&expression=concerned&blink=0.5&gazeX=-1&gazeY=1`;
          const response = await handler(new Request(path() + query));
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual(expected);
          const image = await handler(new Request(path(did, true) + query));
          expect(image.status).toBe(200);
          expect(await image.text()).toBe(expected.svg);
          const generated = await handler(post({ did, ...common, view }));
          expect(generated.status).toBe(200);
          expect(await generated.json()).toEqual(expected);
        }
        const implicit = await handler(new Request(path() + `?skin=${skin.id}&shape=${shape}&animated=false`));
        expect(await implicit.json()).toEqual(generateCharacter(did, { skin: skin.id, shape, animated: false, view: 'avatar' }));
      }
    }
  });

  it('rejects a known kind from another family in both views and both request transports', async () => {
    const catalog = getCharacterSkins();
    for (const skin of catalog) {
      const shape = catalog.flatMap(entry => entry.shapes).find(kind => !skin.shapes.includes(kind))!;
      for (const view of ['avatar', 'full'] as const) {
        const query = `?skin=${skin.id}&shape=${shape}&view=${view}`;
        for (const svg of [false, true]) {
          const response = await handler(new Request(path(did, svg) + query, { headers: { 'if-none-match': '*' } }));
          expect(response.status).toBe(400);
          expect(response.headers.get('etag')).toBeNull();
          expect(await response.json()).toEqual({ error: 'invalid_request' });
        }
        const generated = await handler(post({ did, skin: skin.id, shape, view }));
        expect(generated.status).toBe(400);
        expect(await generated.json()).toEqual({ error: 'invalid_request' });
      }
    }
  });

  it('reports the selected seasonal kind body tone rather than one family-wide color', async () => {
    for (const [skin, colors] of Object.entries({
      halloween: { pumpkin: '#8E3F25', ghost: '#315D78', bat: '#403551', 'witch-hat': '#51436A', 'candy-corn': '#A84B27' },
      thanksgiving: { turkey: '#8B593D', acorn: '#AC7843', squash: '#A77735', pie: '#AD5E36', corn: '#A97128' },
      christmas: { light: '#AC3049', tree: '#326A55', snowman: '#305E76', ornament: '#544D85', gift: '#346A5B' },
    })) {
      for (const [shape, color] of Object.entries(colors)) {
        const response = await handler(new Request(path() + `?skin=${skin}&shape=${shape}&animated=false`));
        expect(response.status).toBe(200);
        const descriptor = await response.json();
        expect(descriptor).toMatchObject({ skin, shape, color });
        expect(descriptor.svg).toContain(color);
      }
    }
  });

  it('serves the real status mapping catalog with documented expression and state enums', async () => {
    const response = await handler(new Request(`${base}/statuses`));
    expect(response.status).toBe(200);
    expectCors(response, 'GET, HEAD, OPTIONS');
    const statuses = getCharacterStatuses();
    expect(await response.json()).toEqual(statuses);
    expect(Object.fromEntries(statuses.map(entry => [entry.status, entry.expression]))).toEqual({
      ...Object.fromEntries(getCharacterExpressions().map(expression => [expression, expression])),
      idle: 'neutral', listening: 'attentive', reasoning: 'thoughtful', working: 'attentive',
      speaking: 'happy', success: 'happy', blocked: 'concerned', error: 'concerned',
    });
    expect(characterApiOpenApi.components.schemas.AvatarStatus.enum).toEqual(statuses.map(entry => entry.status));
    expect(characterApiOpenApi.components.schemas.AvatarExpression.enum).toEqual(getCharacterExpressions());
    expect(characterApiOpenApi.components.schemas.AvatarExpression.enum).toContain('thoughtful');
    expect(characterApiOpenApi.components.schemas.AvatarExpression.enum).toContain('concerned');
  });

  it.each(['autos', 'spacex'] as const)('maps every status in %s GET, SVG and POST without changing identity, shape or color', async skin => {
    const neutral = generateCharacter(did, { skin, animated: false });
    for (const { status, expression } of getCharacterStatuses()) {
      const options = { skin, animated: false, state: { status } };
      const query = `?skin=${skin}&status=${status}&animated=false`;
      const descriptor = await handler(new Request(path() + query));
      expect(descriptor.status).toBe(200);
      expectCors(descriptor);
      const actual = await descriptor.json();
      expect(actual).toEqual(generateCharacter(did, options));
      expect(actual).toMatchObject({ did, expression, shape: neutral.shape, color: neutral.color });
      expect(actual.svg).toContain(`data-character-expression="${expression}"`);
      const image = await handler(new Request(path(did, true) + query));
      expect(image.status).toBe(200);
      expect(await image.text()).toBe(actual.svg);
      const generated = await handler(post({ did, ...options }));
      expect(generated.status).toBe(200);
      expect(generated.headers.get('cache-control')).toBe('no-store');
      expect(generated.headers.get('etag')).toBeNull();
      expect(await generated.json()).toEqual(actual);
    }
  });

  it.each(['autos', 'spacex'] as const)('applies state expression, status and outer expression precedence for %s', async skin => {
    const cases = [
      { expression: 'sad' as const, state: { status: 'success' as const, expression: 'concerned' as const }, resolved: 'concerned' },
      { expression: 'happy' as const, state: { status: 'reasoning' as const }, resolved: 'thoughtful' },
      { expression: 'curious' as const, state: { expression: 'neutral' as const }, resolved: 'neutral' },
      { expression: 'thoughtful' as const, state: {}, resolved: 'thoughtful' },
      { state: {}, resolved: 'neutral' },
    ];
    for (const { resolved, ...options } of cases) {
      const response = await handler(post({ did, skin, animated: false, ...options }));
      expect(response.status).toBe(200);
      const descriptor = await response.json();
      expect(descriptor.expression).toBe(resolved);
      expect(descriptor).toEqual(generateCharacter(did, { skin, animated: false, ...options }));
    }
    // GET expression remains the outer preference; state.status takes precedence.
    const query = `?skin=${skin}&status=blocked&expression=happy&animated=false&blink=0.5&gazeX=0.25&gazeY=-0.5`;
    const response = await handler(new Request(path() + query));
    expect(response.status).toBe(200);
    const descriptor = await response.json();
    expect(descriptor.expression).toBe('concerned');
    expect(descriptor).toEqual(generateCharacter(did, { skin, expression: 'happy', animated: false,
      state: { status: 'blocked', blink: 0.5, gaze: { x: 0.25, y: -0.5 } } }));
    const image = await handler(new Request(path(did, true) + query));
    expect(await image.text()).toBe(descriptor.svg);
  });

  it.each(['autos', 'spacex'] as const)('returns matching %s JSON, SVG and POST generation with live state', async skin => {
    const options = { skin, skinVersion: 1 as const, eyeStyle: 'live-v1' as const,
      size: 128, animated: false, state: { blink: 0.25, gaze: { x: -0.5, y: 1 } } };
    const query = `?skin=${skin}&skinVersion=1&eyeStyle=live-v1&size=128&animated=false&blink=0.25&gazeX=-0.5&gazeY=1`;
    const descriptor = await handler(new Request(path() + query));
    expect(descriptor.status).toBe(200);
    expectCors(descriptor);
    const expected = generateCharacter(did, options);
    expect(await descriptor.json()).toEqual(expected);
    const image = await handler(new Request(path(did, true) + query));
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
    expect(image.headers.get('content-security-policy')).toBe("default-src 'none'; img-src 'none'; style-src 'none'; sandbox");
    const svg = await image.text();
    expect(svg).toBe(expected.svg);
    expect(svg).not.toMatch(/<(?:script|style|image|foreignObject)\b|(?:href|onload)=/i);
    const generated = await handler(post({ did, ...options }));
    expect(generated.status).toBe(200);
    expect(generated.headers.get('cache-control')).toBe('no-store');
    expect(generated.headers.get('etag')).toBeNull();
    expectCors(generated, 'POST, OPTIONS');
    expect(await generated.json()).toEqual(expected);
  });

  it.each([
    did,
    did.replace(':agent:', ':agent:instance:'),
    did.replace('did:oas:openagent:', 'did:l1fe:'),
    'did:l1fe:agent:public-character-fixture',
  ])('accepts an existing agent identifier without creating or authenticating it: %s', async identity => {
    const response = await handler(new Request(path(identity)));
    expect(response.status).toBe(200);
    const descriptor = await response.json();
    expect(descriptor).toEqual(generateCharacter(identity));
    expect(descriptor).toMatchObject({ did: identity, skin: 'autos', skinVersion: 1,
      eyeStyle: 'live-v1', expression: 'neutral', size: 512, animated: true, state: { blink: 0, gaze: { x: 0, y: 0 } } });
    expect(descriptor).not.toHaveProperty('owner');
    expect(descriptor).not.toHaveProperty('verified');
  });

  it.each([
    '?skin=unknown', '?skin=', '?skinVersion=2', '?skinVersion=01', '?eyeStyle=live-v2',
    '?size=31', '?size=2049', '?size=128.5', '?size=0128', '?size=1e2', '?size=NaN',
    '?animated=1', '?animated=True', '?animated=', '?blink=-0.1', '?blink=1.01',
    '?blink=NaN', '?blink=Infinity', '?blink=.5', '?blink=1e-1', '?blink=+0.5',
    '?gazeX=0', '?gazeY=0', '?gazeX=-1.01&gazeY=0', '?gazeX=0&gazeY=1.01',
    '?state={}', '?avatarOverride=https://images.example.org/a.svg', '?__proto__=x',
    '?skin=autos&skin=spacex', '?skin=autos&%73kin=autos', '?blink=0&blink=0',
    '?shape=unknown', '?skin=autos&shape=circle', '?skin=spacex&shape=standard',
    '?expression=unknown', '?expression=Happy', '?expression=neutral&expression=happy', '?style=pill',
    '?view=unknown', '?view=', '?view=Avatar', '?view=avatar%0A', '?view=avatar&view=full',
    '?view=avatar&%76iew=avatar', '?view=avatar&view=avatar', '?skin=pumpkin', '?kind=pumpkin',
    '?skin=halloween&shape=tree', '?skin=christmas&shape=ghost', '?skin=thanksgiving&shape=gift',
    '?accessories=unknown', '?accessories=Glasses', '?accessories=glasses%20', '?accessories=%20glasses',
    '?accessories=glasses,glasses', '?accessories=headphones,headphones',
    '?accessories=glasses,headphones,glasses', '?accessories=glasses,', '?accessories=,headphones',
    '?accessories=,', '?accessories=glasses,,headphones', '?accessories=null', '?accessories=%5B%5D',
    '?accessories=glasses&accessories=headphones', '?accessories=&accessories=',
    '?accessories=glasses&%61ccessories=glasses', '?accessories=glasses%0A',
    '?state.accessories=glasses', '?accessory=glasses',
    '?status=unknown', '?status=Idle', '?status=', '?status=reasoning%0A',
    '?status=idle&status=working', '?status=idle&%73tatus=idle', '?state.expression=happy',
    '?status=unknown&expression=happy', '?status=success&expression=unknown',
  ])('rejects invalid or ambiguous query inputs before rendering or 304: %s', async query => {
    const response = await handler(new Request(path(did, true) + query, { headers: { 'if-none-match': '*' } }));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('etag')).toBeNull();
    expectCors(response);
    expect(await response.json()).toEqual({ error: 'invalid_request' });
  });

  it.each([
    '', 'not-a-did', did.replace(':agent:', ':hmr:'), did.replace(':agent:', ':tool:'),
    did + '"/><script/>', 'did:oas:openagent:agent:' + 'a'.repeat(513),
    'did:oas:INVALID:agent:example', 'did:oas:openagent:agent:example/other',
  ])('refuses non-agent, oversized or markup identifiers: %s', async identity => {
    const response = await handler(new Request(path(identity)));
    expect([400, 404]).toContain(response.status);
    expectCors(response);
    expect(response.headers.get('etag')).toBeNull();
  });

  it('rejects malformed percent encoding and excessive URL input', async () => {
    expect((await handler(new Request(`${base}/svg/%E0%A4%A`))).status).toBe(400);
    const response = await handler(new Request(path() + '?skin=' + 'a'.repeat(8192)));
    expect(response.status).toBe(400);
    expectCors(response);
  });

  it.each([
    null, [], 'string', {}, { did: null }, { did, unknown: true },
    { did, skin: null }, { did, skin: 'other' }, { did, skinVersion: '1' },
    { did, skinVersion: 2 }, { did, eyeStyle: 'live-v2' }, { did, eyeStyle: null },
    { did, size: '128' }, { did, size: 128.5 }, { did, size: 31 }, { did, size: 2049 },
    { did, animated: 'false' }, { did, state: null }, { did, state: [] },
    { did, state: { unknown: 0 } }, { did, state: { blink: null } }, { did, state: { blink: 1.1 } },
    { did, state: { gaze: null } }, { did, state: { gaze: { x: 0 } } },
    { did, state: { gaze: { x: 0, y: 0, z: 0 } } }, { did, state: { gaze: { x: -2, y: 0 } } },
    { did, shape: null }, { did, shape: 'unknown' }, { did, skin: 'autos', shape: 'circle' },
    { did, skin: 'spacex', shape: 'standard' }, { did, expression: null },
    { did, expression: 'unknown' }, { did, expression: 'Happy' }, { did, style: 'pill' },
    { did, status: 'working' }, { did, state: { status: null } }, { did, state: { status: true } },
    { did, state: { status: [] } }, { did, state: { status: {} } }, { did, state: { status: '' } },
    { did, state: { status: 'Working' } }, { did, state: { status: 'working\n' } },
    { did, state: { expression: null } }, { did, state: { expression: true } },
    { did, state: { expression: [] } }, { did, state: { expression: 'working' } },
    { did, state: { expression: 'unknown' } }, { did, state: { expression: 'Thoughtful' } },
    { did, expression: 'unknown', state: { status: 'success' } },
    { did, state: { expression: 'happy', status: 'unknown' } },
    { did, state: { expression: 'concerned', status: 'idle', unknown: 0 } },
    { did, view: null }, { did, view: 1 }, { did, view: [] }, { did, view: {} },
    { did, view: 'Avatar' }, { did, view: 'avatar\n' }, { did, view: 'unknown' },
    { did, skin: 'pumpkin' }, { did, kind: 'pumpkin' },
    { did, skin: 'halloween', shape: 'tree' }, { did, skin: 'christmas', shape: 'ghost' },
    { did, skin: 'thanksgiving', shape: 'gift' },
    { did, accessories: null }, { did, accessories: 'glasses' }, { did, accessories: true },
    { did, accessories: 0 }, { did, accessories: {} }, { did, accessories: ['unknown'] },
    { did, accessories: ['Glasses'] }, { did, accessories: ['glasses '] },
    { did, accessories: ['glasses\n'] }, { did, accessories: [''] }, { did, accessories: [null] },
    { did, accessories: [{ id: 'glasses' }] }, { did, accessories: ['glasses', 'glasses'] },
    { did, accessories: ['headphones', 'headphones'] }, { did, accessories: ['glasses', 'headphones', 'glasses'] },
    { did, state: { accessories: ['glasses'] } }, { did, accessory: 'glasses' },
  ])('rejects invalid JSON schema input: %j', async body => {
    const response = await handler(post(body));
    expect(response.status).toBe(400);
    expectCors(response);
    expect(await response.json()).toEqual({ error: 'invalid_request' });
  });

  it('accepts minimal POST defaults, state defaults, integer bounds and finite eye-state bounds', async () => {
    for (const body of [{ did }, { did, state: {} },
      { did, size: 32, animated: false, state: { blink: 1, gaze: { x: -1, y: 1 } } },
      { did, skin: 'spacex' as const, size: 2048, state: { gaze: { x: 1, y: -1 } } }]) {
      const response = await handler(post(body));
      expect(response.status).toBe(200);
      const { did: identity, ...options } = body;
      expect(await response.json()).toEqual(generateCharacter(identity, options));
    }
  });

  it('accepts every catalog shape only under its skin and every shared expression without changing the body', async () => {
    for (const skin of getCharacterSkins()) {
      for (const shape of skin.shapes) {
        const options = { skin: skin.id, shape, animated: false };
        const get = await handler(new Request(path() + `?skin=${skin.id}&shape=${shape}&animated=false`));
        expect(get.status).toBe(200);
        expect(await get.json()).toEqual(generateCharacter(did, options));
        const generated = await handler(post({ did, ...options }));
        expect(generated.status).toBe(200);
        expect(await generated.json()).toEqual(generateCharacter(did, options));
      }
      const neutral = generateCharacter(did, { skin: skin.id });
      for (const expression of getCharacterExpressions()) {
        const options = { skin: skin.id, expression, animated: false };
        const response = await handler(new Request(path() + `?skin=${skin.id}&expression=${expression}&animated=false`));
        expect(response.status).toBe(200);
        const descriptor = await response.json();
        expect(descriptor).toEqual(generateCharacter(did, options));
        expect(descriptor).toMatchObject({ expression, shape: neutral.shape, color: neutral.color });
        const generated = await handler(post({ did, ...options }));
        expect(generated.status).toBe(200);
        expect(await generated.json()).toEqual(descriptor);
      }
    }
  });

  it.each(['text/plain', 'application/xml', 'application/problem+json', 'application/json; charset=latin1', ''])
  ('rejects unsupported content types: %s', async contentType => {
    const response = await handler(post({ did }, { 'content-type': contentType }));
    expect(response.status).toBe(415);
    expectCors(response);
    expect(await response.json()).toEqual({ error: 'unsupported_media_type' });
  });

  it('accepts UTF-8 JSON and refuses compressed, malformed, missing and non-finite JSON bodies', async () => {
    expect((await handler(post({ did }, { 'content-type': 'Application/JSON; charset="UTF-8"' }))).status).toBe(200);
    expect((await handler(post({ did }, { ...jsonHeaders, 'content-encoding': 'gzip' }))).status).toBe(415);
    for (const body of ['', '{', `{"did":${JSON.stringify(did)},"size":1e400}`]) {
      expect((await handler(new Request(`${base}/generate`, { method: 'POST', headers: jsonHeaders, body }))).status).toBe(400);
    }
    expect((await handler(new Request(`${base}/generate`, { method: 'POST', headers: jsonHeaders }))).status).toBe(400);
    expect((await handler(new Request(`${base}/generate`, {
      method: 'POST', headers: jsonHeaders, body: new Uint8Array([0xc3, 0x28]),
    }))).status).toBe(400);
  });

  it('enforces announced and actual byte limits, including multibyte and streamed bodies', async () => {
    const minimal = JSON.stringify({ did });
    for (const [length, status] of [[16_384, 200], [16_385, 413]] as const) {
      const body = minimal + ' '.repeat(length - minimal.length);
      const response = await handler(new Request(`${base}/generate`, { method: 'POST', headers: jsonHeaders, body }));
      expect(response.status).toBe(status);
      expectCors(response);
    }
    const announced = await handler(post({ did }, { ...jsonHeaders, 'content-length': '16385' }));
    expect(announced.status).toBe(413);
    expect(await announced.json()).toEqual({ error: 'body_too_large' });
    const malformedLength = await handler(post({ did }, { ...jsonHeaders, 'content-length': 'invalid' }));
    expect(malformedLength.status).toBe(400);
    const bytes = new TextEncoder().encode(JSON.stringify({ did, unused: 'é'.repeat(8192) }));
    expect(bytes.byteLength).toBeGreaterThan(16_384);
    expect((await handler(new Request(`${base}/generate`, { method: 'POST', headers: jsonHeaders, body: bytes }))).status).toBe(413);
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(minimal));
        controller.enqueue(new TextEncoder().encode(' '.repeat(16_384)));
      },
      cancel() { cancelled = true; },
    });
    const init: RequestInit & { duplex: 'half' } = { method: 'POST', headers: jsonHeaders, body: stream, duplex: 'half' };
    expect((await handler(new Request(`${base}/generate`, init))).status).toBe(413);
    expect(cancelled).toBe(true);
  });

  it('bounds work and cancels a body stream that produces excessive empty chunks', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array()); },
      cancel() { cancelled = true; },
    });
    const init: RequestInit & { duplex: 'half' } = { method: 'POST', headers: jsonHeaders, body: stream, duplex: 'half' };
    const response = await handler(new Request(`${base}/generate`, init));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_request' });
    expect(cancelled).toBe(true);
  });

  it.each([`${base}/skins`, `${base}/accessories`, `${base}/statuses`, `${base}/openapi.json`, path(), path(did, true), path() + '?status=reasoning', path(did, true) + '?status=blocked', path(did, true) + '?accessories=glasses,headphones'])
  ('keeps exact byte validators, HEAD headers and conditional CORS for %s', async url => {
    const get = await handler(new Request(url));
    const body = await get.text();
    const etag = `"${createHash('sha256').update(body).digest('hex')}"`;
    expect(get.headers.get('etag')).toBe(etag);
    expect(get.headers.get('content-length')).toBe(String(Buffer.byteLength(body)));
    const head = await handler(new Request(url, { method: 'HEAD' }));
    expect(head.status).toBe(200);
    expect([...head.headers]).toEqual([...get.headers]);
    expect(await head.text()).toBe('');
    for (const validator of [etag, `W/${etag}`, `"other", W/${etag}`, '*']) {
      for (const method of ['GET', 'HEAD']) {
        const cached = await handler(new Request(url, { method, headers: { 'if-none-match': validator } }));
        expect(cached.status).toBe(304);
        expect(await cached.text()).toBe('');
        expect(cached.headers.get('etag')).toBe(etag);
        expect(cached.headers.get('content-type')).toBe(get.headers.get('content-type'));
        expect(cached.headers.get('content-security-policy')).toBe(get.headers.get('content-security-policy'));
        expectCors(cached, 'GET, HEAD, OPTIONS');
      }
    }
    expect((await handler(new Request(url, { headers: { 'if-none-match': '"not-this-representation"' } }))).status).toBe(200);
  });

  it('changes validators with skin, shape, expression, eye state, size, animation or representation', async () => {
    const urls = [path(), path() + '?skin=spacex', path() + '?blink=0.5',
      path() + '?gazeX=1&gazeY=0', path() + '?size=128', path() + '?animated=false',
      path() + '?shape=wide&expression=happy', path(did, true)];
    urls.push(path() + '?status=reasoning', path() + '?status=blocked', path() + '?view=full',
      path() + '?accessories=glasses', path() + '?accessories=headphones');
    const tags = [];
    for (const url of urls) tags.push((await handler(new Request(url))).headers.get('etag'));
    expect(new Set(tags).size).toBe(urls.length);
    const wrongValidator = await handler(new Request(path() + '?skin=spacex', { headers: { 'if-none-match': tags[0]! } }));
    expect(wrongValidator.status).toBe(200);
    const postResponse = await handler(new Request(`${base}/generate`, {
      method: 'POST', headers: { ...jsonHeaders, 'if-none-match': '*' }, body: JSON.stringify({ did }),
    }));
    expect(postResponse.status).toBe(200);
    expect(postResponse.headers.get('etag')).toBeNull();
  });

  it.each([`${base}/skins`, `${base}/accessories`, `${base}/statuses`, `${base}/openapi.json`, path() + '?size=128', path(did, true) + '?skin=spacex', path() + '?status=working', path(did, true) + '?accessories=glasses', `${base}/generate`])
  ('supports credential-free CORS preflight for %s', async url => {
    const response = await handler(new Request(url, { method: 'OPTIONS', headers: {
      origin: 'https://client.example.org', 'access-control-request-method': url.endsWith('/generate') ? 'POST' : 'GET',
      'access-control-request-headers': 'Content-Type, If-None-Match',
    } }));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expectCors(response, url.endsWith('/generate') ? 'POST, OPTIONS' : 'GET, HEAD, OPTIONS');
    expect(response.headers.get('access-control-allow-headers')).toBe('Content-Type, If-None-Match');
  });

  it('limits methods, unknown routes and reserved-route queries with CORS on all errors', async () => {
    for (const [url, method, status, allow] of [
      [path(), 'POST', 405, 'GET, HEAD, OPTIONS'],
      [`${base}/generate`, 'GET', 405, 'POST, OPTIONS'],
      [`${base}/skins`, 'DELETE', 405, 'GET, HEAD, OPTIONS'],
      [`${base}/accessories`, 'POST', 405, 'GET, HEAD, OPTIONS'],
      [`${base}/statuses`, 'POST', 405, 'GET, HEAD, OPTIONS'],
      [`${base}/generate`, 'HEAD', 405, 'POST, OPTIONS'],
      ['https://characters.example.org/other', 'GET', 404, null],
      [`${base}/svg/a/b`, 'GET', 404, null],
    ] as const) {
      const response = await handler(new Request(url, { method }));
      expect(response.status).toBe(status);
      expect(response.headers.get('allow')).toBe(allow);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expectCors(response);
      if (method === 'HEAD') expect(await response.text()).toBe('');
    }
    for (const url of [`${base}/skins?size=128`, `${base}/accessories?accessories=glasses`, `${base}/statuses?status=idle`, `${base}/openapi.json?x=1`]) {
      expect((await handler(new Request(url))).status).toBe(400);
    }
    expect((await handler(new Request(`${base}/generate?skin=autos`, {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ did }),
    }))).status).toBe(400);
    expect((await handler(new Request(path() + '?size=no', { method: 'OPTIONS' }))).status).toBe(400);
    expect((await handler(new Request(path() + '?status=unknown', { method: 'OPTIONS' }))).status).toBe(400);
    expect((await handler(new Request(`${base}/statuses?status=idle`, { method: 'OPTIONS' }))).status).toBe(400);
    expect((await handler(new Request(`${base}/accessories?skin=autos`, { method: 'OPTIONS' }))).status).toBe(400);
  });

  it('supports an explicit mount path and reports it in the schema', async () => {
    const mounted = createCharacterApiHandler({ basePath: '/api/characters' });
    const image = await mounted(new Request(`https://characters.example.org/api/characters/svg/${encodeURIComponent(did)}`));
    expect(image.status).toBe(200);
    expect(await image.text()).toBe(generateCharacter(did).svg);
    const statuses = await mounted(new Request('https://characters.example.org/api/characters/statuses'));
    expect(await statuses.json()).toEqual(getCharacterStatuses());
    const accessories = await mounted(new Request('https://characters.example.org/api/characters/accessories'));
    expect(await accessories.json()).toEqual(getCharacterAccessories());
    const schema = await mounted(new Request('https://characters.example.org/api/characters/openapi.json'));
    expect(await schema.json()).toEqual({ ...characterApiOpenApi, servers: [{ url: '/api/characters' }] });
    expect((await mounted(new Request(path()))).status).toBe(404);
    for (const basePath of ['', '/', 'v1/characters', '/v1/characters/', '/a//b', '/a/../b', '/a?x=1', '/a#x', '/a%2Fb']) {
      expect(() => createCharacterApiHandler({ basePath })).toThrow(TypeError);
    }
  });
});
