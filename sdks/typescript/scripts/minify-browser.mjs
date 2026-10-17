/** Final, semantics-preserving compression of the self-contained browser entries. */
import { readFile, writeFile } from 'node:fs/promises';
import { minify } from 'terser';

for (const name of ['one', 'character-player']) {
  const file = new URL(`../dist/browser/${name}.js`, import.meta.url);
  const map = new URL(`${file.href}.map`);
  const result = await minify({ [`${name}.js`]: await readFile(file, 'utf8') }, {
    module: true,
    ecma: 2022,
    compress: { passes: 3 },
    mangle: true,
    format: { comments: false },
    sourceMap: { content: await readFile(map, 'utf8'), filename: `${name}.js`, url: `${name}.js.map` },
  });
  if (!result.code || !result.map) throw new Error(`Browser minification failed: ${name}`);
  await writeFile(file, result.code);
  await writeFile(map, result.map);
}
