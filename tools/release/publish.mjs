#!/usr/bin/env node
// Build, test and publish the packages a release plan marks "publish", in release-set order. Packages marked
// "published" (on npm already from this commit, after a partial run) are built, tested and packed again, so
// every version the tag releases gets its release files, but they are not published twice.
//
//   node tools/release/publish.mjs plan.json [--dry-run] [--out <directory>]
//
// Every package is installed from its lockfile, typechecked, tested, built and (for the SDK) held to the
// browser size budgets before anything is published. Packages flagged testWithCandidateSdk are tested a
// second time against the SDK packed from this commit, so a companion never ships untested against the SDK
// it is released with. Publishing uses npm trusted publishing from GitHub Actions: no token, and npm attaches
// a provenance attestation that names this repository, workflow and commit.
//
// Before publishing, each package is also packed into --out (default: a temporary directory), with a CycloneDX
// SBOM of its locked dependency tree beside it and SHA256SUMS over the tarballs. npm packs deterministically,
// so these are the bytes npm serves; the workflow attests them, and its GitHub release job checks them against
// the registry. Publishing itself stays in the package directory, so npm records the commit as gitHead.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { packument, root } from './lib.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const outIndex = args.indexOf('--out');
const out = resolve(outIndex === -1 ? mkdtempSync(join(tmpdir(), 'openagentid-release-')) : args.splice(outIndex, 2)[1]);
mkdirSync(out, { recursive: true });
const planPath = args.find(arg => !arg.startsWith('--'));
if (!planPath) {
  console.error('Usage: publish.mjs plan.json [--dry-run] [--out <directory>]');
  process.exit(2);
}
const plan = JSON.parse(readFileSync(planPath, 'utf8'));

function run(directory, command, commandArgs) {
  console.log(`\n$ (${directory}) ${command} ${commandArgs.join(' ')}`);
  execFileSync(command, commandArgs, { cwd: join(root, directory), stdio: 'inherit', env: { ...process.env, CI: 'true' } });
}

function manifest(directory) {
  return JSON.parse(readFileSync(join(root, directory, 'package.json'), 'utf8'));
}

function verify(directory) {
  for (const script of ['typecheck', 'test']) if (manifest(directory).scripts?.[script]) run(directory, 'npm', ['run', script]);
}

/**
 * The CycloneDX SBOM of a package's locked dependency tree. npm 11 drops runtime dependencies from
 * `npm sbom --omit dev`, so the SBOM covers the whole lockfile (each component carries its scope), and it
 * is refused if any runtime dependency in package.json is missing from it.
 */
function sbom(directory) {
  const { name, version, dependencies = {} } = manifest(directory);
  const document = JSON.parse(execFileSync('npm', ['sbom', '--sbom-format', 'cyclonedx', '--sbom-type', 'library', '--package-lock-only'],
    { cwd: join(root, directory), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  Object.assign(document.metadata.component, { name, version });
  const listed = new Set((document.components ?? []).map(component => component.name));
  const missing = Object.keys(dependencies).filter(dependency => !listed.has(dependency));
  if (missing.length > 0) throw new Error(`${name}: the SBOM is missing runtime dependencies ${missing.join(', ')}.`);
  return `${JSON.stringify(document, null, 2)}\n`;
}

const install = ['ci', '--ignore-scripts', '--no-audit', '--no-fund'];
const sums = [];

/** Pack a built package and return the tarball path. A release tarball also gets an SBOM and a checksum. */
function pack(directory, release = true) {
  const destination = release ? out : mkdtempSync(join(tmpdir(), 'openagentid-candidate-'));
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', destination],
    { cwd: join(root, directory), encoding: 'utf8' }));
  const tarball = join(destination, packed.filename);
  if (!release) return tarball;
  writeFileSync(tarball.replace(/\.tgz$/, '.cdx.json'), sbom(directory));
  sums.push(`${createHash('sha256').update(readFileSync(tarball)).digest('hex')}  ${packed.filename}`);
  return tarball;
}

function finish() {
  writeFileSync(join(out, 'SHA256SUMS'), sums.length > 0 ? `${sums.join('\n')}\n` : '');
  console.log(`\nRelease files in ${out}:\n${sums.join('\n')}`);
}

const released = item => item.status === 'publish' || item.status === 'published';
const toRelease = plan.packages.filter(released);
const [sdk] = plan.packages;
if (toRelease.length === 0) {
  console.log(`Nothing to release for ${plan.tag}: every package is unchanged.`);
  finish();
  process.exit(0);
}

// The SDK is built first whenever a companion is tested against it or it is itself released.
let candidate = null;
if (toRelease.some(item => item.testWithCandidateSdk) || released(sdk)) {
  run(sdk.directory, 'npm', install);
  if (released(sdk)) verify(sdk.directory);
  run(sdk.directory, 'npm', ['run', 'build']);
  if (sdk.sizeGate) run(sdk.directory, 'npm', ['run', 'size']);
  candidate = pack(sdk.directory, released(sdk));
  console.log(`Candidate SDK ${sdk.name}@${sdk.version}: ${candidate}`);
}

for (const item of plan.packages) {
  if (!released(item)) {
    console.log(`\n= ${item.name}@${item.version}: ${item.status}, not released by this run.`);
    continue;
  }
  const existing = (await packument(item.name))?.versions?.[item.version];
  // A re-run after a partial failure: npm never accepts the same version twice, so a version already there
  // from this commit is rebuilt and packed for the release files but not published again.
  if (existing && existing.gitHead !== plan.sha) {
    throw new Error(`${item.name}@${item.version} is on npm from ${existing.gitHead || 'an unrecorded commit'}, not ${plan.sha}.`);
  }
  console.log(`\n> ${item.name}@${item.version} (${existing ? 'already on npm from this commit' : `dist-tag ${item.distTag}`})`);
  if (item !== sdk) {
    run(item.directory, 'npm', install);
    verify(item.directory);
    run(item.directory, 'npm', ['run', 'build']);
    if (item.testWithCandidateSdk) {
      run(item.directory, 'npm', ['install', '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', candidate]);
      verify(item.directory);
    }
    pack(item.directory);
  }
  if (existing) continue;
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
finish();
