#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture_dir="$repo_root/test/fixtures/outside-spec"
repo_bin="$repo_root/node_modules/.bin"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/domain-integrity-pack.XXXXXX")"
current_stage="setup"

report_and_clean_up() {
  local exit_status=$?
  rm -rf "$work_dir"
  if [ "$exit_status" -ne 0 ]; then
    echo "test-pack: FAILED at stage '$current_stage' (exit $exit_status)" >&2
  fi
  exit "$exit_status"
}
trap report_and_clean_up EXIT

begin_stage() {
  current_stage="$1"
  echo "test-pack: $current_stage"
}

fail_stage() {
  echo "test-pack: $current_stage: $1" >&2
  exit 1
}

begin_stage "arguments"
if [ "$#" -gt 1 ]; then
  echo "usage: scripts/test-pack.sh [tarball]" >&2
  exit 2
fi

if [ "$#" -eq 1 ]; then
  begin_stage "locate tarball"
  [ -f "$1" ] || fail_stage "no such file: $1"
  tarball="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
else
  begin_stage "npm pack"
  packed_name="$(cd "$repo_root" && npm pack --json --pack-destination "$work_dir" \
    | node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(0, "utf8"))[0].filename)')"
  tarball="$work_dir/$packed_name"
  [ -f "$tarball" ] || fail_stage "npm pack did not produce $tarball"
fi
echo "test-pack: tarball $tarball"

begin_stage "publint"
"$repo_bin/publint" run --strict "$tarball"

begin_stage "attw"
"$repo_bin/attw" --profile esm-only "$tarball"

begin_stage "prepare consumer project"
consumer_dir="$work_dir/consumer"
mkdir -p "$consumer_dir"
cp -R "$fixture_dir/src" "$consumer_dir/src"
cp "$fixture_dir/domain.config.ts" "$consumer_dir/domain.config.ts"
node -e '
  const fs = require("node:fs");
  const [fixtureTsconfig, consumerTsconfig] = process.argv.slice(1);
  const tsconfig = JSON.parse(fs.readFileSync(fixtureTsconfig, "utf8"));
  delete tsconfig.compilerOptions.paths;
  fs.writeFileSync(consumerTsconfig, JSON.stringify(tsconfig, null, 2) + "\n");
' "$fixture_dir/tsconfig.json" "$consumer_dir/tsconfig.json"
printf '%s\n' '{ "name": "domain-integrity-pack-consumer", "version": "0.0.0", "private": true, "type": "module" }' \
  > "$consumer_dir/package.json"

begin_stage "npm install tarball"
(cd "$consumer_dir" && npm install --no-audit --no-fund --loglevel=error "$tarball")

begin_stage "run installed bin"
installed_bin="$consumer_dir/node_modules/.bin/domain-integrity"
[ -x "$installed_bin" ] || fail_stage "installed bin missing or not executable: $installed_bin"
sarif_file="$work_dir/report.sarif"
check_exit_status=0
(cd "$consumer_dir" && "$installed_bin" check --format sarif -p tsconfig.json -c domain.config.ts) \
  > "$sarif_file" || check_exit_status=$?
[ "$check_exit_status" -eq 1 ] || fail_stage "expected exit code 1, got $check_exit_status"
node -e '
  const fs = require("node:fs");
  const fail = (message) => { console.error(message); process.exit(1); };
  let sarif;
  try { sarif = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch (error) { fail("output is not JSON: " + error.message); }
  if (sarif.version !== "2.1.0") fail("expected SARIF version 2.1.0, got " + JSON.stringify(sarif.version));
  const resultCount = (sarif.runs ?? []).reduce((total, run) => total + (run.results ?? []).length, 0);
  if (resultCount < 1) fail("expected at least one SARIF result, got none");
  console.log("test-pack: SARIF 2.1.0 with " + resultCount + " result(s)");
' "$sarif_file" || fail_stage "SARIF output check failed"

begin_stage "import installed library entry"
(cd "$consumer_dir" && node --input-type=module -e '
  const library = await import("domain-integrity");
  const missing = ["defineDomain", "lifecycle", "saga", "suppress"].filter((name) => typeof library[name] !== "function");
  if (missing.length > 0) {
    console.error("missing exports: " + missing.join(", "));
    process.exit(1);
  }
') || fail_stage "the installed library entry does not load with its exports"

begin_stage "require installed library entry from CommonJS"
(cd "$consumer_dir" && node --input-type=commonjs -e '
  const library = require("domain-integrity");
  const missing = ["defineDomain", "lifecycle", "saga", "suppress"].filter((name) => typeof library[name] !== "function");
  if (missing.length > 0) {
    console.error("missing exports: " + missing.join(", "));
    process.exit(1);
  }
') || fail_stage "the installed library entry does not load through require"

begin_stage "typecheck domain.config.ts against installed types"
(cd "$consumer_dir" && "$repo_bin/tsc" --ignoreConfig --noEmit --strict --module ESNext --moduleResolution Bundler --target ES2022 domain.config.ts)

current_stage="done"
echo "test-pack: ok"
