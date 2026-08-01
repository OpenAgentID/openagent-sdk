#!/usr/bin/env node
// Build the @openagentid/crypto-wasm WASM package.
//
// Two targets, one package:
//
// - `bundler` (pkg/): for browsers, bundlers, Deno, Bun, Workers - the wasm
//   module is wired through bundler-native import syntax.
// - `nodejs` (pkg/node/): for Node - the bundler target's static `.wasm`
//   import is not loadable by Node's ESM loader, so Node gets its own build
//   with CommonJS glue that reads the bytes from disk.
//
// Consumers resolve the right one through the package's conditional exports
// (`node` condition first). The fixups run on every build, so the published
// artifact is always the scoped name with both targets present.
//
// Usage: node scripts/build-wasm.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const crate = join(dirname(fileURLToPath(import.meta.url)), '..');
const features = ['--no-default-features', '--features', 'wasm'];

execFileSync(
  'wasm-pack',
  ['build', '--target', 'bundler', '--release', '--out-dir', 'pkg', '--', ...features],
  { cwd: crate, stdio: 'inherit' },
);

execFileSync(
  'wasm-pack',
  ['build', '--target', 'nodejs', '--release', '--out-dir', 'pkg/node', '--', ...features],
  { cwd: crate, stdio: 'inherit' },
);

// wasm-pack writes a .gitignore into out dirs; npm honors it and would
// exclude the whole nodejs target from the published tarball. Remove any
// of them before packaging.
for (const rel of ['pkg/.gitignore', 'pkg/node/.gitignore']) {
  try {
    rmSync(join(crate, rel));
  } catch {
    // already absent
  }
}

// The nodejs target emits CommonJS; declare it so the .js files inside are
// not parsed as ESM (the root package is "type": "module").
writeFileSync(
  join(crate, 'pkg', 'node', 'package.json'),
  JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
);

const pkgPath = join(crate, 'pkg', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

pkg.name = '@openagentid/crypto-wasm';
pkg.author = 'L1fe Labs, Inc. <eng@l1fe.ai>';
pkg.publishConfig = { access: 'public' };
pkg.sideEffects = false;
pkg.exports = {
  '.': {
    types: './openagent_crypto_wasm.d.ts',
    node: './node/openagent_crypto_wasm.js',
    default: './openagent_crypto_wasm.js',
  },
  './package.json': './package.json',
};
pkg.files = [
  'openagent_crypto_wasm_bg.wasm',
  'openagent_crypto_wasm.js',
  'openagent_crypto_wasm_bg.js',
  'openagent_crypto_wasm.d.ts',
  'node',
];

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`packaged ${pkg.name}@${pkg.version} (bundler + nodejs targets)`);
