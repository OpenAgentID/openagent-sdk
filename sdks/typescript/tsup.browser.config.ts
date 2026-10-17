import { defineConfig } from 'tsup';

// Build after the Node/neutral entries so their clean step cannot remove these bundles.
const browser = {
  define: { __OAID_ONE_COMPACT_ERRORS__: 'false' },
  outDir: 'dist/browser',
  format: ['esm'] as const,
  platform: 'browser' as const,
  target: 'es2022',
  dts: true,
  sourcemap: true,
  splitting: false,
  clean: false,
  treeshake: true,
  noExternal: [/.*/],
};

export default defineConfig([
  // Every family, for hosts that switch families: mountCharacter and the catalog. Minified like the One runtime, with
  // a source map, so the One family's shape library does not grow what hosts of the other families download.
  { ...browser, entry: { 'character-player': 'src/character-browser.ts' }, minify: true },
  // The live One runtime alone, minified for the One app's script budget (scripts/check-size.mjs).
  { ...browser, entry: { one: 'src/one-browser.ts' }, define: { __OAID_ONE_COMPACT_ERRORS__: 'true' }, minify: true },
]);
