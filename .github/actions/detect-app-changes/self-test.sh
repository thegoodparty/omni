#!/usr/bin/env bash
# Fixture test for classify.sh and changed-paths.sh. The `changes` job runs it
# before classifying the real pull request, so a classifier that has been
# broken by an edit fails the run instead of quietly skipping CI.
#
# The failure this guards against is a false "no app code": every fixture that
# must run the full pipeline is listed, and the git cases cover the ways a
# correct path list could still come out wrong (renames, the base moving, the
# wrong commit checked out).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
classify="$here/classify.sh"
changed_paths="$here/changed-paths.sh"
failures=0

expect() {
  local want="$1" label="$2" got
  shift 2
  if [ "$#" -eq 0 ]; then
    got="$(printf '' | bash "$classify")"
  else
    got="$(printf '%s\0' "$@" | bash "$classify")"
  fi
  if [ "$got" = "$want" ]; then
    echo "ok   app=$got  $label"
  else
    echo "FAIL app=$got (want $want)  $label"
    failures=$((failures + 1))
  fi
}

app() { expect true "$1" "$1"; }
no_app() { expect false "$1" "$1"; }

app packages/gp-api/src/x.ts
app packages/gp-webapp/app/x.tsx
app packages/contracts/src/x.ts
app package-lock.json
app package.json
app .nvmrc
app tsconfig.base.json
app patches/x.patch
app .github/actions/setup-node-workspace/action.yml
app .github/workflows/gp-api.yml
app packages/runbooks/experiments/x/manifest.json
app packages/gp-ai/infrastructure/x.tf
app packages/candidate-sites/app/x.tsx
app packages/gp-api/AGENTS.md
app packages/gp-api/CLAUDE.md
app scripts/x.sh
app ai-rules
app brand-new-dir/x.ts
app docs
app packages/gp-admin
app packages/gp-administrator/x.ts
expect true 'docs + app file' docs/x.md packages/gp-api/src/x.ts
expect true 'app file + docs' packages/gp-api/src/x.ts docs/x.md
expect true 'empty list'
expect true 'empty path' ''

no_app docs/x.md
no_app docs/a/b/c.png
no_app .claude/skills/x/SKILL.md
no_app README.md
no_app AGENTS.md
no_app CLAUDE.md
no_app .mcp.json
no_app packages/gp-admin/src/x.tsx
no_app packages/prototypes/app/x.tsx
expect false 'several no-app paths' docs/x.md .claude/settings.json README.md packages/gp-admin/package.json

# changed-paths.sh against a scratch repository. Hermetic git config, so a
# developer's signing or hook settings cannot change the result.
repo="$(mktemp -d)"
trap 'rm -rf "$repo"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=self-test GIT_AUTHOR_EMAIL=self-test@example.com
export GIT_COMMITTER_NAME=self-test GIT_COMMITTER_EMAIL=self-test@example.com

g() { git -C "$repo" "$@"; }
put() {
  mkdir -p "$(dirname "$repo/$1")"
  echo "$2" >"$repo/$1"
}

g init -q -b main
put packages/gp-api/x.ts base
put README.md base
g add -A
g commit -q -m base
base="$(g rev-parse HEAD)"

g checkout -q -b rename "$base"
mkdir -p "$repo/docs"
g mv packages/gp-api/x.ts docs/x.ts
g commit -q -m 'move app file into docs'

g checkout -q -b docs-only "$base"
put docs/y.md docs
g add -A
g commit -q -m docs

g checkout -q -b app-then-docs "$base"
put packages/gp-api/x.ts changed
g add -A
g commit -q -m app
put docs/z.md docs
g add -A
g commit -q -m docs

# main moves after the branches fork, so a diff against the merge base instead
# of HEAD^1 would wrongly include main's own app change.
g checkout -q main
put packages/gp-webapp/z.ts main
g add -A
g commit -q -m 'main moves on'
main_tip="$(g rev-parse HEAD)"

expect_merge() {
  local want="$1" branch="$2" head merge got
  head="$(g rev-parse "$branch")"
  g checkout -q --detach "$main_tip"
  g merge -q --no-ff -m "merge $branch" "$branch"
  merge="$(g rev-parse HEAD)"
  got="$(cd "$repo" && bash "$changed_paths" "$merge" "$head" | bash "$classify")" || got=error
  if [ "$got" = "$want" ]; then
    echo "ok   app=$got  merge of $branch"
  else
    echo "FAIL app=$got (want $want)  merge of $branch"
    failures=$((failures + 1))
  fi
}

expect_refused() {
  local label="$1"
  shift
  if (cd "$repo" && bash "$changed_paths" "$@" >/dev/null 2>&1); then
    echo "FAIL changed-paths accepted: $label"
    failures=$((failures + 1))
  else
    echo "ok   refused  $label"
  fi
}

expect_merge true rename
expect_merge false docs-only
expect_merge true app-then-docs

app_then_docs="$(g rev-parse app-then-docs)"
g checkout -q --detach "$app_then_docs"
expect_refused 'branch head checked out instead of the merge commit' "$app_then_docs" "$app_then_docs"
expect_merge false docs-only
merge="$(g rev-parse HEAD)"
expect_refused 'second parent is not the PR head' "$merge" "$app_then_docs"
expect_refused 'HEAD is not the expected merge commit' "$main_tip" "$(g rev-parse docs-only)"
expect_refused 'missing SHAs' '' ''

if [ "$failures" -ne 0 ]; then
  echo "::error::detect-app-changes self-test: $failures failure(s)"
  exit 1
fi
echo "detect-app-changes self-test passed"
