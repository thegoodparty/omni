#!/usr/bin/env bash
#
# worktree-setup.sh — provision a fresh git worktree so package tests and
# builds pass without touching the main checkout.
#
# Usage: run from anywhere inside the worktree (or pass its path):
#   scripts/worktree-setup.sh [worktree-path]
#
# What it does, and why each step exists:
#   1. Copies untracked .env* files from the main checkout (tracked ones —
#      .env.test, .env.example — arrive via git; symlinking them breaks
#      `git status` with typechange noise, so nothing is ever symlinked).
#   2. npm ci --prefer-offline — node_modules symlinks are NOT safe: stale
#      dist/ from workspace-internal packages (contracts, nest-common)
#      surfaces as hundreds of phantom lint/type errors.
#   3. Builds the workspace-internal packages consumers resolve from dist/.
#   4. Regenerates every backend's Prisma client (plus gp-api route types) —
#      generated clients live in gitignored src/generated/ dirs, so a fresh
#      worktree has none of them.
set -euo pipefail

WT="$(cd "${1:-.}" && git rev-parse --show-toplevel)"
MAIN="$(git -C "$WT" worktree list --porcelain | head -1 | sed 's/^worktree //')"

if [ "$WT" = "$MAIN" ]; then
  echo "==> $WT is the main checkout; skipping env copy"
else
  echo "==> Copying untracked .env files from $MAIN"
  for dir in "$MAIN" "$MAIN"/packages/*; do
    [ -d "$dir" ] || continue
    for src in "$dir"/.env "$dir"/.env.*; do
      [ -f "$src" ] || continue
      rel="${src#"$MAIN"/}"
      if git -C "$MAIN" ls-files --error-unmatch "$rel" >/dev/null 2>&1; then
        continue
      fi
      if [ -e "$WT/$rel" ]; then
        echo "    keep  $rel (already present)"
      else
        cp "$src" "$WT/$rel"
        echo "    copy  $rel"
      fi
    done
  done
fi

cd "$WT"

echo "==> npm ci --prefer-offline"
npm ci --prefer-offline

echo "==> Building workspace-internal packages"
npm run build -w packages/contracts
npm run build -w packages/nest-common

echo "==> Regenerating Prisma clients"
npm run generate -w packages/gp-api
npm run generate -w packages/people-api
npm run generate -w packages/election-api

echo "==> Worktree ready: $WT"
