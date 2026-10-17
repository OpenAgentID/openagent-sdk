/** Final, semantics-preserving compression of the self-contained browser entries. */
import { readFile, writeFile } from 'node:fs/promises';
import { minify } from 'terser';

// Closed-over implementation properties only. Public player methods, shape/palette
// descriptors, state snapshots and DOM properties are deliberately absent.
const oneInternals = /^(?:inputAt|reach|scrolling|replaced|waitForInput|stopWaiting|release|cancel|tick|follows|visible|motionAllowed|setState|step|pointer|scheduleCadence|cutCadence|drop|snap|setVisible|show|hide|setRenderedSize|setReduced|setPaint|curves|cur|mv|cut|raw|face|tier|timelineEnd|setBlink|moving|request|following|held|setFace|entrance|cadenceRequest|nextCadence|restartWindow|noteInput|setSize|setKind|setMotion|startTalk|peek|sample|frame|geometry|finished|priority|uncounted|draws|duration|twos|tail|noTempo|scaled|px|kind|reduced|look|lift|open|tilt|smile|mouth|squash|rotate|hop|strokeWidth|discOpacity|start|level)$/;

for (const name of ['one', 'character-player']) {
  const file = new URL(`../dist/browser/${name}.js`, import.meta.url);
  const map = new URL(`${file.href}.map`);
  const result = await minify({ [`${name}.js`]: await readFile(file, 'utf8') }, {
    module: true,
    ecma: 2022,
    compress: { passes: 3 },
    mangle: name === 'one' ? { properties: { regex: oneInternals } } : true,
    format: { comments: false },
    sourceMap: { content: await readFile(map, 'utf8'), filename: `${name}.js`, url: `${name}.js.map` },
  });
  if (!result.code || !result.map) throw new Error(`Browser minification failed: ${name}`);
  await writeFile(file, result.code);
  await writeFile(map, result.map);
}
