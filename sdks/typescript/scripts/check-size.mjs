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
 *   builds on: at most 24 KB gzipped (the runtime's 16 KB plus 8 KB for the figure family).
 *
 * Sizes are zlib's default gzip level, the figure the plan and the release notes quote.
 */
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const budgets = [
  { file: 'dist/browser/one.js', entry: '@openagentid/sdk/browser/one', limit: 16 * 1024 },
  { file: 'dist/browser/character-player.js', entry: '@openagentid/sdk/browser', limit: 65 * 1024 },
  // The figure family on top of the live One runtime it includes: at most 8 KB gzipped more than the runtime's own
  // 16 KB budget, so pages that show figures pay for them and head-only pages (which load `one`) pay nothing.
  { file: 'dist/browser/one-figure.js', entry: '@openagentid/sdk/browser/one-figure', limit: (16 + 8) * 1024 },
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
if (failed) process.exitCode = 1;
