import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateCharacter, getCharacterSkins } from '@openagentid/sdk/characters';
import { SEASONAL_FAMILIES, decorativeAgentDid, isDecorativeAgentDid, pickYearRoundFamily, resolveButtonAppearance, yearRoundFamilies } from '../src/button-identity.js';

const catalog = getCharacterSkins();
const sequence = (...values: number[]) => {
  let index = 0;
  return (length: number) => Uint8Array.from({ length }, () => values[index++ % values.length]!);
};

describe('decorative Continue as Agent identity', () => {
  it('generates an agent DID the real generator accepts and that is recognizably decorative', () => {
    const did = decorativeAgentDid(sequence(1, 2, 3, 4, 5, 6, 7, 255));
    expect(did).toBe('did:oas:openagent:agent:decorative-01020304050607ff');
    expect(isDecorativeAgentDid(did)).toBe(true);
    expect(isDecorativeAgentDid('did:oas:openagent:agent:real-agent')).toBe(false);
    expect(generateCharacter(did, { size: 32 }).did).toBe(did);
    expect(() => decorativeAgentDid(() => new Uint8Array(3))).toThrow(TypeError);
  });

  it('only picks year-round families from the live SDK catalog', () => {
    const families = yearRoundFamilies(catalog);
    expect(families.length).toBe(catalog.length - SEASONAL_FAMILIES.size);
    expect(families.some(family => SEASONAL_FAMILIES.has(family.id))).toBe(false);
    for (const id of SEASONAL_FAMILIES) expect(catalog.some(family => family.id === id)).toBe(true);
    const seen = new Set<string>();
    for (let value = 0; value < families.length; value++) seen.add(pickYearRoundFamily(catalog, sequence(0, value)).id);
    expect(seen.size).toBe(families.length);
    // Values at or above the unbiased limit are rejected and redrawn.
    const limit = 65_536 - (65_536 % families.length);
    const high = limit === 65_536 ? [] : [255, 255];
    expect(pickYearRoundFamily(catalog, sequence(...high, 0, 1)).id).toBe(families[1]!.id);
    expect(() => yearRoundFamilies([{ id: 'halloween' }])).toThrow(/year-round/);
  });

  it('resolves a random decorative appearance once and keeps the host selection otherwise', () => {
    const random = resolveButtonAppearance(undefined, catalog, sequence(9, 9, 9, 9, 9, 9, 9, 9, 0, 2));
    expect(random.decorative).toBe(true);
    expect(random.did).toBe('did:oas:openagent:agent:decorative-0909090909090909');
    expect(random.skin).toBe(yearRoundFamilies(catalog)[2]!.id);
    expect(SEASONAL_FAMILIES.has(random.skin)).toBe(false);
    expect(generateCharacter(random.did, { skin: random.skin, size: 32 }).skin).toBe(random.skin);

    const chosen = resolveButtonAppearance({ did: 'did:oas:openagent:agent:selected', shape: 'wide', accessories: ['glasses'] }, catalog, () => { throw new Error('no randomness needed'); });
    expect(chosen).toEqual({ did: 'did:oas:openagent:agent:selected', skin: 'autos', shape: 'wide', accessories: ['glasses'], decorative: false });
    expect(resolveButtonAppearance({ did: 'did:oas:openagent:agent:selected', skin: 'christmas' }, catalog, () => new Uint8Array(0)).skin).toBe('christmas');
  });

  it('rejects malformed appearance input before any rendering', () => {
    expect(() => resolveButtonAppearance({ did: '' }, catalog, sequence(0))).toThrow(TypeError);
    expect(() => resolveButtonAppearance({ issuer: 'https://example.com' } as never, catalog, sequence(0))).toThrow(/Invalid/);
    expect(() => resolveButtonAppearance([] as never, catalog, sequence(0))).toThrow(TypeError);
  });
});

describe('browser entry separation', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const imports = (source: string) => Array.from(source.matchAll(/^(?:import|export)[^'"\n]*from\s+['"]([^'"]+)['"]/gm), match => match[1]!);

  it('keeps the button entry on browser-safe SDK subpaths only', () => {
    const button = imports(read('../src/button.ts')).concat(imports(read('../src/button-identity.ts')));
    expect(button.length).toBeGreaterThan(0);
    for (const specifier of button) {
      expect(specifier).toMatch(/^(?:@openagentid\/sdk\/(?:character-player|characters)|\.\/button-identity\.js)$/);
    }
  });

  it('does not re-export the UI through the Node provider entry, and keeps the provider graph there', () => {
    const index = read('../src/index.ts');
    expect(index).not.toMatch(/button/);
    expect(imports(index)).toContain('./provider.js');
    const manifest = JSON.parse(read('../package.json'));
    expect(manifest.exports['./button']).toEqual({ types: './dist/button.d.ts', import: './dist/button.js' });
    expect(manifest.exports['./button.css']).toBe('./styles/button.css');
    expect(manifest.exports['.'].require).toBe('./dist/index.cjs');
    expect(manifest.sideEffects).toEqual(['./styles/button.css']);
    expect(manifest.peerDependenciesMeta['@openagentid/sdk']).toEqual({ optional: true });
    expect(manifest.dependencies['@openagentid/sdk']).toBeUndefined();
    expect(read('../styles/button.css')).toMatch(/\.oaid-continue__button:focus-visible/);
  });
});
