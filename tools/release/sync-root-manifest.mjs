#!/usr/bin/env node
// The root package.json is the manifest npm reads for `npm install github:OpenAgentID/openagent-sdk`.
// Its version, entry points and dependencies are generated from sdks/typescript/package.json so a Git
// install exposes exactly what the npm package exposes.
//
//   node tools/release/sync-root-manifest.mjs           rewrite package.json
//   node tools/release/sync-root-manifest.mjs --check   exit 1 when package.json has drifted (CI)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './lib.mjs';

const prefix = 'sdks/typescript/';
const generated = ['version', 'type', 'main', 'module', 'types', 'exports', 'files', 'sideEffects', 'engines',
  'dependencies', 'bin', 'peerDependencies', 'peerDependenciesMeta', 'keywords'];

function relocate(value, key) {
  if (typeof value === 'string') {
    if (value.startsWith('./')) return `./${prefix}${value.slice(2)}`;
    return key === 'files' ? `${prefix}${value}` : value;
  }
  if (Array.isArray(value)) return value.map(item => relocate(item, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, relocate(item, key)]));
  }
  return value;
}

export function expectedRootManifest() {
  const current = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const sdk = JSON.parse(readFileSync(join(root, prefix, 'package.json'), 'utf8'));
  const next = { ...current };
  for (const key of generated) {
    if (key in sdk) next[key] = ['main', 'module', 'types', 'exports', 'files', 'bin'].includes(key) ? relocate(sdk[key], key) : sdk[key];
    else delete next[key];
  }
  return next;
}

export function rootManifestDrift() {
  const current = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const expected = expectedRootManifest();
  return generated.filter(key => JSON.stringify(current[key]) !== JSON.stringify(expected[key]));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const drift = rootManifestDrift();
  if (process.argv.includes('--check')) {
    if (drift.length > 0) {
      console.error(`package.json differs from sdks/typescript/package.json in: ${drift.join(', ')}.`);
      console.error('Run node tools/release/sync-root-manifest.mjs and commit the result.');
      process.exit(1);
    }
    console.log('ok: root package.json matches sdks/typescript/package.json');
  } else {
    writeFileSync(join(root, 'package.json'), JSON.stringify(expectedRootManifest(), null, 2) + '\n');
    console.log(drift.length > 0 ? `updated package.json: ${drift.join(', ')}` : 'package.json already up to date');
  }
}
