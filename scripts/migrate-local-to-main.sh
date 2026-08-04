#!/usr/bin/env bash
#
# Migrate a local omni clone from the old default branch `develop` to `main`.
#
# Run this once per clone AFTER the `develop -> main` rename has landed on the
# remote. It is safe to run more than once. It never force-pushes and never
# touches your feature branches.
#
#   bash scripts/migrate-local-to-main.sh
#
# What it does:
#   - fetches and prunes (drops the deleted origin/develop ref)
#   - repoints origin/HEAD to main
#   - creates/updates a local `main` tracking origin/main
#   - if THIS worktree is sitting on develop, moves it to main
#   - deletes the stale local develop branch (only if fully merged into main)
#   - reports any OTHER worktrees still on develop for you to move by hand
#
set -euo pipefail

OLD=develop
NEW=main
REMOTE=origin

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "error: not inside a git repository" >&2
  exit 1
fi

echo "==> Fetching $REMOTE (with prune)"
git fetch "$REMOTE" --prune

if ! git show-ref --verify --quiet "refs/remotes/$REMOTE/$NEW"; then
  echo "error: $REMOTE/$NEW does not exist yet. Has the develop -> main rename landed?" >&2
  exit 1
fi

echo "==> Repointing $REMOTE/HEAD to $NEW"
git remote set-head "$REMOTE" -a >/dev/null 2>&1 || true

echo "==> Ensuring local $NEW tracks $REMOTE/$NEW"
if git show-ref --verify --quiet "refs/heads/$NEW"; then
  git branch --set-upstream-to="$REMOTE/$NEW" "$NEW" >/dev/null 2>&1 || true
else
  git branch --track "$NEW" "$REMOTE/$NEW"
fi

current=$(git rev-parse --abbrev-ref HEAD)
if [ "$current" = "$OLD" ]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "!! This worktree is on $OLD with uncommitted changes."
    echo "   Commit or stash them, then re-run. Not switching automatically."
  elif git switch "$NEW" 2>/dev/null; then
    echo "==> Switched this worktree from $OLD to $NEW"
  else
    echo "!! Could not switch to $NEW here ($NEW may be checked out in another worktree)."
    echo "   Move this worktree to a feature branch or remove it, then re-run."
  fi
fi

if git show-ref --verify --quiet "refs/heads/$OLD"; then
  if git branch --merged "$NEW" | tr -d ' *' | grep -qx "$OLD"; then
    git branch -d "$OLD" >/dev/null && echo "==> Deleted stale local $OLD (was fully merged into $NEW)"
  else
    echo "!! Local $OLD has commits not on $NEW; leaving it in place."
    echo "   Inspect with: git log $NEW..$OLD"
  fi
fi

# Report any other worktrees still parked on develop. Only one worktree can hold
# main, so these have to be moved by hand.
stragglers=$(git worktree list --porcelain \
  | awk -v old="refs/heads/$OLD" '
      /^worktree /   { wt=$2 }
      $0=="branch " old { print wt }')
if [ -n "$stragglers" ]; then
  echo ""
  echo "!! These worktrees are still on $OLD and need manual attention:"
  while IFS= read -r wt; do
    echo "   - $wt"
  done <<< "$stragglers"
  echo "   In each: switch to its feature branch (git switch <branch>) or remove the worktree."
fi

echo ""
echo "Done. Default branch is now $NEW."
