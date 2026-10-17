#!/usr/bin/env node
// Check the root CHANGELOG.md and every release-set package's CHANGELOG.md:
//
// - one optional `## [Unreleased]` section, and only as the first section;
// - every other section is `## [x.y.z] - YYYY-MM-DD`, newest first, dates never increasing;
// - a package's package.json version has its own section, or is the pending version above the newest
//   section while `## [Unreleased]` holds its changes;
// - with --registry, each section's date is the UTC day npm published that version (the root file is
//   checked against @openagentid/sdk).
//
//   node tools/release/check-changelogs.mjs [--registry]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareVersions, packument, releaseSet, root } from './lib.mjs';

const registry = process.argv.includes('--registry');
const errors = [];
const files = [{ path: 'CHANGELOG.md', name: '@openagentid/sdk', version: null },
  ...releaseSet().map(({ directory, name, version }) => ({ path: join(directory, 'CHANGELOG.md'), name, version }))];

for (const file of files) {
  const text = readFileSync(join(root, file.path), 'utf8');
  const headings = [...text.matchAll(/^## (.*)$/gm)].map(match => match[1]);
  const sections = [];
  headings.forEach((heading, index) => {
    if (heading === '[Unreleased]') {
      if (index !== 0) errors.push(`${file.path}: "## [Unreleased]" must be the first section.`);
      return;
    }
    const match = /^\[(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\] - (\d{4}-\d{2}-\d{2})$/.exec(heading);
    if (!match) {
      errors.push(`${file.path}: "## ${heading}" is not "## [x.y.z] - YYYY-MM-DD" or "## [Unreleased]".`);
      return;
    }
    sections.push({ version: match[1], date: match[2] });
  });
  for (let i = 1; i < sections.length; i += 1) {
    const [newer, older] = [sections[i - 1], sections[i]];
    if (compareVersions(newer.version, older.version) <= 0) errors.push(`${file.path}: ${newer.version} is listed above ${older.version}.`);
    if (newer.date < older.date) errors.push(`${file.path}: ${newer.version} (${newer.date}) is dated before ${older.version} (${older.date}).`);
  }
  if (file.version) {
    const listed = sections.some(section => section.version === file.version);
    const pending = headings[0] === '[Unreleased]' && (!sections[0] || compareVersions(file.version, sections[0].version) > 0);
    if (!listed && !pending) {
      errors.push(`${file.path}: package.json is ${file.version}, which has no section and is not above ${sections[0]?.version} with an [Unreleased] section.`);
    }
  }
  if (registry) {
    const times = (await packument(file.name))?.time ?? {};
    for (const section of sections) {
      const published = times[section.version]?.slice(0, 10);
      if (!published) errors.push(`${file.path}: ${section.version} is not on npm (${file.name}).`);
      else if (published !== section.date) errors.push(`${file.path}: ${section.version} is dated ${section.date}; npm published it on ${published} (UTC).`);
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`::error::${error}`);
  process.exit(1);
}
console.log(`ok: ${files.length} changelogs${registry ? ', dates match npm' : ''}`);
