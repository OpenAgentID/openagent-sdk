import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/client.ts',
    'src/middleware.ts',
    'src/server.ts',
    'src/discovery.ts',
    'src/transport.ts',
    'src/headers.ts',
    'src/session.ts',
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
    '@openagent/auth-protocol',
    'node:crypto',
    'node:buffer',
  ],
});
