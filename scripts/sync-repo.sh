#!/usr/bin/env bash
#
# sync-repo.sh — import (or re-sync) a single source repo into omni under a
# subdirectory, preserving full git history.
#
# Usage:
#   bash scripts/sync-repo.sh <name> <git-url> <source-branch> <prefix>
#
# Mechanism:
#   1. Fresh-clone the source branch into .sync-cache/<name> (filter-repo needs
#      a clean clone; fresh clone each run keeps rewrites deterministic).
#   2. git filter-repo --to-subdirectory-filter <prefix>  (rewrites every commit
#      so its tree lives under <prefix>/ — authorship/dates preserved).
#   3. Merge the rewritten history into omni's current branch. First time uses
#      --allow-unrelated-histories; later runs bring only new commits.
#
# Re-runnable: because filter-repo is deterministic and we never edit <prefix>/**
# inside omni during the sync phase, every re-run is a clean merge.
#
# Requires: git-filter-repo (pinned 2.47.0). Override with FILTER_REPO_BIN.
set -euo pipefail

NAME="${1:?usage: sync-repo.sh <name> <git-url> <branch> <prefix>}"
URL="${2:?missing git-url}"
BRANCH="${3:?missing source-branch}"
PREFIX="${4:?missing prefix}"

# Resolve omni repo root (this script lives in <root>/scripts).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="$ROOT/.sync-cache/$NAME"

# --- locate git-filter-repo (not always on PATH on macOS) ---
if [ -n "${FILTER_REPO_BIN:-}" ]; then
  export PATH="$(dirname "$FILTER_REPO_BIN"):$PATH"
fi
if ! git filter-repo --version >/dev/null 2>&1; then
  for p in "$HOME/Library/Python/3.9/bin" "$HOME/.local/bin" /usr/local/bin /opt/homebrew/bin; do
    if [ -x "$p/git-filter-repo" ]; then export PATH="$p:$PATH"; break; fi
  done
fi
if ! git filter-repo --version >/dev/null 2>&1; then
  echo "ERROR: git-filter-repo not found. Install with: pip3 install --user git-filter-repo==2.47.0" >&2
  exit 1
fi

echo "==> [$NAME] syncing $URL ($BRANCH) -> $PREFIX"

# --- 1. fresh clone of the single source branch ---
rm -rf "$CACHE"
mkdir -p "$(dirname "$CACHE")"
git clone --quiet --single-branch --branch "$BRANCH" --no-tags "$URL" "$CACHE"

# --- 2. strip the per-repo `ai-rules` submodule + .gitmodules ---
# Every source repo vendors the same `ai-rules` submodule. Carrying those gitlinks
# into omni leaves stray mode-160000 entries with no valid root .gitmodules, which
# breaks `actions/checkout`. We drop them during the rewrite (the monorepo gets a
# single root `ai-rules` submodule at cutover). Harmless for repos lacking them.
git -C "$CACHE" filter-repo --quiet --force --invert-paths --path ai-rules --path .gitmodules

# --- 3. rewrite history under <prefix>/ ---
git -C "$CACHE" filter-repo --quiet --force --to-subdirectory-filter "$PREFIX"

# --- 3. merge rewritten history into omni's current branch ---
REMOTE="_sync_${NAME}"
git -C "$ROOT" remote remove "$REMOTE" 2>/dev/null || true
git -C "$ROOT" remote add "$REMOTE" "$CACHE"
git -C "$ROOT" fetch --quiet "$REMOTE" "$BRANCH"

BEFORE="$(git -C "$ROOT" rev-parse HEAD)"
git -C "$ROOT" merge --allow-unrelated-histories --no-edit \
  -m "sync($NAME): merge $BRANCH into $(git -C "$ROOT" rev-parse --abbrev-ref HEAD)" \
  FETCH_HEAD
AFTER="$(git -C "$ROOT" rev-parse HEAD)"

git -C "$ROOT" remote remove "$REMOTE" 2>/dev/null || true
rm -rf "$CACHE"

if [ "$BEFORE" = "$AFTER" ]; then
  echo "==> [$NAME] already up to date (no new commits)."
else
  echo "==> [$NAME] merged. HEAD $BEFORE -> $AFTER"
fi
