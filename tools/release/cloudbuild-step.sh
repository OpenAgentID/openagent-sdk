#!/usr/bin/env bash
# One step of the release on Google Cloud Build (ci/cloudbuild-release*.yaml; docs/RELEASING.md). Every step runs in
# /workspace/src, the tag checked out from the public repository, reads only public endpoints and never sees the npm
# token: publishing and verifying are inline in ci/cloudbuild-release.yaml and run no repository code.
#   cloudbuild-step.sh checks|plan|metadata|build|dry-run   (env: TAG, SHA)
set -euo pipefail
step="${1:?step}"
: "${TAG:?}" "${SHA:?}"
cd /workspace
case "$step" in
  checks) cd src && node tools/release/required-checks.mjs "$SHA" ;;
  plan) cd src && node tools/release/plan.mjs "$TAG" --out /workspace/plan.json --main-ref origin/main ;;
  metadata)
    # The 'release metadata' job (ci.yml release-checks), on the tagged commit.
    cd src
    node tools/release/sync-root-manifest.mjs --check
    node tools/release/check-changelogs.mjs --registry
    node --test tools/release/check-changelogs.test.mjs tools/release/release-bytes.test.mjs
    expected=cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30
    for file in $(git ls-files '*LICENSE-APACHE'); do
      test "$(sha256sum "$file" | cut -d' ' -f1)" = "$expected" || { echo "$file is not the verbatim Apache License 2.0"; exit 1; }
    done
    for directory in $(node -e "for (const p of require('./tools/release/release-set.json').packages) console.log(p.directory)"); do
      (cd "$directory" && npm audit --omit=dev --audit-level=high --package-lock-only)
    done
    ;;
  build) cd src && node tools/release/publish.mjs /workspace/plan.json --pack-only --out /workspace/release-files ;;
  dry-run) cd src && node tools/release/publish.mjs /workspace/plan.json --dry-run --out /workspace/release-files ;;
  *) echo "unknown step $step"; exit 2 ;;
esac
