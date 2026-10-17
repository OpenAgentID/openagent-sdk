#!/usr/bin/env node
// Build, test and publish the packages a release plan marks "publish", in release-set order.
//
//   node tools/release/publish.mjs plan.json [--dry-run]
//
// Every package is installed from its lockfile, typechecked, tested, built and (for the SDK) held to the
// browser size budgets before anything is published. Packages flagged testWithCandidateSdk are tested a
// second time against the SDK packed from this commit, so a companion never ships untested against the SDK
// it is released with. Publishing uses npm trusted publishing from GitHub Actions: no token, and npm attaches
// a provenance attestation that names this repository, workflow and commit.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packument, root } from './lib.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const planPath = args.find(arg => !arg.startsWith('--'));
if (!planPath) {
  console.error('Usage: publish.mjs plan.json [--dry-run]');
  process.exit(2);
}
const plan = JSON.parse(readFileSync(planPath, 'utf8'));

function run(directory, command, commandArgs) {
  console.log(`\n$ (${directory}) ${command} ${commandArgs.join(' ')}`);
  execFileSync(command, commandArgs, { cwd: join(root, directory), stdio: 'inherit', env: { ...process.env, CI: 'true' } });
}

function hasScript(directory, name) {
  return Boolean(JSON.parse(readFileSync(join(root, directory, 'package.json'), 'utf8')).scripts?.[name]);
}

function verify(directory) {
  for (const script of ['typecheck', 'test']) if (hasScript(directory, script)) run(directory, 'npm', ['run', script]);
}

const install = ['ci', '--ignore-scripts', '--no-audit', '--no-fund'];
const toPublish = plan.packages.filter(item => item.status === 'publish');
const [sdk] = plan.packages;
if (toPublish.length === 0) {
  console.log(`Nothing to publish for ${plan.tag}: every package is already on npm.`);
  process.exit(0);
}

// The SDK is built first whenever anything is published, because the companions are tested against it.
let candidate = null;
if (toPublish.some(item => item.testWithCandidateSdk) || sdk.status === 'publish') {
  run(sdk.directory, 'npm', install);
  if (sdk.status === 'publish') verify(sdk.directory);
  run(sdk.directory, 'npm', ['run', 'build']);
  if (sdk.sizeGate) run(sdk.directory, 'npm', ['run', 'size']);
  const destination = mkdtempSync(join(tmpdir(), 'openagentid-candidate-'));
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', destination],
    { cwd: join(root, sdk.directory), encoding: 'utf8' }));
  candidate = join(destination, packed.filename);
  console.log(`Candidate SDK ${packed.name}@${packed.version}: ${candidate} (${packed.integrity})`);
}

for (const item of plan.packages) {
  if (item.status !== 'publish') {
    console.log(`\n= ${item.name}@${item.version}: ${item.status}, not published by this run.`);
    continue;
  }
  const existing = (await packument(item.name))?.versions?.[item.version];
  if (existing) {
    // A re-run of this job after a partial failure: npm never accepts the same version twice.
    if (existing.gitHead === plan.sha) {
      console.log(`\n= ${item.name}@${item.version} is already on npm from this commit.`);
      continue;
    }
    throw new Error(`${item.name}@${item.version} appeared on npm from ${existing.gitHead || 'an unrecorded commit'}, not ${plan.sha}.`);
  }
  console.log(`\n> ${item.name}@${item.version} (dist-tag ${item.distTag})`);
  if (item !== sdk) {
    run(item.directory, 'npm', install);
    verify(item.directory);
    run(item.directory, 'npm', ['run', 'build']);
    if (item.testWithCandidateSdk) {
      run(item.directory, 'npm', ['install', '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', candidate]);
      verify(item.directory);
    }
  }
  // A dry run cannot attest provenance: npm only signs inside the GitHub Actions OIDC context.
  const publish = ['publish', '--access', 'public', '--tag', item.distTag, '--ignore-scripts', dryRun ? '--dry-run' : '--provenance'];
  run(item.directory, 'npm', publish);
  if (dryRun) continue;
  for (let attempt = 1; ; attempt += 1) {
    const published = (await packument(item.name))?.versions?.[item.version];
    if (published) {
      if (published.gitHead !== plan.sha) throw new Error(`${item.name}@${item.version} on npm records gitHead ${published.gitHead}, not ${plan.sha}.`);
      console.log(`= ${item.name}@${item.version} is on npm from ${plan.sha.slice(0, 7)} (${published.dist.integrity}).`);
      break;
    }
    if (attempt === 10) throw new Error(`${item.name}@${item.version} did not appear on the registry after publishing.`);
    await new Promise(done => setTimeout(done, 6000));
  }
}
