// Shared helpers for the release tooling in this directory. Node 20.19+ only, no dependencies.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const root = resolve(import.meta.dirname, '../..');
export const registry = 'https://registry.npmjs.org';

export function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8'));
}

/** The release set, in publish order, with each package's manifest. */
export function releaseSet() {
  return readJson('tools/release/release-set.json').packages.map(entry => {
    const manifest = readJson(join(entry.directory, 'package.json'));
    return { ...entry, name: manifest.name, version: manifest.version, manifest };
  });
}

export function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

export function gitOk(...args) {
  try {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const semverPattern = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseVersion(version) {
  const match = semverPattern.exec(version);
  if (!match) throw new Error(`Not a semantic version: ${version}`);
  return { major: +match[1], minor: +match[2], patch: +match[3], prerelease: match[4] ?? null };
}

/** Semantic-version precedence: negative when a < b, zero when equal, positive when a > b. */
export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  for (const key of ['major', 'minor', 'patch']) if (x[key] !== y[key]) return x[key] - y[key];
  if (x.prerelease === y.prerelease) return 0;
  if (x.prerelease === null) return 1;
  if (y.prerelease === null) return -1;
  const p = x.prerelease.split('.'), q = y.prerelease.split('.');
  for (let i = 0; i < Math.max(p.length, q.length); i += 1) {
    if (p[i] === undefined) return -1;
    if (q[i] === undefined) return 1;
    const m = /^\d+$/.test(p[i]), n = /^\d+$/.test(q[i]);
    if (m && n && +p[i] !== +q[i]) return +p[i] - +q[i];
    if (m !== n) return m ? -1 : 1;
    if (p[i] !== q[i]) return p[i] < q[i] ? -1 : 1;
  }
  return 0;
}

/**
 * The registry document for a package, or null when the package does not exist.
 * Any other failure throws: a release must never treat an unreachable registry as "not published".
 */
export async function packument(name) {
  const url = `${registry}/${name.replace('/', '%2f')}`;
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (response.status === 404) return null;
    if (response.ok) return response.json();
    if (attempt === 3) throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
    await new Promise(done => setTimeout(done, attempt * 2000));
  }
}

/**
 * The `## [x.y.z] - YYYY-MM-DD` section of a Keep a Changelog file, or null.
 * Returns the heading date and the body without the heading.
 */
export function changelogSection(path, version) {
  const text = readFileSync(resolve(root, path), 'utf8');
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^## \\[${escaped}\\] - (\\d{4}-\\d{2}-\\d{2})[^\\n]*\\n`, 'm');
  const match = heading.exec(text);
  if (!match) return null;
  const rest = text.slice(match.index + match[0].length);
  const next = /^## /m.exec(rest);
  return { date: match[1], body: (next ? rest.slice(0, next.index) : rest).trim() };
}
