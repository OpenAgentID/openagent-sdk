# Releasing

A release is an annotated tag `vX.Y.Z` on a commit on `main`, where `X.Y.Z` is the `@openagentid/sdk`
version. Pushing the tag runs [`.github/workflows/release.yml`](../.github/workflows/release.yml), which
publishes the release set to npm from GitHub Actions and creates the GitHub release. Nobody publishes from
a laptop, and no npm token exists anywhere.

## The release set

[`tools/release/release-set.json`](../tools/release/release-set.json) lists the packages a tag releases,
in publish order:

| Package | Directory |
|---|---|
| `@openagentid/sdk` | `sdks/typescript` |
| `@openagentid/sdk-testing` | `sdks/testing` |
| `@openagentid/http` | `adapters/http/typescript` |
| `@openagentid/mcp` | `integrations/mcp/typescript` |
| `@openagentid/claude-agent` | `integrations/claude-agent-sdk/typescript` |
| `@openagentid/scim` | `bridges/scim/typescript` |
| `@openagentid/oidc` | `bridges/oidc/typescript` |
| `create-openagent` | `packages/create-openagent` |

Every release publishes a new SDK version. The other packages are published when they changed: the
workflow refuses a tag where a package's directory changed since the previous tag but its version is
already on npm, because that change would otherwise never reach npm.

## What the workflow does

1. **Plan** (`tools/release/plan.mjs`). The tag must be annotated, name the version in
   `sdks/typescript/package.json` and `src/version.ts`, and point at a commit on `main`'s first-parent
   history. The root `package.json` must match the SDK manifest. Each package is marked `publish` (its
   version is not on npm; it needs a dated `CHANGELOG.md` section), `published` (npm already has it from
   this commit, after a partial run) or `unchanged`. A version below npm's `latest` is refused.
2. **Wait for CI.** The `ci` workflow's push run on the tagged commit must pass.
3. **Publish** (`tools/release/publish.mjs`, GitHub environment `npm`). Every package marked `publish`
   is installed from its lockfile, typechecked, tested and built; the SDK also passes the browser size
   budgets. The companion packages are tested a second time against the SDK packed from the same commit.
   Each package is then published with `npm publish --provenance` through
   [npm trusted publishing](https://docs.npmjs.com/trusted-publishers): GitHub's OIDC token replaces a
   stored npm token, and npm attaches a provenance attestation naming this repository, the workflow and
   the commit. npm records the commit as `gitHead`, and the workflow checks it.
4. **GitHub release** (`tools/release/notes.mjs`). The notes are the SDK's `CHANGELOG.md` section, the
   full package set at the tag, and npm's integrity hash for each package published. The npm tarballs
   are attached. The release is marked Latest only when the tag is the highest version.

Every step is safe to re-run: `gh run rerun <run-id> --failed`. A version npm already has from this commit
is skipped, and an existing GitHub release is edited in place.

## Cut a release

1. **Release commit.** On a branch, make one commit, `chore(release): vX.Y.Z`. It is the only commit
   that changes `version` fields:
   - set `sdks/typescript/package.json` `version` and `VERSION` in `sdks/typescript/src/version.ts`;
   - bump every other package in the release set whose directory changed since the previous tag
     (`git diff --stat vPREVIOUS -- <directory>`);
   - when `create-openagent` is bumped, pin the new SDK in
     `packages/create-openagent/src/templates/starter.ts`, its test
     `packages/create-openagent/test/scaffold.test.mjs` and `tools/public-onboarding/verify.mjs`;
   - run `npm install --package-lock-only --ignore-scripts` in each bumped package and
     `node tools/release/sync-root-manifest.mjs` at the root;
   - in each bumped package's `CHANGELOG.md`, rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` with
     today's UTC date, and do the same in the root `CHANGELOG.md`, listing the package versions;
   - update the versions table in `README.md`.

   Run `node tools/release/check-changelogs.mjs` and each package's typecheck, tests and build. Open the
   pull request; it merges after review and green CI. CI runs the changelog check with `--registry`: every
   dated section must carry the UTC day npm published it, except the section for the version this commit
   releases, which npm gets only when the tag publishes it.
2. **Tag the merged commit.**

   ```sh
   git fetch origin
   git tag -s -a vX.Y.Z -m "OpenAgentID SDK X.Y.Z" origin/main   # -s signs; use -a alone without a signing key
   git push origin vX.Y.Z
   ```

   The tag is dated when it is created, and npm records the publish a few minutes later, so the tag,
   the npm version and the GitHub release carry the same day.
3. **Watch** `gh run watch` for the `release` run. Approve the `npm` environment if it asks.
4. **Check** what a developer will check:

   ```sh
   npm view @openagentid/sdk@X.Y.Z gitHead dist.attestations.provenance
   npm audit signatures            # in a project that installs the release
   gh release view vX.Y.Z
   ```

A pushed release tag is never moved or deleted. If a release needs a code fix, the fix ships as a new
patch version with a new tag.

## One-time setup

The owner of the npm packages and of the GitHub organization does this once.

- **npm trusted publishers.** For each package in the release set, on npmjs.com open the package's
  Settings → Trusted publishing → GitHub Actions and enter organization `OpenAgentID`, repository
  `openagent-sdk`, workflow `release.yml` and environment `npm`. After the first release through the
  workflow, set Settings → Publishing access to "Require two-factor authentication and disallow tokens".
- **GitHub environment `npm`.** Settings → Environments → `npm`: add the release reviewers as required
  reviewers and limit deployments to tags matching `v*`.
- **Tag ruleset.** A repository ruleset for `refs/tags/v*` that blocks updates and deletions and limits
  creation to maintainers.

## When the workflow cannot run

If GitHub Actions or npm's OIDC exchange is down and a release cannot wait, a maintainer publishes from a
clean checkout of the tag with `npm ci`, the package's tests, `npm run build` and `npm publish --access
public` (npm asks for a two-factor code). Such a version has no provenance attestation; the GitHub
release body names it. When the workflow runs again for the tag it skips versions already on npm.

## Versions before this workflow

`@openagentid/sdk` 0.1.0 to 0.8.0 and their companion versions were published by hand. None carries a
provenance attestation; npm records the source commit (`gitHead`) for 0.1.0 (`b5a4a19`), 0.1.1
(`90a3870`) and the 0.8.0 set (`fc1a6a4`) only.

| Tag | npm publish (UTC) | Tag points at |
|---|---|---|
| `v0.1.0` | 2026-08-01 01:48 | `9ef3f57`; npm 0.1.0 was built from `b5a4a19`, two commits later, after the `@openagentid` scope rename |
| `v0.2.0` | 2026-10-11 19:01 | `3f82b2e`, merge of #2 |
| `v0.2.1` | 2026-10-11 19:27 | `d8ba1ac`, merge of #3 |
| `v0.2.2` | 2026-10-11 20:23 | `afa2dd9`, merge of #4 |
| `v0.3.0` | 2026-10-12 00:06 | `f780b94`, merge of #5 |
| `v0.4.0` | 2026-10-12 02:36 | `01c4512`, #6 |
| `v0.5.0` | 2026-10-12 10:42 | `fe73faa`, merge of #9 |
| `v0.6.0` | 2026-10-12 10:45 | `95584e7`, merge of #10 |
| `v0.7.0` | 2026-10-12 11:58 | `36a80aa`, #11 |
| `v0.7.1` | 2026-10-12 12:25 | `e53349a`, merge of #12 |
| `v0.7.2` | 2026-10-12 12:48 | `13dce54`, merge of #13 |
| `v0.7.3` | 2026-10-12 22:07 | `50edd40`, merge of #15 |
| `v0.8.0` | 2026-10-17 06:11 | `fc1a6a4`, merge of #21 |

`v0.2.0` to `v0.3.0` were created when those versions were published. `v0.4.0` to `v0.8.0` were created on
17 October 2026, each annotated and dated to its npm publish time, on the `main` commit whose rebuilt
package matches the npm tarball. GitHub lists those eight releases on 17 October, the day they were
written; each release body opens with the npm publish time. To check any of them yourself, rebuild at the
tag and compare with the tarball:

```sh
git checkout v0.7.3 && cd sdks/typescript && npm ci --ignore-scripts && npm run build
npm pack @openagentid/sdk@0.7.3 && tar xzf openagentid-sdk-0.7.3.tgz
diff -r dist package/dist
```
