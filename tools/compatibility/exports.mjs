// Run from a clean consumer directory, using installed npm archives only.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(pathToFileURL(resolve('package.json')));
const dependencies = JSON.parse(await readFile('package.json', 'utf8')).dependencies;
const results = [];
for (const name of Object.keys(dependencies)) {
  if (!name.startsWith('@openagentid/')) continue;
  const manifest = JSON.parse(await readFile(resolve('node_modules', name, 'package.json'), 'utf8'));
  const entries = manifest.exports && Object.keys(manifest.exports).some(key => key.startsWith('.'))
    ? Object.entries(manifest.exports) : [['.', manifest.exports ?? manifest.main]];
  for (const [entry, target] of entries) {
    if (entry.endsWith('.json') || entry.includes('*') || target === null) continue;
    const specifier = entry === '.' ? name : name + entry.slice(1);
    // The runner copies this file into the consumer directory, so ESM uses
    // the actual import condition and CJS independently uses require below.
    const esm = await import(specifier);
    assert.ok(esm && typeof esm === 'object', `${specifier} ESM namespace`);
    results.push({ specifier, format: 'esm', exports: Object.keys(esm).length });
    if (target && typeof target === 'object' && Object.hasOwn(target, 'require')) {
      const cjs = require(specifier);
      assert.ok(cjs && typeof cjs === 'object', `${specifier} CommonJS namespace`);
      results.push({ specifier, format: 'cjs', exports: Object.keys(cjs).length });
    }
  }
}
const sdk = require('@openagentid/sdk');
const sdkManifest = JSON.parse(await readFile('node_modules/@openagentid/sdk/package.json', 'utf8'));
assert.equal(sdk.VERSION, sdkManifest.version, 'SDK VERSION must equal its installed package version');
await writeFile('exports-result.json', JSON.stringify({ passed: true, entries: results.length, results }, null, 2));
console.log(`PASS: ${results.length} installed API entry points; SDK VERSION ${sdk.VERSION}`);
