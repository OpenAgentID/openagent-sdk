import { defineConfig } from 'tsup';

// Build after the Node/neutral entries so their clean step cannot remove this bundle.
export default defineConfig({
  entry: { 'character-player': 'src/character-browser.ts' },
  outDir: 'dist/browser',
  format: ['esm'],
  platform: 'browser',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  splitting: false,
  clean: false,
  treeshake: true,
  noExternal: [/.*/],
});
