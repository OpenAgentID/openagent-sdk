#!/usr/bin/env node
// Refuse a release unless main's required checks passed on exactly the tree the tag releases.
//
//   node tools/release/required-checks.mjs <sha>
//
// The checks run on pull requests (ci-hooks on Google Cloud Build posts them as commit statuses on the PR head), and
// main is linear, so the tagged commit is the squash or rebase of a merged pull request, not its head. The tag's
// commit must therefore have the same tree as the head of the pull request it came from, and that head must carry a
// success for every context main's ruleset requires, read from the ruleset itself. Public endpoints only, no token.
import { git } from './lib.mjs';

const sha = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(sha ?? '')) {
  console.error('Usage: required-checks.mjs <40-hex sha>');
  process.exit(2);
}
const api = 'https://api.github.com/repos/OpenAgentID/openagent-sdk';
async function get(path) {
  const response = await fetch(`${api}${path}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'openagentid-release' } });
  if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`);
  return response.json();
}

const rules = await get('/rules/branches/main');
const required = rules.filter(rule => rule.type === 'required_status_checks')
  .flatMap(rule => rule.parameters.required_status_checks.map(check => check.context));
if (required.length === 0) throw new Error('main requires no status checks; refusing to release without them.');

const pulls = (await get(`/commits/${sha}/pulls`)).filter(pull => pull.merged_at && pull.base.ref === 'main');
if (pulls.length !== 1) throw new Error(`${sha.slice(0, 7)} is not the merge of exactly one pull request into main (${pulls.length}).`);
const [pull] = pulls;
const head = pull.head.sha;
const tree = await get(`/git/commits/${head}`).then(commit => commit.tree.sha);
if (tree !== git('rev-parse', `${sha}^{tree}`)) {
  throw new Error(`#${pull.number}'s head ${head.slice(0, 7)} is not the tree ${sha.slice(0, 7)} releases; bring it up to date with main before merging.`);
}
const statuses = await get(`/commits/${head}/status?per_page=100`).then(status => status.statuses);
const failing = required.filter(context => statuses.find(status => status.context === context)?.state !== 'success');
if (failing.length > 0) throw new Error(`#${pull.number} @${head.slice(0, 7)} is not green: ${failing.join('; ')}.`);
console.log(`#${pull.number} @${head} (tree ${tree}) passed every required check: ${required.join('; ')}.`);
