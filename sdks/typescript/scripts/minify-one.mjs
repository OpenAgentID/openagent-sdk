/** Optimize the closed One runtime while preserving its public ESM boundary. */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const file = new URL('dist/browser/one.js', root);
const source = await readFile(file, 'utf8');
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
const api = ['shape', 'color', 'theme', 'size', 'label', 'expression', 'state', 'animated', 'reducedMotion', 'cadence', 'group', 'voiceLevel', 'follow', 'viewer',
  'update', 'setAppearance', 'play', 'setReducedMotion', 'getState', 'dispose', 'status', 'blink', 'gaze', 'x', 'y', 'id', 'path', 'eye', 'scale',
  'openScale', 'lookGain', 'liftGain', 'openMax', 'mouthMax', 'mouthDy', 'pivot', 'temperament', 'never', 'disc', 'keyline', 'rim', 'opacity', 'flat', 'light', 'dark',
  'neutral', 'attentive', 'surprised', 'excited', 'happy', 'laughing', 'angry', 'sad', 'scared', 'suspicious', 'confused', 'curious', 'proud', 'shy', 'unimpressed',
  'sleepy', 'thoughtful', 'concerned', 'idle', 'listening', 'reasoning', 'working', 'speaking', 'success', 'blocked', 'error', 'typing', 'attention', 'paused', 'offline'];
await writeFile(input, source.replace(match[0], exports.map(({ local, name }) => `__oneExports[${JSON.stringify(name)}]=${local};`).join('\n')).replace(/\/\/# sourceMappingURL=.*$/gm, ''));
await writeFile(extern, '/** @externs */\nvar __oneExports;\n/** @constructor */ function OnePublic() {}\n' + api.map(name => `OnePublic.prototype.${name};`).join('\n'));
try {
  const wrapper = 'const __oneApi={};(function(__oneExports){%output%})(__oneApi);\n' +
    exports.map(({ name }) => `export const ${name}=__oneApi[${JSON.stringify(name)}];`).join('\n') + '\n//# sourceMappingURL=one.js.map';
  execFileSync(fileURLToPath(new URL('node_modules/.bin/google-closure-compiler', root)), [
    '--compilation_level=ADVANCED', '--language_in=ECMASCRIPT_NEXT', '--language_out=ECMASCRIPT_NEXT', '--rewrite_polyfills=false',
    '--js=' + fileURLToPath(input), '--externs=' + fileURLToPath(extern), '--js_output_file=' + fileURLToPath(output),
    '--create_source_map=' + fileURLToPath(map), '--source_map_include_content',
    '--source_map_input=' + fileURLToPath(input) + '|' + fileURLToPath(new URL('dist/browser/one.js.map', root)),
    '--output_wrapper=' + wrapper,
  ], { stdio: 'inherit' });
  const result = await readFile(output, 'utf8');
  if (!exports.every(({ name }) => result.includes(`export const ${name}=`))) throw new Error('One export boundary lost');
  await writeFile(file, result);
  await writeFile(new URL('dist/browser/one.js.map', root), await readFile(map));
} finally {
  await Promise.all([input, extern, output, map].map(path => rm(path, { force: true })));
}
