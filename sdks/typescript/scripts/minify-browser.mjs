/** Final, semantics-preserving compression of the self-contained browser entries. */
import { readFile, writeFile } from 'node:fs/promises';
import { minify } from 'terser';
import { gzipSync } from 'node:zlib';

// Only closed runtime properties are shortened. The pattern excludes public
// shape/palette/state/options fields and DOM APIs; browser parity checks cover it.
const internal = /^(?:_one[A-Z]\w*|inputAt|reach|scrolling|replaced|waitForInput|stopWaiting|release|cancel|tick|follows|visible|motionAllowed|setState|step|pointer|scheduleCadence|cutCadence|drop|snap|setVisible|show|hide|setRenderedSize|setReduced|setPaint|curves|cur|mv|cut|raw|face|tier|timelineEnd|setBlink|moving|request|following|held|setFace|entrance|cadenceRequest|nextCadence|restartWindow|noteInput|setSize|setKind|setMotion|startTalk|peek|sample|frame|geometry|finished|priority|uncounted|draws|duration|twos|tail|noTempo|scaled|px|kind|reduced|look|lift|open|tilt|smile|mouth|squash|rotate|hop|strokeWidth|discOpacity|start|level|pose|root|motion|win|head)$/;
for (const name of ['one', 'character-player']) {
  const file = new URL(`../dist/browser/${name}.js`, import.meta.url);
  const map = new URL(`${file.href}.map`);
  const input = { [`${name}.js`]: await readFile(file, 'utf8') };
  const content = await readFile(map, 'utf8');
  const profiles = name === 'one'
    ? [{}, { hoist_vars: true, hoist_funs: true }, { inline: false }, { collapse_vars: false, reduce_vars: false }]
    : [{}];
  let result, bytes = Infinity;
  for (const [profile, options] of profiles.entries()) {
    const candidate = await minify(input, {
      module: true,
      ecma: 2022,
      compress: { passes: 3, ...options },
      mangle: name === 'one' ? { properties: { regex: internal, builtins: true } } : true,
      format: { comments: false },
      sourceMap: { content, filename: `${name}.js`, url: `${name}.js.map` },
    });
    if (!candidate.code || !candidate.map) throw new Error(`Browser minification failed: ${name}/${profile}`);
    const size = gzipSync(candidate.code).length;
    console.log(`Browser ${name} compression profile ${profile}: ${size} gzip bytes`);
    if (size < bytes) { result = candidate; bytes = size; }
  }
  if (name === 'one') {
    await import('./minify-one.mjs');
    const code = await readFile(file, 'utf8'), closureMap = await readFile(map, 'utf8');
    const size = gzipSync(code).length;
    console.log(`Browser one closure profile: ${size} gzip bytes`);
    if (size < bytes) { result = { code, map: closureMap }; bytes = size; }
  }
  if (!result.code || !result.map) throw new Error(`Browser minification failed: ${name}`);
  await writeFile(file, result.code);
  await writeFile(map, result.map);
}

