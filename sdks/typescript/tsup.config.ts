import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/agent.ts',
    'src/identity.ts',
    'src/credentials.ts',
    'src/verification.ts',
    'src/skills.ts',
    'src/errors.ts',
    'src/config.ts',
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
  external: [
    '@openagent/aegis-sdk',
    '@openagent/arsenal-sdk',
    '@openagent/oas-sdk',
    '@openagent/crypto-wasm',
    'node:crypto',
    'node:buffer',
  ],
  esbuildOptions(options) {
    options.conditions = ['import', 'module', 'default'];
  },
});
