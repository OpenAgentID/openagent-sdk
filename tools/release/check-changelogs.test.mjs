// node --test tools/release/check-changelogs.test.mjs
// The npm checks of changelogs.mjs (check-changelogs.mjs) against a mocked registry: nothing here reaches the network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkChangelogs, repositoryChangelogs } from './changelogs.mjs';
import { compareVersions } from './lib.mjs';

const header = '# Changelog\n\n';

/** A mocked registry: { name: { version: 'YYYY-MM-DD' } } -> lookup(name) returning a packument or null. */
function registry(packages) {
  return async name => {
    const published = packages[name];
    if (!published) return null;
    const versions = Object.keys(published).sort(compareVersions);
    return {
      name,
      'dist-tags': { latest: versions.filter(version => !version.includes('-')).at(-1) },
      versions: Object.fromEntries(versions.map(version => [version, { name, version }])),
      time: Object.fromEntries(versions.map(version => [version, `${published[version]}T12:00:00.000Z`])),
    };
  };
}

const npm = registry({ '@openagentid/sdk': { '0.7.2': '2026-10-14', '0.8.0': '2026-10-17' } });

test('the release commit passes before npm has its version', async () => {
  const text = `${header}## [0.8.1] - 2026-10-18\n\n- Fix.\n\n## [0.8.0] - 2026-10-17\n\n- One.\n\n## [0.7.2] - 2026-10-14\n\n- Two.\n`;
  const files = [
    { path: 'CHANGELOG.md', text, name: '@openagentid/sdk', version: null, pending: '0.8.1' },
    { path: 'sdks/typescript/CHANGELOG.md', text, name: '@openagentid/sdk', version: '0.8.1', pending: '0.8.1' },
  ];
  assert.deepEqual(await checkChangelogs(files, npm), []);
});

test('a first release of a package npm does not have yet passes', async () => {
  const files = [{ path: 'p/CHANGELOG.md', text: `${header}## [0.1.0] - 2026-10-18\n\n- First.\n`, name: '@openagentid/new', version: '0.1.0', pending: '0.1.0' }];
  assert.deepEqual(await checkChangelogs(files, npm), []);
});

test('a historical version missing from npm is still an error', async () => {
  const text = `${header}## [0.8.1] - 2026-10-18\n\n## [0.8.0] - 2026-10-17\n\n## [0.7.9] - 2026-10-16\n\n## [0.7.2] - 2026-10-14\n`;
  const files = [{ path: 'sdks/typescript/CHANGELOG.md', text, name: '@openagentid/sdk', version: '0.8.1', pending: '0.8.1' }];
  assert.deepEqual(await checkChangelogs(files, npm), [
    'sdks/typescript/CHANGELOG.md: 0.7.9 is not on npm (@openagentid/sdk), and only the pending 0.8.1 may be.',
  ]);
});

test('an unpublished newest section that is not the package version is an error', async () => {
  const text = `${header}## [0.8.2] - 2026-10-18\n\n## [0.8.0] - 2026-10-17\n`;
  const files = [{ path: 'sdks/typescript/CHANGELOG.md', text, name: '@openagentid/sdk', version: '0.8.1', pending: '0.8.1' }];
  const errors = await checkChangelogs(files, npm);
  assert.ok(errors.includes('sdks/typescript/CHANGELOG.md: 0.8.2 is not on npm (@openagentid/sdk), and only the pending 0.8.1 may be.'), errors.join('\n'));
});

test('a pending version at or below npm latest is an error', async () => {
  const ahead = registry({ '@openagentid/sdk': { '0.8.0': '2026-10-17', '0.9.0': '2026-10-17' } });
  const text = `${header}## [0.8.1] - 2026-10-18\n\n## [0.8.0] - 2026-10-17\n`;
  const files = [{ path: 'sdks/typescript/CHANGELOG.md', text, name: '@openagentid/sdk', version: '0.8.1', pending: '0.8.1' }];
  assert.deepEqual(await checkChangelogs(files, ahead), [
    'sdks/typescript/CHANGELOG.md: the pending 0.8.1 is not above npm latest 0.9.0 (@openagentid/sdk).',
  ]);
});

test('a published version dated differently from npm is still an error', async () => {
  const text = `${header}## [0.8.1] - 2026-10-18\n\n## [0.8.0] - 2026-10-16\n\n## [0.7.2] - 2026-10-14\n`;
  const files = [{ path: 'sdks/typescript/CHANGELOG.md', text, name: '@openagentid/sdk', version: '0.8.1', pending: '0.8.1' }];
  assert.deepEqual(await checkChangelogs(files, npm), [
    'sdks/typescript/CHANGELOG.md: 0.8.0 is dated 2026-10-16; npm published it on 2026-10-17 (UTC).',
  ]);
});

test('a registry failure fails the check instead of passing it', async () => {
  const down = async () => { throw new Error('GET https://registry.npmjs.org/@openagentid%2fsdk failed: 503'); };
  const files = [{ path: 'CHANGELOG.md', text: `${header}## [0.8.0] - 2026-10-17\n`, name: '@openagentid/sdk', version: null, pending: '0.8.1' }];
  await assert.rejects(checkChangelogs(files, down), /503/);
});

test("this repository's changelogs pass as the documented release commit", async () => {
  // docs/RELEASING.md: the release commit renames each pending package's [Unreleased] to its dated version.
  const date = '2099-01-01';
  const published = {};
  const files = repositoryChangelogs().map(file => {
    const released = file.text.startsWith('## [Unreleased]', file.text.indexOf('## '))
      && !file.text.includes(`## [${file.pending}] - `);
    const text = released ? file.text.replace('## [Unreleased]', `## [${file.pending}] - ${date}`) : file.text;
    for (const match of text.matchAll(/^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})$/gm)) {
      if (released && match[1] === file.pending) continue; // the tag has not published it yet
      (published[file.name] ??= {})[match[1]] = match[2];
    }
    return { ...file, text };
  });
  assert.ok(files.some(file => file.text.includes(`## [${file.pending}] - ${date}`)), 'no changelog has a pending release to simulate');
  assert.deepEqual(await checkChangelogs(files, registry(published)), []);
});
