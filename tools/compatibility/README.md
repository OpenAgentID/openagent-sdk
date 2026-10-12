# Published-package compatibility

From the repository root, use your existing Depot project:

```sh
depot build --project "$DEPOT_PROJECT_ID" \
  --file tools/compatibility/Dockerfile \
  --build-arg OAID_SOURCE_SHA="$(git rev-parse HEAD)" \
  --output type=local,dest=compatibility-results .
```

The Dockerfile pins npm 11.21.0 for deterministic development dependency
resolution, then builds and tests real Rust/WASM, the packages and deployment
examples. The JavaScript runner can also be invoked inside a qualified Depot
build with crypto-wasm already built in `crates/openagent-crypto-wasm/pkg`:

```sh
node tools/compatibility/verify.mjs
```

The runner uses locked installs, builds and tests the SDK/integrations, creates
npm archives, then repeats integration tests with the packed candidate SDK.
It installs the full supported npm set in one consumer without legacy peer
resolution, loads every public module through its supported ESM and CommonJS
conditions, checks VERSION metadata and runs the repository examples.

Results, command logs, archive hashes and the consumer's lock are retained in
`.compatibility-artifacts/`. A failed stage produces a failing exit code and
`summary.json` with `passed: false`; a container build alone is not a pass.

The candidate SDK suites exercise the published crypto binding as well as the
new binding's separately qualified default-clock behavior. The existing
`tools/public-onboarding/verify.mjs` browser suite and `deploy` runtime suites
remain part of release qualification.
