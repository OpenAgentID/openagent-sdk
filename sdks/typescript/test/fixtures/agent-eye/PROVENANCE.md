# agent-eye.js provenance

`agent-eye.js` in this directory is a byte-identical copy of the agent-eye master: One's animated
mark, a disc with one bar for an eye. agent-eye is written by JR and is copyright L1fe Labs, Inc.,
which contributes it to the OpenAgent SDK under the repository's Apache-2.0 OR MIT licence. The
master file carries no licence header of its own; this record and the repository licence files
(`LICENSE-APACHE`, `LICENSE-MIT`, copyright L1fe Labs, Inc.) state its terms here.

| Field | Value |
| --- | --- |
| sha256 | `83cc379a706b86899c56b41813030a721110071dbcd11274ebdc146a40b8bba4` |
| Bytes | 43948 |
| Author | JR |
| Copyright holder | L1fe Labs, Inc. |
| Licence in this repository | Apache-2.0 OR MIT |
| Contributed | 15 October 2026, for the One family of `@openagentid/sdk` 0.8.0 |

The SDK does not ship this file. `src/agent-eye.ts` ports its pure geometry and motion exports to
TypeScript, without the `<agent-eye>` custom element, so that importing the SDK never touches a DOM.
`test/character-one.test.ts` checks the sha256 above and compares the port with this master across a
grid of poses, eases and curves. Update the master here and the port together, never one alone.
