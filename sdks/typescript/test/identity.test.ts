import { describe, it, expect } from 'vitest';
import { StubIdentityProvider } from '@openagentid/sdk-testing';
import {
  parseIdentityDocument,
  toIdentityProvider,
  identityDocumentSchema,
  characterAppearanceSchema,
} from '../src/identity.js';
import { IdentityError, OpenAgentError } from '../src/errors.js';
import { getCharacterExpressions, getCharacterSkins } from '../src/characters.js';

describe('StubIdentityProvider', () => {
  it('creates agent identities with valid DIDs and lineage', async () => {
    const provider = new StubIdentityProvider('l1fe');
    const doc = await provider.createAgentIdentity({
      parent: 'did:oas:l1fe:hmr:alice',
      name: 'bot',
      scopes: ['openai:chat:completions'],
    });
    expect(doc.did.startsWith('did:oas:l1fe:agent:')).toBe(true);
    expect(doc.parent).toBe('did:oas:l1fe:hmr:alice');
    expect(doc.scopes).toEqual(['openai:chat:completions']);
    expect(doc.kind).toBe('agent');
    identityDocumentSchema.parse(doc);
  });

  it('resolves previously created DIDs', async () => {
    const provider = new StubIdentityProvider();
    const doc = await provider.createAgentIdentity({
      parent: 'did:oas:l1fe:hmr:alice',
      name: 'a',
      scopes: ['openai:chat:completions'],
    });
    const resolved = await provider.resolve(doc.did);
    expect(resolved).toEqual(doc);
  });

  it('throws IdentityError on unknown DID', async () => {
    const provider = new StubIdentityProvider();
    await expect(provider.resolve('did:oas:l1fe:agent:nope')).rejects.toBeInstanceOf(
      IdentityError,
    );
  });

  it('signs challenges only for known DIDs', async () => {
    const provider = new StubIdentityProvider();
    const doc = await provider.createAgentIdentity({
      parent: 'did:oas:l1fe:hmr:alice',
      name: 'a',
      scopes: ['openai:chat:completions'],
    });
    const sig = await provider.signChallenge(doc.did, new Uint8Array([1, 2, 3]));
    expect(sig.signer).toBe(doc.did);
    expect(sig.expiresAt).toBeGreaterThan(sig.issuedAt);

    await expect(
      provider.signChallenge('did:oas:l1fe:agent:unknown', new Uint8Array()),
    ).rejects.toBeInstanceOf(IdentityError);
  });

  it('exposes public key via publicKey()', async () => {
    const provider = new StubIdentityProvider();
    const doc = await provider.createAgentIdentity({
      parent: 'did:oas:l1fe:hmr:alice',
      name: 'a',
      scopes: ['openai:chat:completions'],
    });
    const pk = await provider.publicKey(doc.did);
    expect(pk).toBe(doc.publicKeyMultibase);
  });
});

describe('parseIdentityDocument', () => {
  it('accepts valid documents', () => {
    const doc = parseIdentityDocument({
      did: 'did:oas:l1fe:agent:bot',
      parent: 'did:oas:l1fe:hmr:alice',
      publicKeyMultibase: 'z123',
      kind: 'agent',
      scopes: ['openai:chat:completions'],
      createdAt: new Date().toISOString(),
    });
    expect(doc.did).toBe('did:oas:l1fe:agent:bot');
  });

  it('throws IdentityError on invalid payload', () => {
    expect(() => parseIdentityDocument({ bad: 'payload' })).toThrow(IdentityError);
  });
});

describe('stored character appearance', () => {
  // Public display document only; parsing makes no ownership or possession claim.
  const document = {
    did: 'did:oas:openagent:agent:profile-conformance',
    parent: 'did:oas:openagent:hmr:profile-owner',
    publicKeyMultibase: 'z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    kind: 'agent', scopes: [], createdAt: '2026-10-12T00:00:00Z',
  };

  it('persists every family kind separately from shared preferred eye expressions', () => {
    const catalog = getCharacterSkins();
    expect(catalog).toHaveLength(18);
    expect(catalog.reduce((total, skin) => total + skin.shapes.length, 0)).toBe(77);
    for (const skin of catalog) {
      for (const shape of skin.shapes) {
        const appearance = { skin: skin.id, skinVersion: 1 as const, eyeStyle: skin.eyeStyles[0]!, shape };
        expect(characterAppearanceSchema.parse(appearance)).toEqual(appearance);
        for (const avatarExpression of getCharacterExpressions()) {
          const parsed = parseIdentityDocument({ ...document, avatarSkin: appearance, avatarExpression });
          expect(parsed.avatarSkin).toEqual(appearance);
          expect(parsed.avatarExpression).toBe(avatarExpression);
          expect(parsed.did).toBe(document.did);
          expect(parsed.parent).toBe(document.parent);
          expect(parsed).not.toHaveProperty('verified');
          expect(parsed).not.toHaveProperty('view');
        }
      }
    }
  });

  it('retains omitted defaults, explicit Glyph migration and HTTPS overrides without adding runtime state', () => {
    const absent = parseIdentityDocument(document);
    expect(absent.avatarSkin).toBeUndefined();
    expect(absent.avatarExpression).toBeUndefined();
    const glyph = parseIdentityDocument({ ...document, avatarSkin: null, avatarOverride: null });
    expect(glyph.avatarSkin).toBeNull();
    expect(glyph.avatarOverride).toBeNull();
    const minimal = parseIdentityDocument({ ...document, avatarSkin: { skin: 'christmas' } });
    expect(minimal.avatarSkin).toEqual({ skin: 'christmas' });
    const override = 'https://images.example.org/my-agent.svg';
    const profile = { skin: 'halloween' as const, shape: 'ghost' as const };
    const custom = parseIdentityDocument({ ...document, avatarSkin: profile, avatarOverride: override, avatarExpression: 'thoughtful' });
    expect(custom.avatarSkin).toEqual(profile);
    expect(custom.avatarOverride).toBe(override);
    expect(custom.avatarExpression).toBe('thoughtful');
  });

  it('persists material and eye placement as optional appearance selectors on every family, independently of preferred expression', () => {
    for (const skin of getCharacterSkins()) {
      for (const finish of ['plush', 'flat'] as const) {
        for (const eyePlacement of ['face', 'raised'] as const) {
          const avatarSkin = { skin: skin.id, shape: skin.shapes[0]!, finish, eyePlacement,
            accessories: ['headphones', 'glasses'] };
          const parsed = parseIdentityDocument({ ...document, avatarSkin, avatarExpression: 'thoughtful' });
          expect(parsed.avatarSkin).toEqual({ ...avatarSkin, accessories: ['glasses', 'headphones'] });
          expect(parsed.avatarExpression).toBe('thoughtful');
          expect(parsed.did).toBe(document.did);
          expect(parsed.parent).toBe(document.parent);
          expect(parsed).not.toHaveProperty('finish');
          expect(parsed).not.toHaveProperty('eyePlacement');
        }
      }
    }
    const minimal = characterAppearanceSchema.parse({ skin: 'autos' });
    expect(minimal).toEqual({ skin: 'autos' });
    expect(minimal).not.toHaveProperty('finish');
    expect(minimal).not.toHaveProperty('eyePlacement');
  });

  it.each([
    { finish: null }, { finish: '' }, { finish: 'unknown' }, { finish: 'Plush' },
    { finish: 'plush ' }, { finish: true }, { finish: [] }, { finish: {} },
    { eyePlacement: null }, { eyePlacement: '' }, { eyePlacement: 'unknown' },
    { eyePlacement: 'Face' }, { eyePlacement: 'raised\n' }, { eyePlacement: 1 },
    { eyePlacement: [] }, { eyePlacement: {} }, { 'eye-placement': 'raised' },
    { state: { finish: 'flat' } }, { state: { eyePlacement: 'raised' } },
  ])('refuses invalid material or eye placement in stored profiles: %j', selectors => {
    const avatarSkin = { skin: 'christmas', shape: 'snowman', ...selectors };
    expect(characterAppearanceSchema.safeParse(avatarSkin).success).toBe(false);
    expect(() => parseIdentityDocument({ ...document, avatarSkin })).toThrow(IdentityError);
  });

  it('stores canonical accessory selections on every family kind without changing identity or expression', () => {
    const selections = [[], ['glasses'], ['headphones'], ['headphones', 'glasses']] as const;
    for (const skin of getCharacterSkins()) {
      for (const shape of skin.shapes) {
        for (const accessories of selections) {
          const parsed = parseIdentityDocument({ ...document,
            avatarSkin: { skin: skin.id, shape, accessories }, avatarExpression: 'concerned' });
          expect(parsed.avatarSkin).toEqual({ skin: skin.id, shape,
            accessories: accessories.length === 2 ? ['glasses', 'headphones'] : [...accessories] });
          expect(Object.isFrozen(parsed.avatarSkin!.accessories)).toBe(true);
          expect(parsed.did).toBe(document.did);
          expect(parsed.parent).toBe(document.parent);
          expect(parsed.avatarExpression).toBe('concerned');
          expect(parsed).not.toHaveProperty('accessories');
        }
      }
    }
    const absent = parseIdentityDocument({ ...document, avatarSkin: { skin: 'autos' } });
    expect(absent.avatarSkin).toEqual({ skin: 'autos' });
    expect(absent.avatarSkin).not.toHaveProperty('accessories');
    const explicitEmpty = parseIdentityDocument({ ...document, avatarSkin: { skin: 'autos', accessories: [] } });
    expect(explicitEmpty.avatarSkin).toEqual({ skin: 'autos', accessories: [] });
    const source = ['headphones', 'glasses'];
    const normalized = characterAppearanceSchema.parse({ skin: 'autos', accessories: source });
    expect(source).toEqual(['headphones', 'glasses']);
    expect(normalized.accessories).toEqual(['glasses', 'headphones']);
    expect(normalized.accessories).not.toBe(source);
  });

  it.each([
    null, 'glasses', true, 0, {}, [''], ['unknown'], ['Glasses'], ['glasses '], ['glasses\n'],
    [null], [undefined], [{ id: 'glasses' }], [['glasses']],
    ['glasses', 'glasses'], ['headphones', 'headphones'], ['glasses', 'headphones', 'glasses'],
  ])('refuses malformed, unknown or duplicate stored accessory selections: %j', accessories => {
    const avatarSkin = { skin: 'christmas', shape: 'snowman', accessories };
    expect(characterAppearanceSchema.safeParse(avatarSkin).success).toBe(false);
    expect(() => parseIdentityDocument({ ...document, avatarSkin })).toThrow(IdentityError);
  });

  it('refuses known kinds from any other family instead of repairing stored selectors', () => {
    const catalog = getCharacterSkins();
    for (const skin of catalog) {
      for (const other of catalog) {
        for (const shape of other.shapes) {
          if (skin.shapes.includes(shape)) continue;
          const avatarSkin = { skin: skin.id, shape };
          expect(characterAppearanceSchema.safeParse(avatarSkin).success).toBe(false);
          expect(() => parseIdentityDocument({ ...document, avatarSkin })).toThrow(IdentityError);
        }
      }
    }
  });

  it.each([
    {}, [], 'halloween', { shape: 'pumpkin' }, { skin: null }, { skin: 'pumpkin' },
    { skin: 'Halloween' }, { skin: 'halloween\n' }, { skin: 'halloween', shape: null },
    { skin: 'halloween', shape: 'Pumpkin' }, { skin: 'halloween', shape: 'pumpkin\n' },
    { skin: 'halloween', shape: 'tree' }, { skin: 'thanksgiving', shape: 'gift' },
    { skin: 'christmas', shape: 'ghost' }, { skin: 'autos', shape: 'pumpkin' },
    { skin: 'christmas', skinVersion: 2 }, { skin: 'christmas', skinVersion: '1' },
    { skin: 'christmas', skinVersion: null }, { skin: 'christmas', eyeStyle: 'other' },
    { skin: 'christmas', eyeStyle: null }, { skin: 'christmas', eyeStyle: 'agent-eye-v1' }, { skin: 'one', eyeStyle: 'live-v1' },
    { skin: 'one', shape: 'teal' }, { skin: 'one', shape: 'blue' }, { skin: 'one', shape: 'circle' }, { skin: 'one', color: 'lemon' },
    { skin: 'one', shape: 'star', color: 'cherry' }, { skin: 'one', shape: 'droplet', color: 'berry' }, { skin: 'one', shape: 'cloud', color: 'sky' },
    { skin: 'one', shape: 'charcoal', color: 'lemon' }, { skin: 'one', shape: 'star', color: 'teal' }, { skin: 'one', shape: 'star', color: 'charcoal' },
    { skin: 'one', shape: 'star', color: 'blank' }, { skin: 'one', shape: 'star', color: 'Lemon' }, { skin: 'one', shape: 'star', color: null },
    { skin: 'autos', color: 'lemon' }, { skin: 'spacex', shape: 'cloud', color: 'lavender' },
    { skin: 'christmas', view: 'avatar' },
    { skin: 'christmas', view: 'full' }, { skin: 'christmas', size: 128 },
    { skin: 'christmas', animated: false }, { skin: 'christmas', expression: 'happy' },
    { skin: 'christmas', status: 'working' }, { skin: 'christmas', state: { blink: 0 } },
    { skin: 'christmas', color: '#123456' }, { skin: 'christmas', kind: 'tree' },
    { skin: 'christmas', unknown: true },
  ])('refuses malformed appearance or rendering/live-state fields in a stored profile: %j', avatarSkin => {
    expect(characterAppearanceSchema.safeParse(avatarSkin).success).toBe(false);
    expect(() => parseIdentityDocument({ ...document, avatarSkin })).toThrow(IdentityError);
  });

  it('stores a One look as a shape and a colour the shape allows, or Digital One', () => {
    for (const avatarSkin of [{ skin: 'one', shape: 'star', color: 'lemon' }, { skin: 'one', shape: 'droplet', color: 'lime' }, { skin: 'one', shape: 'star' },
      { skin: 'one', shape: 'charcoal' }, { skin: 'one' }, { skin: 'one', skinVersion: 1, eyeStyle: 'agent-eye-v1', shape: 'bean', color: 'grape' }] as const) {
      expect(characterAppearanceSchema.parse(avatarSkin)).toEqual(avatarSkin);
      expect(parseIdentityDocument({ ...document, avatarSkin }).avatarSkin).toEqual(avatarSkin);
    }
  });

  it.each([null, '', 'Happy', 'happy\n', 'working', true, [], {}, 'unknown'])
  ('refuses malformed preferred expression independently of a valid kind: %j', avatarExpression => {
    expect(() => parseIdentityDocument({ ...document,
      avatarSkin: { skin: 'christmas', shape: 'tree' }, avatarExpression })).toThrow(IdentityError);
  });

  it('refuses root rendering and live-state fields on identity documents', () => {
    for (const rendering of [{ view: 'full' }, { size: 128 }, { state: { status: 'success' } }, { status: 'working' },
      { accessories: ['glasses'] }, { avatarAccessories: ['glasses'] },
      { finish: 'plush' }, { eyePlacement: 'raised' }]) {
      expect(() => parseIdentityDocument({ ...document, ...rendering })).toThrow(IdentityError);
    }
  });
});

describe('toIdentityProvider', () => {
  it('accepts a duck-typed provider', () => {
    const provider = new StubIdentityProvider();
    expect(toIdentityProvider(provider)).toBe(provider);
  });

  it('rejects invalid clients', () => {
    expect(() => toIdentityProvider({})).toThrow(OpenAgentError);
    expect(() => toIdentityProvider(null)).toThrow(OpenAgentError);
  });
});
