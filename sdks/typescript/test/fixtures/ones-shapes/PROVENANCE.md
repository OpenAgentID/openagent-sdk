# The Ones' shape library and agent palette

`shapes.json` and `palette.json` in this directory are byte-identical copies of the Ones' shape
library (`life/ones-shapes/v2`) and agent palette (`life/ones-agent-palette/v1`) from the plan of
record for the One family's shapes, 16 October 2026 (L1fe Labs, Inc.; Apache-2.0 OR MIT in this
repository, like agent-eye).

| File | sha256 | Bytes |
| --- | --- | --- |
| `shapes.json` | `894f801c251f54c113adc2c4b7be9dc3bd5574f536897653330456475a8c1767` | 40863 |
| `palette.json` | `76fa20166a4d4ed22021b49e418dd4d8cf8a8c2c30c1b0daa7f4e49eae76c991` | 21489 |

The SDK does not ship these files. `scripts/one-shapes.mjs` generates `src/character-one-shapes.ts`
from them: the fourteen shapes (path, eye placement and limits, mouth offset, pivot, temperament,
default colour and never list) in library order, Digital One's circle, and the eighteen colours
(disc, eye and keyline) in team order. `test/character-one.test.ts` checks the sha256 values above and
compares the generated module with these files. Regenerate the module whenever the library changes;
never edit it by hand.
