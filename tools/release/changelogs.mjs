// Check the root CHANGELOG.md and every release-set package's CHANGELOG.md:
//
// - one optional `## [Unreleased]` section, and only as the first section;
// - every other section is `## [x.y.z] - YYYY-MM-DD`, newest first, dates never increasing;
// - a package's package.json version has its own section, or is the pending version above the newest
//   section while `## [Unreleased]` holds its changes;
// - with --registry, each section's date is the UTC day npm published that version (the root file is
//   checked against @openagentid/sdk). The one exception is the pending release: the release commit dates
//   the new version's section before the tag publishes it, so the newest section may be missing from npm
//   when it names the current package version (the SDK version for the root file) and, unless it is a
//   prerelease, is above npm's latest. Every older section must be on npm.
//
//   Used by check-changelogs.mjs and tested by check-changelogs.test.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareVersions, parseVersion, readJson, releaseSet, root } from './lib.mjs';

/**
 * The errors in a set of changelogs.
 *
 * files: [{ path, text, name, version, pending }]: `version` is the package.json version the file must
 * list (null for the root file); `pending` is the version that may be dated but not yet on npm.
 * lookup: the registry document for a package name, or null; omit it to skip the npm checks.
 */
export async function checkChangelogs(files, lookup) {
  const errors = [];
  for (const file of files) {
    const headings = [...file.text.matchAll(/^## (.*)$/gm)].map(match => match[1]);
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
    if (lookup) {
      const document = await lookup(file.name);
      const times = document?.time ?? {};
      const latest = document?.['dist-tags']?.latest;
      sections.forEach((section, index) => {
        const published = times[section.version]?.slice(0, 10);
        if (published) {
          if (published !== section.date) errors.push(`${file.path}: ${section.version} is dated ${section.date}; npm published it on ${published} (UTC).`);
        } else if (index !== 0 || section.version !== file.pending) {
          errors.push(`${file.path}: ${section.version} is not on npm (${file.name}), and only the pending ${file.pending} may be.`);
        } else if (latest && parseVersion(section.version).prerelease === null && compareVersions(section.version, latest) <= 0) {
          // The same rule as plan.mjs: a release never moves npm's latest backwards.
          errors.push(`${file.path}: the pending ${section.version} is not above npm latest ${latest} (${file.name}).`);
        }
      });
    }
  }
  return errors;
}

/** The root changelog and every release-set package's changelog, as checkChangelogs reads them. */
export function repositoryChangelogs() {
  const sdk = readJson('sdks/typescript/package.json').version;
  return [{ path: 'CHANGELOG.md', name: '@openagentid/sdk', version: null, pending: sdk },
    ...releaseSet().map(({ directory, name, version }) => ({ path: join(directory, 'CHANGELOG.md'), name, version, pending: version }))]
    .map(file => ({ ...file, text: readFileSync(join(root, file.path), 'utf8') }));
}
