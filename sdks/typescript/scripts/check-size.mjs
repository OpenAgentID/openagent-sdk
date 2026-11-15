/**
 * Browser bundle budgets, checked after `npm run build` (CI runs `npm run size`).
 *
 * - dist/browser/one.js, the live One runtime (`@openagentid/sdk/browser/one`): at most 16 KB gzipped,
 *   the One app's script budget for animated heads (AVATARS.md §4.2, check V11).
 * - dist/browser/character-player.js, every family (`@openagentid/sdk/browser`): at most 65 KB gzipped, so the
 *   One family does not grow the bundle that hosts of the other families load (0.7.3 shipped 63.1 KB unminified;
 *   the bundle is minified from 0.8.0, 53.6 KB with the shape library).
 *
 * - dist/browser/one-figure.js, the figure family (`@openagentid/sdk/browser/one-figure`) with the One runtime it
 *   builds on: at most 40 KB gzipped; the family's own code, without the modules it shares with the runtime, at most
 *   12 KB gzipped.
 *
 * Sizes are zlib's default gzip level, the figure the plan and the release notes quote.
 */
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const budgets = [
  { file: 'dist/browser/one.js', entry: '@openagentid/sdk/browser/one', limit: 16 * 1024 },
  { file: 'dist/browser/character-player.js', entry: '@openagentid/sdk/browser', limit: 65 * 1024 },
  // The self-contained figure bundle: the figure family plus the live One runtime and catalog it builds on, unmangled.
  // Only pages that show figures load it; head-only pages keep loading `one` alone.
  { file: 'dist/browser/one-figure.js', entry: '@openagentid/sdk/browser/one-figure', limit: 40 * 1024 },
];
const root = new URL('../', import.meta.url);
let failed = false;
for (const budget of budgets) {
  const bytes = await readFile(new URL(budget.file, root));
  const gzipped = gzipSync(bytes).length;
  const ok = gzipped <= budget.limit;
  failed ||= !ok;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${budget.entry}: ${(gzipped / 1024).toFixed(1)} KB gzipped (${(bytes.length / 1024).toFixed(1)} KB raw), budget ${budget.limit / 1024} KB`);
}

// The figure family's own code (src/one-figure*.ts, minified, with every module it shares with the head runtime left
// out): at most 12 KB gzipped. AV-C1 set 8 KB for limbs and accessories; round 2 added ten heads, five headwear
// generators fitted per head, eye poses and the colour-science picker to the same entry (12.0 KB measured with the
// round 2 fit fixes). Any growth past 12 KB splits the entry (head extras vs limbs and motion); it is never raised. The head
// runtime that head-only pages load is unchanged and keeps its own 16 KB budget.
const { build } = await import('esbuild');
const own = await build({
  entryPoints: [new URL('src/one-figure.ts', root).pathname], bundle: true, write: false, minify: true, format: 'esm',
  platform: 'browser', target: 'es2022', define: { __OAID_ONE_COMPACT_ERRORS__: 'false' },
  plugins: [{ name: 'shared-runtime', setup(b) {
    b.onResolve({ filter: /^\.\// }, args => args.path.startsWith('./one-figure') ? undefined : { path: args.path, external: true });
  } }],
});
const ownBytes = own.outputFiles[0].contents;
const ownGzipped = gzipSync(ownBytes).length, ownLimit = 12 * 1024;
failed ||= ownGzipped > ownLimit;
console.log(`${ownGzipped <= ownLimit ? 'ok  ' : 'FAIL'} @openagentid/sdk/one-figure own code: ${(ownGzipped / 1024).toFixed(1)} KB gzipped (${(ownBytes.length / 1024).toFixed(1)} KB raw), budget ${ownLimit / 1024} KB`);
if (failed) process.exitCode = 1;
