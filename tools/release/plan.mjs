#!/usr/bin/env node
// Decide what a release tag publishes, and refuse a tag that is not releasable.
//
//   node tools/release/plan.mjs v0.8.1 [--out plan.json] [--main-ref origin/main]
//
// Checks: the tag is annotated, names the SDK version (package.json, src/version.ts and the root
// manifest agree), is checked out, and is on main. For each package in tools/release/release-set.json:
//   publish    - its version is not on npm yet; it must have a dated CHANGELOG section;
//   published  - npm already has this version from this exact commit (a re-run after a partial failure);
//   unchanged  - npm already has this version and nothing the package ships changed since the previous tag.
// A package whose shipped files changed since the previous tag but whose version is already on npm stops the
// release: its version must be bumped, otherwise the change would silently never reach npm.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { changelogSection, compareVersions, git, gitOk, packument, parseVersion, readJson, releaseSet, root } from './lib.mjs';
import { rootManifestDrift } from './sync-root-manifest.mjs';

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args.splice(index, 2)[1];
};
const out = option('--out');
const mainRef = option('--main-ref') ?? 'origin/main';
const tag = args[0] ?? process.env.GITHUB_REF_NAME;
const errors = [];
const warnings = [];

if (!tag || !/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag)) {
  console.error(`Usage: plan.mjs vX.Y.Z (got ${JSON.stringify(tag)})`);
  process.exit(2);
}
const version = tag.slice(1);
const { prerelease } = parseVersion(version);

if (!gitOk('rev-parse', '--verify', '--quiet', `refs/tags/${tag}`)) errors.push(`Tag ${tag} does not exist locally.`);
else if (git('cat-file', '-t', `refs/tags/${tag}`) !== 'tag') errors.push(`${tag} is a lightweight tag; release tags are annotated (git tag -a).`);
const sha = gitOk('rev-parse', '--verify', '--quiet', `${tag}^{commit}`) ? git('rev-parse', `${tag}^{commit}`) : null;
const head = git('rev-parse', 'HEAD');
if (sha && sha !== head) errors.push(`HEAD is ${head.slice(0, 7)}, not the tagged commit ${sha.slice(0, 7)}.`);
if (sha && !git('rev-list', '--first-parent', mainRef).split('\n').includes(sha)) {
  errors.push(`${tag} (${sha.slice(0, 7)}) is not a commit on ${mainRef}'s first-parent history; tag the commit that landed on main.`);
}

const sdk = readJson('sdks/typescript/package.json');
if (sdk.version !== version) errors.push(`${tag} does not match sdks/typescript/package.json (${sdk.version}).`);
const exported = /VERSION = '([^']+)'/.exec(readFileSync(join(root, 'sdks/typescript/src/version.ts'), 'utf8'))?.[1];
if (exported !== version) errors.push(`sdks/typescript/src/version.ts exports VERSION ${exported}, not ${version}.`);
for (const drift of rootManifestDrift()) errors.push(`Root package.json is out of date (${drift}); run node tools/release/sync-root-manifest.mjs.`);

let previousTag = null;
if (sha && gitOk('rev-parse', '--verify', '--quiet', `${sha}^`)) {
  try {
    previousTag = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', `${sha}^`);
  } catch {
    previousTag = null;
  }
}

const packages = [];
for (const entry of releaseSet()) {
  const { directory, name, version: packageVersion } = entry;
  const document = await packument(name);
  const onNpm = document?.versions?.[packageVersion];
  let status;
  if (!onNpm) {
    status = 'publish';
    const section = changelogSection(join(directory, 'CHANGELOG.md'), packageVersion);
    if (!section) errors.push(`${name} ${packageVersion}: ${directory}/CHANGELOG.md has no "## [${packageVersion}] - YYYY-MM-DD" section.`);
    else if (section.date !== new Date().toISOString().slice(0, 10)) {
      warnings.push(`${name} ${packageVersion}: CHANGELOG date ${section.date} is not today's UTC date; npm will record today.`);
    }
    if (!name.startsWith('@openagentid/') && name !== 'create-openagent') errors.push(`${name}: packages live under @openagentid/*.`);
    const repository = entry.manifest.repository;
    const url = repository?.url?.replace(/^git\+/, '');
    if (url !== 'https://github.com/OpenAgentID/openagent-sdk.git' || repository?.directory !== directory) {
      errors.push(`${name}: package.json repository must be { url: https://github.com/OpenAgentID/openagent-sdk.git, directory: ${directory} } for provenance.`);
    }
  } else if (onNpm.gitHead && sha && onNpm.gitHead === sha) {
    status = 'published';
  } else {
    const shipped = previousTag && sha
      ? !gitOk('diff', '--quiet', previousTag, sha, '--', directory, `:(exclude)${directory}/test`, `:(exclude)${directory}/vitest.config.ts`)
      : false;
    if (shipped) {
      errors.push(`${name} ${packageVersion} is already on npm (from ${onNpm.gitHead?.slice(0, 7) || 'an unrecorded commit'}), but ${directory} changed since ${previousTag}; bump its version in the release commit.`);
    }
    status = 'unchanged';
  }
  let distTag = null;
  if (status === 'publish') {
    const latest = document?.['dist-tags']?.latest;
    if (parseVersion(packageVersion).prerelease !== null) distTag = 'next';
    else if (latest && compareVersions(packageVersion, latest) <= 0) {
      errors.push(`${name} ${packageVersion} is not above npm latest ${latest}; the workflow never moves latest backwards.`);
    } else distTag = 'latest';
  }
  packages.push({ directory, name, version: packageVersion, status, distTag,
    sizeGate: Boolean(entry.sizeGate), testWithCandidateSdk: Boolean(entry.testWithCandidateSdk) });
}
const generator = packages.find(item => item.name === 'create-openagent');
if (generator?.status === 'publish') {
  const starter = readFileSync(join(root, generator.directory, 'src/templates/starter.ts'), 'utf8');
  const pinned = /'@openagentid\/sdk': '([^']+)'/.exec(starter)?.[1];
  if (pinned !== version) errors.push(`create-openagent ${generator.version} generates apps on @openagentid/sdk ${pinned}; pin ${version}, the SDK this tag releases.`);
}
const sdkPlan = packages[0];
if (sdkPlan.status === 'unchanged') errors.push(`@openagentid/sdk ${version} is already on npm from another commit; a release tag names a new SDK version.`);

const plan = { tag, version, sha, previousTag, prerelease: prerelease !== null, packages };
for (const warning of warnings) console.log(`::warning::${warning}`);
console.log(JSON.stringify(plan, null, 2));
if (out) writeFileSync(out, JSON.stringify(plan, null, 2) + '\n');
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `plan=${JSON.stringify(plan)}\n`);
if (errors.length > 0) {
  for (const error of errors) console.error(`::error::${error}`);
  process.exit(1);
}
