#!/usr/bin/env node
// Write the GitHub release notes for a published plan, and report whether the tag is the newest release.
//
//   node tools/release/notes.mjs plan.json notes.md [--manual]
//
// --manual is for a maintainer's break-glass publish (docs/RELEASING.md): the notes say so, and that those
// versions carry no provenance attestation.
//
// The notes are the SDK's CHANGELOG section for the tagged version, then the full package set at the tag:
// what this tag published (with npm's integrity hash, which the attached tarballs match) and what was
// already on npm unchanged. GITHUB_OUTPUT receives latest=true|false.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { changelogSection, compareVersions, git, packument } from './lib.mjs';

const manual = process.argv.includes('--manual');
const [planPath, notesPath] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
if (!planPath || !notesPath) {
  console.error('Usage: notes.mjs plan.json notes.md');
  process.exit(2);
}
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const [sdk] = plan.packages;
const section = changelogSection('sdks/typescript/CHANGELOG.md', plan.version);
if (!section) throw new Error(`sdks/typescript/CHANGELOG.md has no section for ${plan.version}.`);

const rows = [];
const integrity = [];
let publishedAt = null;
for (const item of plan.packages) {
  const document = await packument(item.name);
  const entry = document?.versions?.[item.version];
  if (!entry) throw new Error(`${item.name}@${item.version} is not on npm; publish before writing notes.`);
  const link = `[\`${item.name}\`](https://www.npmjs.com/package/${item.name}/v/${item.version})`;
  const fresh = item.status === 'publish' || item.status === 'published';
  rows.push(`| ${link} | ${item.version} | ${fresh ? 'published with this tag' : `unchanged since ${plan.previousTag ?? 'its last release'}`} |`);
  if (fresh) integrity.push(`- \`${item.name}@${item.version}\`: \`${entry.dist.integrity}\``);
  if (item === sdk) publishedAt = document.time?.[item.version] ?? null;
}

const when = publishedAt ? `${publishedAt.slice(0, 10)} ${publishedAt.slice(11, 16)} UTC` : 'npm';
const source = `Published to npm on ${when} from \`${plan.sha.slice(0, 7)}\``;
const notes = [
  manual
    ? `${source} by a maintainer, because the release workflow could not run; these versions have no provenance attestation.`
    : `${source} by the [release workflow](https://github.com/OpenAgentID/openagent-sdk/blob/${plan.sha}/.github/workflows/release.yml), with npm provenance.`,
  '',
  section.body,
  '',
  '### Packages in this release',
  '',
  '| Package | Version | |',
  '|---|---|---|',
  ...rows,
  '',
  '```sh',
  `npm install @openagentid/sdk@${plan.version}`,
  '```',
  '',
  'The tarballs attached to this release are the files npm serves. Their npm integrity:',
  '',
  ...integrity,
  '',
  ...(manual ? [] : [`Each package page on npm shows the provenance attestation that links it to this tag's workflow run.`, '']),
].join('\n');
writeFileSync(notesPath, notes);

const releases = git('tag', '--list', 'v[0-9]*').split('\n').filter(Boolean)
  .map(tag => tag.slice(1)).filter(version => /^\d+\.\d+\.\d+$/.test(version));
const latest = !plan.prerelease && releases.every(version => compareVersions(plan.version, version) >= 0);
console.log(notes);
console.log(`latest=${latest}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `latest=${latest}\n`);
