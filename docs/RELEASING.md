# Releasing

A release is an annotated tag `vX.Y.Z` on a commit on `main`, where `X.Y.Z` is the `@openagentid/sdk`
version. The release owner then runs the release on Google Cloud Build
([`ci/cloudbuild-release.yaml`](../ci/cloudbuild-release.yaml)), which publishes the release set to npm.
Linux builds run on Google Cloud Build only, so there is no GitHub Actions release workflow. Nobody
publishes from a laptop.

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
release refuses a tag where a package's directory changed since the previous tag but its version is
already on npm, because that change would otherwise never reach npm.

## What the release build does

`bash tools/release/cloudbuild-release.sh vX.Y.Z <sha>` submits the build with no source: its first step
clones this public repository, checks out the tag and refuses it unless the tag names `<sha>`. Every
later step is [`tools/release/cloudbuild-step.sh`](../tools/release/cloudbuild-step.sh) from that
checkout, on the gate worker pool and the gate image (pinned by digest). Without `--publish` it runs
[`ci/cloudbuild-release-dry-run.yaml`](../ci/cloudbuild-release-dry-run.yaml), which reads no secret and
publishes nothing.

1. **Required checks** (`tools/release/required-checks.mjs`). `main` is linear, so the tagged commit is the
   squash of a merged pull request. Its tree must equal that pull request's head tree, and the head must
   carry a success for every context `main`'s ruleset requires (read from the ruleset, not listed here).
   A tag with any red or missing check stops here.
2. **Plan** (`tools/release/plan.mjs`). The tag must be annotated, name the version in
   `sdks/typescript/package.json` and `src/version.ts`, and point at a commit on `main`'s first-parent
   history. The root `package.json` must match the SDK manifest. Each package is marked `publish` (its
   version is not on npm; it needs a dated `CHANGELOG.md` section), `published` (npm already has it from
   this commit, after a partial run) or `unchanged`. A version below npm's `latest` is refused.
3. **Release metadata**: the root manifest check, the changelog check against npm and its tests, the
   verbatim Apache licence, and `npm audit` (high) over every released package, as CI runs them.
4. **Build** (`tools/release/publish.mjs --pack-only`, no secret). Every package marked `publish` is
   installed from its lockfile, typechecked, tested and built; the SDK also passes the browser size
   budgets. The companion packages are tested a second time against the SDK packed from the same commit.
   Every package is packed once, with a CycloneDX SBOM and `SHA256SUMS`.
5. **Publish** (inline in the config; no repository code). The only step that receives the npm token
   (Secret Manager `oaid-npm-publish-token`, read by the release's own service account `oaid-release@`
   only). In a fresh directory outside the workspace it checks each tarball the plan publishes against
   `SHA256SUMS` and runs `npm publish <tarball> --ignore-scripts` with a fresh userconfig that names the
   token's variable, never its value; no other command sees the token. A version already on npm is skipped.
6. **Verify.** The build downloads every version it published back from npm, checks that the bytes npm
   serves are the bytes it packed (`sha256sum -c SHA256SUMS`), and prints each tarball's sha256.

**No npm provenance.** npm provenance and trusted publishing need a GitHub Actions or GitLab OIDC token,
so versions released from Cloud Build carry no provenance attestation. In its place the release notes
list each tarball's sha256 and npm integrity, and the build log that printed them is kept in Cloud Logging.

Every step is safe to re-run: run the same command again. A version npm already has from this commit is
rebuilt and packed but not published again. To rehearse before tagging, run the plan and a dry-run publish
from the release commit with the tag created locally (do not push it):
`node tools/release/plan.mjs vX.Y.Z --out plan.json`, then
`node tools/release/publish.mjs plan.json --dry-run --out release-files`.

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
2. **Tag the merged commit.** Bring the release pull request up to date with `main` before it merges, so
   the merged commit has its head's tree (step 1 above).

   ```sh
   git fetch origin
   git tag -s -a vX.Y.Z -m "OpenAgentID SDK X.Y.Z" origin/main   # -s signs; use -a alone without a signing key
   git push origin vX.Y.Z
   ```

   The tag is dated when it is created, and npm records the publish a few minutes later, so the tag,
   the npm version and the GitHub release carry the same day.
3. **Run the release.** A dry run first, then the publish, both on the tagged commit:

   ```sh
   sha=$(git rev-parse vX.Y.Z^{commit})
   bash tools/release/cloudbuild-release.sh vX.Y.Z "$sha"
   bash tools/release/cloudbuild-release.sh vX.Y.Z "$sha" --publish
   ```
4. **Write the GitHub release** from a checkout of the tag, with the build's plan and tarballs
   (`npm pack <package>@X.Y.Z` fetches the bytes npm serves; `SHA256SUMS` is in the build log):
   `node tools/release/notes.mjs plan.json notes.md`, then
   `gh release create vX.Y.Z --notes-file notes.md --verify-tag *.tgz SHA256SUMS`.
5. **Check** what a developer will check:

   ```sh
   npm view @openagentid/sdk@X.Y.Z gitHead dist.integrity
   gh release download vX.Y.Z --repo OpenAgentID/openagent-sdk && sha256sum -c SHA256SUMS
   gh release view vX.Y.Z
   ```

A pushed release tag is never moved or deleted. If a release needs a code fix, the fix ships as a new
patch version with a new tag.

## One-time setup

- **npm token.** The owner of the npm packages creates a granular access token that may publish the
  packages in the release set and nothing else, and stores it as the Secret Manager secret
  `oaid-npm-publish-token` in `l1fe-minds-fc`; only the release build's service account can read it.
  Publishing access on each package must allow tokens with two-factor authentication. Rotate it yearly
  and whenever anyone who could read it leaves.
- **Rulesets** (in place). `main` requires a pull request with a code owner's approval, linear history and
  the conformance, SDK and release-metadata checks; `refs/tags/v*` and `refs/tags/*-v*` tags cannot be
  updated or deleted.

## Rolling back

Published versions are immutable. A tag is never moved or deleted, and a version is never unpublished
except to contain a leaked secret. Deprecations, dist-tag moves and yanks are decided by the maintainers and
recorded in the release notes.

| Situation | npm | GitHub |
|---|---|---|
| A bad version, with a fix coming | `npm dist-tag add <package>@<good> latest`, then `npm deprecate <package>@<bad> "<one line>. Use <fixed> or later."` | `gh release edit <tag> --prerelease`, and start the notes with "Superseded by <fixed>." |
| The fix is ready | Release the next patch version normally; `latest` moves with it | The new release becomes Latest |
| A secret leaked into a tarball | Rotate the secret first. Then `npm unpublish <package>@<bad>` within 72 hours, or ask npm support | Delete the asset, rotate, release again |
| The build failed mid-publish | Fix the cause, then run `cloudbuild-release.sh <tag> <sha> --publish` again; versions npm already has from the tagged commit are rebuilt and packed but not published again | `gh release edit` the release in place |

## When the build cannot run

If Cloud Build is down and a release cannot wait, a maintainer publishes from a clean checkout of the tag
with `npm ci`, the package's tests, `npm run build` and `npm publish --access public` (npm asks for a
two-factor code), and writes the notes with `notes.mjs --manual`. The next run of the build for the tag
skips versions already on npm.

## Versions before this workflow

`@openagentid/sdk` 0.1.0 to 0.8.0 and their companion versions were published by hand. None carries a
provenance attestation; npm records the source commit (`gitHead`) for 0.1.0 (`b5a4a19`), 0.1.1
(`90a3870`) and the 0.8.0 set (`fc1a6a4`) only.

| Tag | npm publish (UTC) | Tag points at |
|---|---|---|
| `v0.1.0` | 2026-08-01 01:48 | `9ef3f57`; npm records `b5a4a19` as `gitHead` and the manifests match it, but the compiled `dist/` of 0.1.0 matches `9ef3f57` and imports the pre-rename `@openagent/*` names; 0.1.1 is the corrected build |
| `v0.1.1` | 2026-08-01 03:43 | `90a3870`, npm's `gitHead` for every 0.1.1 package |
| `v0.2.0` | 2026-10-11 19:01 | `3f82b2e`, merge of #2 |
| `v0.2.1` | 2026-10-11 19:27 | `d8ba1ac`, merge of #3 |
| `v0.2.2` | 2026-10-11 20:23 | `afa2dd9`, merge of #4 |
| `v0.3.0` | 2026-10-12 00:06 | `f780b94`, merge of #5 |
| `v0.4.0` | 2026-10-12 02:36 | `01c4512`, #6 |
| `v0.5.0` | 2026-10-12 10:42 | `f9db9bc`; npm 0.5.0 was built from `fe73faa`, the merge of #9, whose `sdks/typescript` differs from the tag only by one `as const` in `src/character-api.ts` |
| `v0.6.0` | 2026-10-12 10:45 | `95584e7`, merge of #10 |
| `v0.7.0` | 2026-10-12 11:58 | `36a80aa`, #11 |
| `v0.7.1` | 2026-10-12 12:25 | `e53349a`, merge of #12 |
| `v0.7.2` | 2026-10-12 12:48 | `13dce54`, merge of #13 |
| `v0.7.3` | 2026-10-12 22:07 | `50edd40`, merge of #15 |
| `v0.8.0` | 2026-10-17 06:11 | `fc1a6a4`, merge of #21 |

`v0.2.0` to `v0.3.0` were created when those versions were published. `v0.4.0` to `v0.8.0` were created on
17 October 2026 and `v0.1.1` on 20 October 2026, each annotated and dated to its npm publish time. Every
release from `v0.2.0` on was checked against npm on 20 October 2026: the TypeScript sources embedded in the
SDK tarball's sourcemaps, and each package's manifest, README, CHANGELOG and licenses, are byte-identical
to the tagged commit, except `v0.5.0` as noted above. Each release carries the npm tarballs it published and
`SHA256SUMS`, and names the commit its packages were built from. To check one yourself, rebuild at the tag
and compare with the tarball:

```sh
git checkout v0.7.3 && cd sdks/typescript && npm ci --ignore-scripts && npm run build
npm pack @openagentid/sdk@0.7.3 && tar xzf openagentid-sdk-0.7.3.tgz
diff -r dist package/dist
```

## Tags outside the SDK release set

A package released on its own is tagged `<package>-vX.Y.Z`, without the npm scope.

| Tag | Published | Tag points at |
|---|---|---|
| `oidc-v0.3.0` | npm `@openagentid/oidc` 0.3.0, 2026-10-13 09:36 UTC | `b939614`, merge of #18; npm recorded no `gitHead`, and the tarball's sources and manifest match it |
| `openagent-auth-protocol-v0.1.0` | crates.io, 2026-08-01 07:45 UTC | `ea86354`, the commit the crate's `.cargo_vcs_info.json` records |
| `openagent-crypto-wasm-v0.1.1` | crates.io, 2026-08-01 07:55 UTC | `ea86354`, as recorded by the crate |
| `openagent-skills-policy-v0.1.0` | crates.io, 2026-08-01 08:05 UTC | `ea86354`, as recorded by the crate; the published manifest adds `version = "2.0.0"` to its two `arsenal` git dependencies |
| `openagentid-sdk-v0.1.0` | PyPI `openagentid-sdk` 0.1.0, 2026-08-01 04:34 UTC | `ea86354`; every sdist file matches `sdks/python` |

Each of these has a GitHub release carrying the registry's files and `SHA256SUMS`.
