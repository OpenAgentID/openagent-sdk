#!/usr/bin/env bash
# Run the npm release of a pushed vX.Y.Z tag on Google Cloud Build (docs/RELEASING.md), in two builds (MUST-84-S1):
#   bash tools/release/cloudbuild-release.sh vX.Y.Z <40-hex sha>                          # 1. pack build: checks, packs, stages; prints step 2
#   bash tools/release/cloudbuild-release.sh vX.Y.Z <40-hex sha> --publish <sums> <plan>  # 2. publish build: exactly those bytes
# Nothing is uploaded: the pack build clones the tag from the public repository and refuses it unless it is <sha>; the
# publish build runs no repository code and refuses staged files that do not hash to <sums> (SHA256SUMS) and <plan> (plan.json).
set -euo pipefail
usage="usage: cloudbuild-release.sh vX.Y.Z <sha> [--publish <sha256 of SHA256SUMS> <sha256 of plan.json>]"
tag="${1:?$usage}"
sha="${2:?$usage}"
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || { echo "not a release tag: $tag"; exit 2; }
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "not a full commit sha: $sha"; exit 2; }
config=ci/cloudbuild-release-pack.yaml
substitutions="_TAG=$tag,_SHA=$sha"
if [ "${3:-}" = --publish ]; then
  sums="${4:-}" plan="${5:-}"
  [[ "$sums" =~ ^[0-9a-f]{64}$ && "$plan" =~ ^[0-9a-f]{64}$ ]] || { echo "$usage"; exit 2; }
  config=ci/cloudbuild-release.yaml
  substitutions="$substitutions,_SUMS=$sums,_PLAN=$plan"
elif [ -n "${3:-}" ]; then
  echo "$usage"; exit 2
fi
here="$(cd "$(dirname "$0")/../.." && pwd)"
export CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1
gcloud builds submit --no-source --project l1fe-minds-fc --region us-central1 --config "$here/$config" \
  --substitutions "$substitutions"
