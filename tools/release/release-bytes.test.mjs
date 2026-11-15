// CONDITION-84-C3: a re-run after a partial Cloud Build publish (tarballs record no gitHead) plans the released
// version as published and accepts it only with npm's exact bytes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { onNpmStatus, sameBytesAsNpm } from './lib.mjs';

const sha = 'a'.repeat(40);
const bytes = Buffer.from('tarball bytes');
const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

test('a version npm has from this commit is published', () => {
  assert.deepEqual(onNpmStatus({ onNpm: { gitHead: sha }, sha, changedSincePreviousTag: true }), { status: 'published' });
});

test('a tarball this release published (no gitHead, directory changed) is published with npm integrity', () => {
  assert.deepEqual(onNpmStatus({ onNpm: { dist: { integrity } }, sha, changedSincePreviousTag: true }),
    { status: 'published', npmIntegrity: integrity });
});

test('another commit, or no integrity, still needs a bump; an untouched directory is unchanged', () => {
  assert.deepEqual(onNpmStatus({ onNpm: { gitHead: 'b'.repeat(40), dist: { integrity } }, sha, changedSincePreviousTag: true }),
    { status: 'unchanged', mustBump: true });
  assert.deepEqual(onNpmStatus({ onNpm: { dist: { integrity: 'sha1-x' } }, sha, changedSincePreviousTag: true }),
    { status: 'unchanged', mustBump: true });
  assert.deepEqual(onNpmStatus({ onNpm: { dist: { integrity } }, sha, changedSincePreviousTag: false }),
    { status: 'unchanged', mustBump: false });
});

test('only the exact bytes match npm', () => {
  assert.equal(sameBytesAsNpm(integrity, bytes), true);
  assert.equal(sameBytesAsNpm(integrity, Buffer.from('other bytes')), false);
  assert.equal(sameBytesAsNpm(undefined, bytes), false);
});
