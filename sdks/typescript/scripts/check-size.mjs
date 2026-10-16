/**
 * Browser bundle budgets, checked after `npm run build` (CI runs `npm run size`).
 *
 * - dist/browser/one.js, the live One runtime (`@openagentid/sdk/browser/one`): at most 16 KB gzipped, the One
 *   app's script budget for animated heads (AVATARS.md §4.2, check V11).
 * - dist/browser/character-player.js, every family (`@openagentid/sdk/browser`): at most 65 KB gzipped, so the
 *   One family does not grow the bundle that hosts of the other families load (0.7.3 shipped 63.1 KB).
 *
 * Sizes are zlib's default gzip level, the figure the plan and the release notes quote.
 */
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const budgets = [
  { file: 'dist/browser/one.js', entry: '@openagentid/sdk/browser/one', limit: 16 * 1024 },
  { file: 'dist/browser/character-player.js', entry: '@openagentid/sdk/browser', limit: 65 * 1024 },
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
