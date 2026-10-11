import { blake3 } from '@noble/hashes/blake3';
import { describe, expect, it } from 'vitest';
import { isAgentAvatarDid as rootClassifier, didSchema, identityDocumentSchema } from '../src/index.js';
import { isAgentAvatarDid, generateCharacter, getCharacterExpressions, renderCharacterSvg } from '../src/characters.js';
import { isAgentAvatarDid as glyphClassifier, agentAvatar, glyphCodeword, glyphEndpoint, oasGlyph } from '../src/glyph.js';
import { createCharacterApiHandler, characterApiOpenApi } from '../src/character-api.js';

// Public ULID reference fixture, not a principal or an assertion of control.
const did = 'did:oas:agent-instance:01ARZ3NDEKTSV4RRFFQ69G5FAV';
const canonical = 'did:oas:openagent:agent:instance:01ARZ3NDEKTSV4RRFFQ69G5FAV';
const invalid = [
  did.toLowerCase(), did.replace(':01', ':81'), did.slice(0, -1), did + '0',
  did.replace('01AR', '01IR'), did.replace('01AR', '01LR'), did.replace('01AR', '01OR'),
  did.replace('01AR', '01UR'), did + '\n', did + '\r\n', did + ' ', ' ' + did,
  did + ':other', 'did:oas:agent-instance:worker', 'did:oas:agent-instance:',
];
const classifiers = [isAgentAvatarDid, glyphClassifier, rootClassifier];
const decode = (value: string): string => decodeURIComponent(value.split(',')[1]!);
const handler = createCharacterApiHandler();
const base = 'https://characters.example.org/v1/characters';

describe('display-only IAM agent instance compatibility', () => {
  // Independent hash-pinned Python blake3 1.0.11 derivation on Depot p4l87sht4v.
  // Neither the SDK renderer nor noble was used to calculate these vectors.
  it.each([
    { skin: 'autos' as const, digest: '181ac27a900e94a534e66438dab89cd91c02a16b0711f4e2ffa51f597e2285d8', shape: 'standard', color: '#ff6a00' },
    { skin: 'spacex' as const, digest: 'f9ac98e7ea92088f416ec26d94d32c1285c523d392094c28f7b7004d56230748', shape: 'pebble', color: '#00c875' },
  ])('matches the independent literal IAM $skin vector', ({ skin, digest, shape, color }) => {
    const character = generateCharacter(did, { skin });
    expect(character).toMatchObject({ did, skin, shape, color });
    expect(character.svg).toContain(`data-character-seed="${digest}"`);
  });

  it('matches the independent opaque Glyph digest and unassigned namespace vector', () => {
    const codeword = glyphCodeword(did);
    expect([...codeword.slice(0, 3)]).toEqual([0x24, 0xaf, 32]);
    expect(Buffer.from(codeword.slice(3, 35)).toString('hex'))
      .toBe('8d09bebc7ff2ca68e7e5b9bb7a2305db83d960fbc251724c256c6ccc2a3887c7');
  });

  it.each([did, 'did:oas:agent-instance:' + '0'.repeat(26), 'did:oas:agent-instance:7' + 'Z'.repeat(25),
    canonical, 'did:oas:agent-instance:agent:worker', 'did:l1fe:agent:worker', 'did:l1fe:agent:instance:worker'])
  ('shares one classifier and preserves the complete supported identifier: %s', identity => {
    for (const classifier of classifiers) expect(classifier(identity)).toBe(true);
    expect(generateCharacter(identity).did).toBe(identity);
  });

  it.each([...invalid, null, undefined, 1, {}, [],
    'did:oas:openagent:hmr:person', 'did:oas:openagent:tool:hammer', did + '<script>'])
  ('refuses malformed or non-agent input without normalization: %j', value => {
    for (const classifier of classifiers) expect(classifier(value)).toBe(false);
    expect(() => generateCharacter(value as string)).toThrow();
  });

  it('does not widen principal, identity-document or proof admission', () => {
    expect(didSchema.safeParse(did).success).toBe(false);
    expect(identityDocumentSchema.shape.did.safeParse(did).success).toBe(false);
    expect(didSchema.parse(canonical)).toBe(canonical);
  });

  it.each([canonical + '\n', canonical + '\r\n', canonical + ' ', canonical + '\t'])
  ('also refuses trailing whitespace on namespaced display input: %j', identity => {
    expect(isAgentAvatarDid(identity)).toBe(false);
    expect(() => renderCharacterSvg(identity)).toThrow();
  });

  it.each(['autos', 'spacex'] as const)('hashes the exact IAM literal for %s across all eye expressions', skin => {
    const digest = Buffer.from(blake3(new TextEncoder().encode(`oaid-character-v1\u0000${skin}\u0000${did}`))).toString('hex');
    const neutral = generateCharacter(did, { skin });
    expect(neutral.svg).toContain(`data-character-seed="${digest}"`);
    expect(neutral.svg).not.toBe(generateCharacter(canonical, { skin }).svg);
    for (const expression of getCharacterExpressions()) {
      const character = generateCharacter(did, { skin, expression, animated: false });
      expect(character).toMatchObject({ did, skin, expression, shape: neutral.shape, color: neutral.color });
      expect(character.svg).toContain(`data-character-seed="${digest}"`);
      expect(character.svg).not.toMatch(/<animate(?:Transform)?\b/);
      expect(generateCharacter(did, { skin, expression }).svg).toMatch(/<animateTransform\b/);
    }
  });

  it.each([did, 'did:oas:agent-instance:7' + 'Z'.repeat(25)])
  ('encodes even base58-compatible ULIDs as opaque full-DID Glyph digests: %s', identity => {
    const codeword = glyphCodeword(identity);
    expect(codeword[0]).toBe(0x24); // Named avatar v2, agent instance kind four.
    expect(codeword[1]).toBe(blake3(new Uint8Array())[0]); // No assigned namespace.
    expect(codeword[2]).toBe(32);
    expect(codeword.slice(3, 35)).toEqual(blake3(new TextEncoder().encode('oas-glyph-avatar-v2\u0000' + identity)));
    expect(oasGlyph(identity)).not.toBe(oasGlyph(canonical));
  });

  it('uses Autos by default, preserves profile preference, Glyph selection and override precedence', () => {
    expect(decode(agentAvatar(did))).toBe(renderCharacterSvg(did));
    expect(decode(agentAvatar(did, { avatarSkin: { skin: 'spacex', shape: 'cloud' }, avatarExpression: 'curious' }, { animated: false })))
      .toBe(renderCharacterSvg(did, { skin: 'spacex', shape: 'cloud', expression: 'curious', animated: false }));
    expect(decode(agentAvatar(did, { avatarSkin: null }))).toBe(oasGlyph(did));
    expect(agentAvatar(did, { avatarOverride: 'https://images.example.org/agent.svg' })).toBe('https://images.example.org/agent.svg');
    expect(decode(agentAvatar(did, { avatarOverride: null }))).toBe(renderCharacterSvg(did));
  });

  it('serves literal IAM JSON/SVG/POST and matching HEAD/304 without identity claims', async () => {
    for (const svg of [false, true]) {
      const url = `${base}/${svg ? 'svg/' : ''}${encodeURIComponent(did)}?skin=spacex&expression=curious`;
      const get = await handler(new Request(url));
      expect(get.status).toBe(200);
      const expected = generateCharacter(did, { skin: 'spacex', expression: 'curious' });
      if (svg) expect(await get.text()).toBe(expected.svg);
      else {
        const body = await get.json();
        expect(body).toEqual(expected);
        expect(body).not.toHaveProperty('verified');
        expect(body).not.toHaveProperty('owner');
      }
      const head = await handler(new Request(url, { method: 'HEAD' }));
      expect(head.status).toBe(200);
      expect(await head.text()).toBe('');
      expect(head.headers.get('etag')).toBe(get.headers.get('etag'));
      const conditional = await handler(new Request(url, { headers: { 'if-none-match': get.headers.get('etag')! } }));
      expect(conditional.status).toBe(304);
      expect(await conditional.text()).toBe('');
    }
    const post = await handler(new Request(`${base}/generate`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ did, skin: 'autos', expression: 'happy', animated: false }) }));
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual(generateCharacter(did, { skin: 'autos', expression: 'happy', animated: false }));
    const glyph = await glyphEndpoint(new Request(`https://characters.example.org/v1/glyph/svg/${encodeURIComponent(did)}`));
    expect(glyph.status).toBe(200);
    expect(await glyph.text()).toBe(oasGlyph(did));
  });

  it.each(invalid)('refuses malformed IAM input across API methods and Glyph: %j', async identity => {
    const url = `${base}/svg/${encodeURIComponent(identity)}`;
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect((await handler(new Request(url, { method }))).status).toBe(400);
    }
    expect((await handler(new Request(`${base}/generate`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ did: identity }) }))).status).toBe(400);
    expect(() => oasGlyph(identity)).toThrow();
  });

  it('publishes the same literal rendering boundary in OpenAPI', () => {
    const schema = characterApiOpenApi.components.schemas.AgentDid;
    const pattern = new RegExp(schema.pattern);
    expect(pattern.test(did)).toBe(true);
    expect(pattern.test(canonical)).toBe(true);
    for (const identity of invalid) expect(pattern.test(identity)).toBe(false);
  });
});
