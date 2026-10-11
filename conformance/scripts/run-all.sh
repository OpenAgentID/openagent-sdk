#!/usr/bin/env bash
# Run the Rust and TypeScript conformance runners against the same vectors,
# collect JUnit reports, and produce a markdown summary comparing both.
#
# Usage:
#   scripts/run-all.sh [vectors-dir]
#
# Defaults to conformance/vectors relative to this script.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
VECTORS="${1:-$ROOT/vectors}"

REPORTS="$ROOT/.reports"
mkdir -p "$REPORTS"

RUST_BIN_DIR="$ROOT/runner-rust"
TS_DIR="$ROOT/runner-ts"

RUST_JUNIT="$REPORTS/rust.xml"
TS_JUNIT="$REPORTS/ts.xml"
RUST_LOG="$REPORTS/rust.log"
TS_LOG="$REPORTS/ts.log"
SUMMARY="$REPORTS/SUMMARY.md"

echo "==> Building Rust runner"
(cd "$RUST_BIN_DIR" && cargo build --release --locked --quiet)

# Resolve the binary through cargo metadata rather than assuming ./target:
# environments that set CARGO_TARGET_DIR place it elsewhere.
RUST_BIN="$(cd "$RUST_BIN_DIR" && cargo metadata --locked --no-deps --format-version 1 | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"] + "/release/conformance-runner")')"

echo "==> Installing TS runner deps"
if [ ! -d "$TS_DIR/node_modules" ]; then
  (cd "$TS_DIR" && npm install --no-audit --no-fund --loglevel=error)
fi

echo "==> Running Rust runner"
set +e
(cd "$RUST_BIN_DIR" && "$RUST_BIN" "$VECTORS" --junit "$RUST_JUNIT") >"$RUST_LOG" 2>&1
RUST_EXIT=$?
set -e

echo "==> Running TypeScript runner"
set +e
(cd "$TS_DIR" && node src/main.mjs "$VECTORS" --junit "$TS_JUNIT") >"$TS_LOG" 2>&1
TS_EXIT=$?
set -e

extract_total() {
  # Parses "TOTAL        X/Y passed" from runner log output.
  local log="$1"
  awk '/TOTAL[[:space:]]+[0-9]+\/[0-9]+ passed/ { for (i=1;i<=NF;i++) if ($i ~ /^[0-9]+\/[0-9]+$/) { print $i; exit } }' "$log"
}

extract_category() {
  local log="$1" cat="$2"
  awk -v c="$cat" '$1 == c { for (i=1;i<=NF;i++) if ($i ~ /^[0-9]+\/[0-9]+$/) { print $i; exit } }' "$log"
}

diff_failures() {
  local rust_log="$1" ts_log="$2"
  local rust_fails ts_fails drift
  rust_fails=$(grep -c "^  FAIL " "$rust_log" || true)
  ts_fails=$(grep -c "^  FAIL " "$ts_log" || true)
  drift=$(( rust_fails > ts_fails ? rust_fails - ts_fails : ts_fails - rust_fails ))
  printf "%s" "$drift"
}

RUST_TOTAL=$(extract_total "$RUST_LOG")
TS_TOTAL=$(extract_total "$TS_LOG")
DRIFT=$(diff_failures "$RUST_LOG" "$TS_LOG")

{
  echo "# OpenAgent SDK Conformance Summary"
  echo
  echo "Generated: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "Vectors:   $VECTORS"
  echo
  echo "## Results"
  echo
  echo "| Runner | Passed | JUnit |"
  echo "|--------|--------|-------|"
  echo "| Rust   | ${RUST_TOTAL:-?} | $RUST_JUNIT |"
  echo "| TypeScript | ${TS_TOTAL:-?} | $TS_JUNIT |"
  echo
  echo "## Per-Category"
  echo
  echo "| Category | Rust | TypeScript |"
  echo "|----------|------|-----------|"
  for cat in aegis arsenal crypto oas openagent; do
    r=$(extract_category "$RUST_LOG" "$cat")
    t=$(extract_category "$TS_LOG" "$cat")
    echo "| $cat | ${r:-?} | ${t:-?} |"
  done
  echo
  echo "## Drift"
  echo
  echo "Rust: ${RUST_TOTAL:-?} passed | TS: ${TS_TOTAL:-?} passed | Drift: ${DRIFT} vectors"
  echo
  echo "## Exit Codes"
  echo
  echo "- Rust runner: \`$RUST_EXIT\`"
  echo "- TS runner:   \`$TS_EXIT\`"
} >"$SUMMARY"

echo
cat "$SUMMARY"

if [ "$RUST_EXIT" -ne 0 ] || [ "$TS_EXIT" -ne 0 ]; then
  echo
  if [ "$RUST_EXIT" -ne 0 ]; then
    echo "==> Rust runner output (exit $RUST_EXIT)"
    cat "$RUST_LOG"
  fi
  if [ "$TS_EXIT" -ne 0 ]; then
    echo "==> TypeScript runner output (exit $TS_EXIT)"
    cat "$TS_LOG"
  fi
  echo "One or both runners reported failures. See $REPORTS/*.log for details."
  exit 1
fi

echo
echo "All runners passed. Reports in $REPORTS"
