import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/server.ts',
    'src/client.ts',
    'src/errors.ts',
    'src/skills.ts',
    'src/types.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  target: 'es2022',
  platform: 'neutral',
  external: ['@modelcontextprotocol/sdk', '@openagent/sdk'],
  esbuildOptions(options) {
    options.conditions = ['import', 'module', 'default'];
  },
});
