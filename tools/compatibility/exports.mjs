// Run from a clean consumer directory, using installed npm archives only.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(pathToFileURL(resolve('package.json')));
const dependencies = JSON.parse(await readFile('package.json', 'utf8')).dependencies;
const results = [], failures = [];
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
    try {
      const esm = await import(specifier);
      assert.ok(esm && typeof esm === 'object', `${specifier} ESM namespace`);
      results.push({ specifier, format: 'esm', exports: Object.keys(esm).length });
    } catch (error) { failures.push({ specifier, format: 'esm', error: String(error.stack ?? error) }); }
    if (target && typeof target === 'object' && Object.hasOwn(target, 'require')) {
      try {
        const cjs = require(specifier);
        assert.ok(cjs && typeof cjs === 'object', `${specifier} CommonJS namespace`);
        results.push({ specifier, format: 'cjs', exports: Object.keys(cjs).length });
      } catch (error) { failures.push({ specifier, format: 'cjs', error: String(error.stack ?? error) }); }
    }
  }
}
// Native named imports must work too: namespace loading alone can hide a
// broken CommonJS-to-ESM bridge. Use the maintained SDK signer, not a stub.
await writeFile('eas-native.mjs', `export { EasAnchorPublisher, EasAnchorResolver, SCHEMA_STRING, didRecipient, encodeAnchorData } from '@openagentid/anchor-eas';\n`);
const { EasAnchorPublisher, EasAnchorResolver, SCHEMA_STRING, didRecipient, encodeAnchorData } =
  await import(pathToFileURL(resolve('eas-native.mjs')).href);
const easCjs = require('@openagentid/anchor-eas');
const { Wallet } = require('ethers');
const signer = Wallet.createRandom();
const did = 'did:oas:hmr:packed-eas-consumer';
const schemaUid = '0x' + '01'.repeat(32);
const data = { did, kind: 'hmr', status: 'active', metadataCommitment: 'packed-consumer', anchoredAtBlock: 1n };
assert.equal(SCHEMA_STRING, easCjs.SCHEMA_STRING);
assert.equal(typeof EasAnchorPublisher, 'function');
assert.equal(typeof EasAnchorResolver, 'function');
assert.deepEqual(encodeAnchorData(data), easCjs.encodeAnchorData(data));
assert.equal(didRecipient(did), easCjs.didRecipient(did));
assert.ok(new EasAnchorPublisher({ schemaUid, easContractAddress: signer.address, signer }));
assert.ok(new EasAnchorResolver({ schemaUid, trustedAttesters: [signer.address],
  graphqlUrl: 'http://127.0.0.1/graphql', rpcUrl: 'http://127.0.0.1/rpc' }));
const sdk = require('@openagentid/sdk');
const sdkManifest = JSON.parse(await readFile('node_modules/@openagentid/sdk/package.json', 'utf8'));
assert.equal(sdk.VERSION, sdkManifest.version, 'SDK VERSION must equal its installed package version');
await writeFile('exports-result.json', JSON.stringify({ passed: failures.length === 0, entries: results.length, results, failures }, null, 2));
assert.deepEqual(failures, [], 'Every documented package entry point must load natively');
console.log(`PASS: ${results.length} installed API entry points; SDK VERSION ${sdk.VERSION}`);
