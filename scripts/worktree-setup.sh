#!/usr/bin/env bash
#
# worktree-setup.sh — provision a fresh git worktree so package tests and
# builds pass without touching the main checkout.
#
# Usage: run from anywhere inside the worktree (or pass its path):
#   scripts/worktree-setup.sh [worktree-path]
#
# What it does, and why each step exists:
#   1. npm ci --prefer-offline — run ahead of the .env copy below (rather
#      than after, as it once was) so that step's --secrets-only fallback
#      has node_modules already in place to resolve `zod` through via
#      `npx tsx`; see setup.sh's own npm-ci comment for why that import
#      can't resolve on a genuinely fresh checkout. node_modules symlinks
#      are NOT safe either way: stale dist/ from workspace-internal packages
#      (contracts, nest-common) surfaces as hundreds of phantom lint/type
#      errors.
#   2. Copies untracked .env* files from the main checkout (tracked ones —
#      .env.test, .env.example — arrive via git; symlinking them breaks
#      `git status` with typechange noise, so nothing is ever symlinked).
#      If the main checkout has none to copy, falls back to
#      `scripts/setup.sh --secrets-only` — inherit, never create, but a
#      worktree that inherits nothing must not be reported "ready" anyway.
#   3. Builds the workspace-internal packages consumers resolve from dist/.
#   4. Regenerates every backend's Prisma client (plus gp-api route types) —
#      generated clients live in gitignored src/generated/ dirs, so a fresh
#      worktree has none of them.
set -euo pipefail

WT="$(cd "${1:-.}" && git rev-parse --show-toplevel)"
# The first `worktree ` line is the main checkout. sed must consume the whole
# stream: an early-exiting consumer (`head -1`) closes the pipe, git dies of
# SIGPIPE, and under `pipefail` that aborts this script before it provisions
# anything — silently, with exit 141.
MAIN="$(git -C "$WT" worktree list --porcelain | sed -n '1s/^worktree //p')"

if [ "$WT" = "$MAIN" ]; then
  # npm ci wipes node_modules — running it against the shared main checkout
  # would disrupt dev servers and other agent sessions using it.
  echo "==> $WT is the main checkout; nothing to provision. Run this from"
  echo "    inside a worktree."
  exit 0
fi

cd "$WT"

echo "==> npm ci --prefer-offline"
npm ci --prefer-offline

echo "==> Copying untracked .env files from $MAIN"
# `found` counts every eligible untracked env file in main — copied fresh
# OR already present here ("keep") — so a re-run against a provisioned
# worktree does not trip the fallback. Two-level glob: real gitignored env
# files live two deep (e.g. packages/gp-api/e2e-tests/.env).
copied=0
found=0
for dir in "$MAIN" "$MAIN"/packages/* "$MAIN"/packages/*/*; do
  [ -d "$dir" ] || continue
  for src in "$dir"/.env "$dir"/.env.*; do
    [ -f "$src" ] || continue
    rel="${src#"$MAIN"/}"
    if git -C "$MAIN" ls-files --error-unmatch "$rel" >/dev/null 2>&1; then
      continue
    fi
    found=$((found + 1))
    if [ -e "$WT/$rel" ]; then
      echo "    keep  $rel (already present)"
    else
      mkdir -p "$(dirname "$WT/$rel")" && cp "$src" "$WT/$rel"
      echo "    copy  $rel"
      copied=$((copied + 1))
    fi
  done
done

# Nothing found at all: the main checkout has no working .env of its own to
# inherit from (fresh machine, CI runner, cloud sandbox). Proceeding
# silently would provision a worktree that reports "ready" and then can't
# boot. Delegate to setup.sh's own secrets step instead — it either
# produces valid env files (skipping packages that are already valid here,
# same as this script does above) or fails loudly with its own actionable
# message (e.g. "no --from given"), and either way this script must not
# claim success it didn't earn. npm ci above guarantees the node_modules
# that fallback's `npx tsx` needs to resolve `zod` through.
if [ "$found" -eq 0 ]; then
  echo "==> No untracked .env files found in $MAIN; falling back to scripts/setup.sh --secrets-only"
  "$WT/scripts/setup.sh" --secrets-only
fi

echo "==> Building workspace-internal packages"
npm run build -w packages/contracts
npm run build -w packages/nest-common

echo "==> Regenerating Prisma clients"
npm run generate -w packages/gp-api
npm run generate -w packages/election-api

echo "==> Worktree ready: $WT"
