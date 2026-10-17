#!/usr/bin/env node
// Check the root CHANGELOG.md and every release-set package's CHANGELOG.md against the rules in
// changelogs.mjs; with --registry, also against the dates npm published each version.
//
//   node tools/release/check-changelogs.mjs [--registry]
import { checkChangelogs, repositoryChangelogs } from './changelogs.mjs';
import { packument } from './lib.mjs';

const registry = process.argv.includes('--registry');
const files = repositoryChangelogs();
const errors = await checkChangelogs(files, registry ? packument : null);
if (errors.length > 0) {
  for (const error of errors) console.error(`::error::${error}`);
  process.exit(1);
}
console.log(`ok: ${files.length} changelogs${registry ? ', dates match npm' : ''}`);
