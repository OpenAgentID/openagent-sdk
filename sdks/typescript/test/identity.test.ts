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
    expect(catalog).toHaveLength(17);
    expect(catalog.reduce((total, skin) => total + skin.shapes.length, 0)).toBe(62);
    for (const skin of catalog) {
      for (const shape of skin.shapes) {
        const appearance = { skin: skin.id, skinVersion: 1 as const, eyeStyle: 'live-v1' as const, shape };
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
    { skin: 'christmas', eyeStyle: null }, { skin: 'christmas', view: 'avatar' },
    { skin: 'christmas', view: 'full' }, { skin: 'christmas', size: 128 },
    { skin: 'christmas', animated: false }, { skin: 'christmas', expression: 'happy' },
    { skin: 'christmas', status: 'working' }, { skin: 'christmas', state: { blink: 0 } },
    { skin: 'christmas', color: '#123456' }, { skin: 'christmas', kind: 'tree' },
    { skin: 'christmas', unknown: true },
  ])('refuses malformed appearance or rendering/live-state fields in a stored profile: %j', avatarSkin => {
    expect(characterAppearanceSchema.safeParse(avatarSkin).success).toBe(false);
    expect(() => parseIdentityDocument({ ...document, avatarSkin })).toThrow(IdentityError);
  });

  it.each([null, '', 'Happy', 'happy\n', 'working', true, [], {}, 'unknown'])
  ('refuses malformed preferred expression independently of a valid kind: %j', avatarExpression => {
    expect(() => parseIdentityDocument({ ...document,
      avatarSkin: { skin: 'christmas', shape: 'tree' }, avatarExpression })).toThrow(IdentityError);
  });

  it('refuses root rendering and live-state fields on identity documents', () => {
    for (const rendering of [{ view: 'full' }, { size: 128 }, { state: { status: 'success' } }, { status: 'working' }]) {
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
