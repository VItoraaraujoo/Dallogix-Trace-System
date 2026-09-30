#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
test_dir="$(mktemp -d)"
trap 'rm -rf -- "$test_dir"' EXIT

git init --bare --initial-branch=master --quiet "$test_dir/origin.git"
git init --initial-branch=master --quiet "$test_dir/source"
git -C "$test_dir/source" config user.name 'Trace regression test'
git -C "$test_dir/source" config user.email 'trace-test@example.invalid'
mkdir -p "$test_dir/source/scripts"
cp "$root_dir/scripts/sync_github.sh" "$test_dir/source/scripts/"
printf 'services: {}\n' > "$test_dir/source/docker-compose.yml"
git -C "$test_dir/source" add .
git -C "$test_dir/source" commit --quiet -m 'initial fixture'
initial="$(git -C "$test_dir/source" rev-parse HEAD)"
git -C "$test_dir/source" branch codex-fixture
git -C "$test_dir/source" remote add origin "$test_dir/origin.git"
git -C "$test_dir/source" push --quiet origin master codex-fixture
git clone --quiet --branch codex-fixture --single-branch "$test_dir/origin.git" "$test_dir/restricted"
git -C "$test_dir/restricted" update-ref refs/remotes/origin/master "$initial"
git clone --quiet "$test_dir/origin.git" "$test_dir/standard"

printf 'new release\n' > "$test_dir/source/new-release.txt"
git -C "$test_dir/source" add new-release.txt
git -C "$test_dir/source" commit --quiet -m 'advance master fixture'
latest="$(git -C "$test_dir/source" rev-parse HEAD)"
git -C "$test_dir/source" push --quiet origin master

for checkout in restricted standard; do
  output="$(TRACE_GITHUB_DRY_RUN=1 bash "$test_dir/$checkout/scripts/sync_github.sh")"
  expected="Simulação: servidor avançaria de $initial para $latest."
  if [[ "$output" != "$expected" ]]; then
    printf 'FAIL: %s clone returned %s; expected %s\n' "$checkout" "$output" "$expected" >&2
    exit 1
  fi
  [[ "$(git -C "$test_dir/$checkout" rev-parse origin/master)" == "$latest" ]]
  [[ "$(git -C "$test_dir/$checkout" rev-parse HEAD)" == "$initial" ]]
  [[ -z "$(git -C "$test_dir/$checkout" status --porcelain)" ]]
done

echo 'OK: sincronização consulta a master atual em clones completos e restritos, sem alterar a instalação no dry-run.'
