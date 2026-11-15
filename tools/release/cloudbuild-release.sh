#!/usr/bin/env bash
# Run the npm release of a pushed vX.Y.Z tag on Google Cloud Build (docs/RELEASING.md). A dry run by default.
#   bash tools/release/cloudbuild-release.sh vX.Y.Z <40-hex sha of the tagged commit> [--publish]
# Nothing is uploaded: the build clones the tag from the public repository and refuses it unless it is <sha>.
set -euo pipefail
tag="${1:?usage: cloudbuild-release.sh vX.Y.Z <sha> [--publish]}"
sha="${2:?usage: cloudbuild-release.sh vX.Y.Z <sha> [--publish]}"
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || { echo "not a release tag: $tag"; exit 2; }
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "not a full commit sha: $sha"; exit 2; }
config=ci/cloudbuild-release-dry-run.yaml
[ "${3:-}" = --publish ] && config=ci/cloudbuild-release.yaml
here="$(cd "$(dirname "$0")/../.." && pwd)"
export CLOUDSDK_CORE_DISABLE_FILE_LOGGING=1
gcloud builds submit --no-source --project l1fe-minds-fc --region us-central1 --config "$here/$config" \
  --substitutions "_TAG=$tag,_SHA=$sha"
