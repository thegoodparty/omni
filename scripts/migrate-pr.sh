#!/usr/bin/env bash
#
# migrate-pr.sh — recreate an open PR from a source repo as a branch in omni,
# preserving the original commit authorship.
#
# Usage:
#   bash scripts/migrate-pr.sh <name> <pr-number|branch> [base-branch]
#
# Examples:
#   bash scripts/migrate-pr.sh gp-api 4871
#   bash scripts/migrate-pr.sh gp-webapp ENG-5044
#
# What it does:
#   1. Clones the source repo and rewrites history under the repo's omni prefix.
#   2. Cherry-picks ONLY the PR's commits (merge-base(base, pr)..pr) onto a fresh
#      branch off omni/develop. Cherry-pick keeps the original AUTHOR (the
#      committer becomes whoever runs this; GitHub attributes by author email).
#   3. Prints the exact `git push` + `gh pr create` commands to finish — so the
#      PR opener is the human dev, not automation.
#
# Note: assumes a (mostly) linear PR branch. If the branch contains merge
# commits, rebase it in the source repo first, then re-run.
set -euo pipefail

NAME="${1:?usage: migrate-pr.sh <name> <pr-number|branch> [base-branch]}"
PR="${2:?missing <pr-number|branch>}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT/scripts/repos.manifest"

# Look up repo in the manifest.
read -r M_NAME M_URL M_BRANCH M_PREFIX < <(awk -v n="$NAME" '$1==n{print; exit}' "$MANIFEST")
if [ -z "${M_URL:-}" ]; then
  echo "ERROR: '$NAME' not found in $MANIFEST" >&2; exit 1
fi
BASE_BRANCH="${3:-$M_BRANCH}"

# locate git-filter-repo
if ! git filter-repo --version >/dev/null 2>&1; then
  for p in "$HOME/Library/Python/3.9/bin" "$HOME/.local/bin" /usr/local/bin /opt/homebrew/bin; do
    [ -x "$p/git-filter-repo" ] && export PATH="$p:$PATH" && break
  done
fi
git filter-repo --version >/dev/null 2>&1 || { echo "ERROR: git-filter-repo not found" >&2; exit 1; }

CACHE="$ROOT/.sync-cache/_pr_$NAME"
rm -rf "$CACHE"; mkdir -p "$(dirname "$CACHE")"

echo "==> cloning $M_URL"
git clone --quiet --no-tags "$M_URL" "$CACHE"

# Materialize base + PR as local branches so they survive the rewrite.
git -C "$CACHE" branch base "origin/$BASE_BRANCH"
if [[ "$PR" =~ ^[0-9]+$ ]]; then
  git -C "$CACHE" fetch --quiet origin "refs/pull/$PR/head:pr"
  PR_LABEL="pr-$PR"
else
  git -C "$CACHE" branch pr "origin/$PR"
  PR_LABEL="$PR"
fi

echo "==> rewriting history under $M_PREFIX/"
git -C "$CACHE" filter-repo --quiet --force --refs base pr --to-subdirectory-filter "$M_PREFIX"

MB="$(git -C "$CACHE" merge-base base pr)"
PR_HEAD="$(git -C "$CACHE" rev-parse pr)"
COUNT="$(git -C "$CACHE" rev-list --count "$MB..$PR_HEAD")"
echo "==> $COUNT commit(s) to migrate"

TARGET_BRANCH="migrate/$NAME/$PR_LABEL"
git -C "$ROOT" rev-parse --verify "develop" >/dev/null 2>&1 || { echo "ERROR: omni has no develop branch yet" >&2; exit 1; }
git -C "$ROOT" checkout -B "$TARGET_BRANCH" develop

REMOTE="_pr_${NAME}"
git -C "$ROOT" remote remove "$REMOTE" 2>/dev/null || true
git -C "$ROOT" remote add "$REMOTE" "$CACHE"
git -C "$ROOT" fetch --quiet "$REMOTE" pr

echo "==> cherry-picking $MB..$PR_HEAD onto $TARGET_BRANCH"
if ! git -C "$ROOT" cherry-pick "$MB..$PR_HEAD"; then
  echo "" >&2
  echo "Cherry-pick hit a conflict. Resolve it, then:" >&2
  echo "  git cherry-pick --continue   (repeat until done)" >&2
  echo "Then push and open the PR (see below)." >&2
fi

git -C "$ROOT" remote remove "$REMOTE" 2>/dev/null || true
rm -rf "$CACHE"

cat <<EOF

============================================================
Branch '$TARGET_BRANCH' created with the migrated commits.
Original authorship is preserved on each commit.

To finish (run as the PR author so you are the opener):
  git -C "$ROOT" push -u origin "$TARGET_BRANCH"
  gh pr create --repo thegoodparty/omni --base develop --head "$TARGET_BRANCH" \\
    --title "<original PR title>" --body "Migrated from thegoodparty/$NAME PR $PR"
============================================================
EOF
