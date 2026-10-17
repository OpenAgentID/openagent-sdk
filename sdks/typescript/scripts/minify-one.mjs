/** Optimize the closed One runtime while preserving its public ESM boundary. */
import { minify } from 'terser';
import { ONE_INTERNAL_PROPERTIES, ONE_PUBLIC_PROPERTIES } from './one-properties.mjs';
import { gzipSync } from 'node:zlib';
import { TraceMap, decodedMappings, originalPositionFor } from '@jridgewell/trace-mapping';
import { GenMapping, addSegment, setSourceContent, toEncodedMap } from '@jridgewell/gen-mapping';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const file = new URL('dist/browser/one.js', root);
const source = await readFile(file, 'utf8');
const inputMap = JSON.parse(await readFile(new URL('dist/browser/one.js.map', root), 'utf8'));
console.log('One input source map:', inputMap.sources.join(', '));
const match = /export\s*\{([^}]+)\};?/.exec(source);
if (!match) throw new Error('One bundle must have one named ESM export block');
const exports = match[1].split(',').map(entry => {
  const [local, name = local] = entry.trim().split(/\s+as\s+/);
  if (![local, name].every(value => /^[A-Za-z_$][\w$]*$/.test(value))) throw new Error('Unsupported One export');
  return { local, name };
});
const input = new URL('dist/browser/one.closure-input.js', root);
const extern = new URL('dist/browser/one.closure-externs.js', root);
const output = new URL('dist/browser/one.closure-output.js', root);
const map = new URL('dist/browser/one.closure-output.js.map', root);
const api = ONE_PUBLIC_PROPERTIES;
await writeFile(input, source.replace(match[0], `__oneExports=[${exports.map(({ local }) => local).join(',')}];`).replace(/\/\/# sourceMappingURL=.*$/gm, ''));
await writeFile(extern, '/** @externs */\nvar __oneExports;\n/** @constructor */ function OnePublic() {}\n' + api.map(name => `OnePublic.prototype.${name};`).join('\n'));
try {
  const names = exports.map(({ name }) => name).join(',');
  const wrapper = `const [${names}]=(function(){let __oneExports;%output%;return __oneExports;})();\nexport{${names}};\n//# sourceMappingURL=one.js.map`;
  execFileSync(fileURLToPath(new URL('node_modules/.bin/google-closure-compiler', root)), [
    '--compilation_level=ADVANCED', '--assume_function_wrapper', '--language_in=ECMASCRIPT_NEXT', '--language_out=ECMASCRIPT_NEXT', '--rewrite_polyfills=false',
    '--js=' + fileURLToPath(input), '--externs=' + fileURLToPath(extern), '--js_output_file=' + fileURLToPath(output),
    '--create_source_map=' + fileURLToPath(map), '--source_map_include_content',
    '--output_wrapper=' + wrapper,
  ], { stdio: 'inherit' });
  const result = await readFile(output, 'utf8');
  if (!result.includes(`export{${names}}`)) throw new Error('One export boundary lost');
  // Compose explicitly: Closure's input-map composition drops later bundled sources.
  const closureMap = new TraceMap(JSON.parse(await readFile(map, 'utf8')));
  const originalMap = new TraceMap(inputMap);
  const combined = new GenMapping({ file: 'one.js' });
  const tracedCounts = {};
  for (const [line, segments] of decodedMappings(closureMap).entries()) {
    for (const segment of segments) {
      const original = segment.length < 4 ? null : originalPositionFor(originalMap, { line: segment[2] + 1, column: segment[3] });
      if (original?.source != null && original.line != null && original.column != null) {
        addSegment(combined, line, segment[0], original.source, original.line - 1, original.column, original.name ?? undefined);
        tracedCounts[original.source] = (tracedCounts[original.source] ?? 0) + 1;
      } else addSegment(combined, line, segment[0]);
    }
  }
  inputMap.sources.forEach((name, index) => setSourceContent(combined, name, inputMap.sourcesContent[index]));
  console.log('One composed mappings:', JSON.stringify(tracedCounts));
  const content = toEncodedMap(combined);
  // Evaluate only semantics-preserving compression choices; gzip is the delivery budget.
  const profiles = [{}, { hoist_vars: true, hoist_funs: true }, { inline: false },
    { keep_fargs: false }, { collapse_vars: false, reduce_vars: false },
    { comparisons: false }, { sequences: false },
    { conditionals: false }, { join_vars: false }, { reduce_funcs: false },
    { passes: 5, hoist_vars: true, keep_fargs: false }];
  let compact, bytes = Infinity;
  for (const [index, options] of profiles.entries()) {
    const candidate = await minify({ 'one.js': result }, {
      module: true, ecma: 2022, compress: { passes: 3, ...options }, mangle: { properties: { regex: ONE_INTERNAL_PROPERTIES, reserved: api, builtins: true } },
      sourceMap: { content, filename: 'one.js', url: 'one.js.map' },
    });
    if (!candidate.code || !candidate.map) throw new Error('One final compression failed');
    const size = gzipSync(candidate.code).length;
    console.log(`One closure compression profile ${index}: ${size} gzip bytes`);
    if (size < bytes) { compact = candidate; bytes = size; }
  }
  if (!compact) throw new Error('No One compression candidate');
  const outputMap = new TraceMap(JSON.parse(compact.map));
  const used = new Set(decodedMappings(outputMap).flatMap(line => line.filter(segment => segment.length > 1).map(segment => segment[1])));
  const mapped = outputMap.sources.filter((_, index) => used.has(index));
  for (const sourceName of ['character-one.ts', 'character-one-motion.ts', 'character-one-player.ts', 'character-state.ts', 'one.ts']) {
    if (!mapped.some(name => name.endsWith('/' + sourceName))) throw new Error('Missing One source mapping: ' + sourceName);
  }
  console.log('One output source map:', mapped.join(', '));
  const namespace = await import('data:text/javascript;base64,' + Buffer.from(compact.code).toString('base64'));
  const actualExports = Object.keys(namespace).sort().join(',');
  const expectedExports = exports.map(({ name }) => name).sort().join(',');
  if (actualExports !== expectedExports) throw new Error('One ESM exports changed');
  console.log('One verified ESM exports:', actualExports);
  await writeFile(file, compact.code);
  await writeFile(new URL('dist/browser/one.js.map', root), compact.map);
} finally {
  await Promise.all([input, extern, output, map].map(path => rm(path, { force: true })));
}
