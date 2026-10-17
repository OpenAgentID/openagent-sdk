#!/usr/bin/env node
// Check a pull request's commits and title against the repository's commit rules (AGENTS.md):
// conventional commits with a subject of at most 72 characters, a migration note for every breaking
// change, no instruction to skip CI, and no co-author or tool attribution trailers.
//
//   node tools/release/check-commits.mjs <base-sha> <head-sha>     (PR_TITLE checks the title too; PR_AUTHOR)
import { git } from './lib.mjs';

const [base, head] = process.argv.slice(2);
if (!base || !head) {
  console.error('Usage: check-commits.mjs <base-sha> <head-sha>');
  process.exit(2);
}
const conventional = /^(feat|fix|refactor|perf|test|docs|chore|ci|build|style|revert)(\([a-z0-9][a-z0-9._/-]*\))?(!)?: \S/;
const skip = /\[(skip ci|ci skip|no ci|skip actions|actions skip)\]|\*\*\*NO_CI\*\*\*|skip-checks: ?true/i;
const attribution = /^(co-authored-by|generated-by|signed-off-by: .*(claude|copilot|cursor|chatgpt|codex))\b|generated with \[?(claude|copilot|cursor|chatgpt)/im;
const errors = [];

// Dependabot writes its own subjects ("chore(deps): bump the development group ..."), often past 72.
const bot = name => name === 'dependabot[bot]';

function checkSubject(label, subject, author = '') {
  const match = conventional.exec(subject);
  if (!match) errors.push(`${label}: "${subject}" is not a conventional commit (type(scope)!: summary).`);
  if (subject.length > 72 && !bot(author)) errors.push(`${label}: the subject is ${subject.length} characters; keep it to 72.`);
  if (skip.test(subject)) errors.push(`${label}: the subject asks CI to skip; CI is the gate.`);
  return match;
}

const log = git('log', '--no-merges', '--format=%H%x1f%an%x1f%s%x1f%b%x1e', `${base}..${head}`);
for (const record of log.split('\x1e').map(item => item.trim()).filter(Boolean)) {
  const [sha, author, subject, body = ''] = record.split('\x1f');
  const label = sha.slice(0, 7);
  const match = checkSubject(label, subject, author);
  if (skip.test(body)) errors.push(`${label}: the message asks CI to skip; CI is the gate.`);
  if (attribution.test(body)) errors.push(`${label}: no co-author or tool attribution trailers.`);
  if (match?.[3] && !/BREAKING CHANGE:|migrat/i.test(body)) errors.push(`${label}: a breaking change needs a migration note in the body.`);
}
if (process.env.PR_TITLE) checkSubject('pull request title', process.env.PR_TITLE, process.env.PR_AUTHOR);

if (errors.length > 0) {
  for (const error of errors) console.error(`::error::${error}`);
  process.exit(1);
}
console.log(`ok: commits ${base.slice(0, 7)}..${head.slice(0, 7)}${process.env.PR_TITLE ? ' and the title' : ''}`);
