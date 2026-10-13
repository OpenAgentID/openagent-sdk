import { defineConfig } from 'tsup';

// Browser-only entry. Built after the Node/provider bundle so that bundle's
// clean step cannot remove it. The SDK stays external: hosts install it once.
export default defineConfig({
  entry: { button: 'src/button.ts' },
  format: ['esm'],
  platform: 'browser',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: false,
  splitting: false,
  treeshake: true,
  external: [/^@openagentid\/sdk(?:\/|$)/],
});
