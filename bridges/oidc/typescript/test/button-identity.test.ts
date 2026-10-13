import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateCharacter } from '@openagentid/sdk/characters';
import { decorativeAgentDid, isDecorativeAgentDid, resolveButtonAppearance } from '../src/button-identity.js';

const sequence = (...values: number[]) => {
  let index = 0;
  return (length: number) => Uint8Array.from({ length }, () => values[index++ % values.length]!);
};

describe('decorative Continue as Agent seed', () => {
  it('generates an agent DID the real SDK player accepts and that is recognizably decorative', () => {
    const did = decorativeAgentDid(sequence(1, 2, 3, 4, 5, 6, 7, 255));
    expect(did).toBe('did:oas:openagent:agent:decorative-01020304050607ff');
    expect(isDecorativeAgentDid(did)).toBe(true);
    expect(isDecorativeAgentDid('did:oas:openagent:agent:real-agent')).toBe(false);
    const character = generateCharacter(did, { skin: 'autos', shape: 'standard', finish: 'flat', eyePlacement: 'face', accessories: [], size: 32 });
    expect(character.did).toBe(did);
    expect(character.svg).toMatch(/data-character-body="true"/);
    expect(character.svg).not.toMatch(/data-character-accessory/);
    expect(() => decorativeAgentDid(() => new Uint8Array(3))).toThrow(TypeError);
  });

  it('resolves a random decorative seed once and keeps a host-supplied DID literally', () => {
    expect(resolveButtonAppearance(undefined, sequence(9))).toEqual({ did: 'did:oas:openagent:agent:decorative-0909090909090909', decorative: true });
    expect(resolveButtonAppearance({}, sequence(4))).toEqual({ did: 'did:oas:openagent:agent:decorative-0404040404040404', decorative: true });
    expect(resolveButtonAppearance({ did: 'did:oas:openagent:agent:selected' }, () => { throw new Error('no randomness needed'); }))
      .toEqual({ did: 'did:oas:openagent:agent:selected', decorative: false });
  });

  it('rejects malformed appearance input before any rendering', () => {
    expect(() => resolveButtonAppearance({ did: '' }, sequence(0))).toThrow(TypeError);
    expect(() => resolveButtonAppearance({ skin: 'autos' } as never, sequence(0))).toThrow(/Invalid/);
    expect(() => resolveButtonAppearance({ issuer: 'https://example.com' } as never, sequence(0))).toThrow(/Invalid/);
    expect(() => resolveButtonAppearance([] as never, sequence(0))).toThrow(TypeError);
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
    // The eyes-only window relies on the stylesheet hiding the SDK body, never on a modified generator.
    expect(read('../styles/button.css')).toMatch(/\.oaid-continue__eyes \[data-character-body\] \{\s*display: none;/);
    expect(read('../src/button.ts')).toMatch(/skin: 'autos', shape: 'standard', finish: 'flat', eyePlacement: 'face', accessories: \[\]/);
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
