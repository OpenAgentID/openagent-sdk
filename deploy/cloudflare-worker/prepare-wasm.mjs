import { createRequire } from 'node:module';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Workers imports a compiled WebAssembly.Module. Instantiate it explicitly,
// keeping generated glue byte-identical to the installed npm artifact.
const require = createRequire(import.meta.url);
const source = dirname(require.resolve('@openagentid/crypto-wasm/package.json'));
const output = fileURLToPath(new URL('.generated/', import.meta.url));
const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
if (!/^0\.1\.[12]$/.test(manifest.version)) throw new Error('Requalify the Workers WASM loader for this crypto-wasm version.');
await mkdir(output, { recursive: true });
await copyFile(join(source, 'openagent_crypto_wasm_bg.js'), join(output, 'crypto.js'));
await copyFile(join(source, 'openagent_crypto_wasm_bg.wasm'), join(output, 'crypto.wasm'));
await writeFile(join(output, 'wasm.js'), `import compiled from './crypto.wasm';
import * as bindings from './crypto.js';
const instance = new WebAssembly.Instance(compiled, { './openagent_crypto_wasm_bg.js': bindings });
bindings.__wbg_set_wasm(instance.exports);
instance.exports.__wbindgen_start();
export { act_verify } from './crypto.js';
`);
await writeFile(join(output, 'wasm.d.ts'), `export { act_verify } from '@openagentid/crypto-wasm';\n`);
