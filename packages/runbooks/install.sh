#!/usr/bin/env bash
# install.sh — Install the runbooks subagents into a Claude Code config dir.
#
# The runbooks procedures that used to install here as slash commands are omni
# skills now (.claude/skills/<name>/), which Claude Code and gp-pi both load
# from the checkout, so nothing about them needs installing. Re-running this
# removes the command symlinks earlier versions left behind.
#
# Subagents in agents/ are the named worker definitions some of those skills
# dispatch (e.g. /work-on-clickup's gp-reviewer and gp-ui-tester). They resolve
# by name once the session is restarted.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: install.sh [symlink|copy] [user|project] [--force] [-h|--help]

  symlink   (default) Symlink each agent into the destination — picks up
            updates automatically when the repo is bumped.
  copy      Copy each file. No auto-update.

  user      (default) Install into $CLAUDE_CONFIG_DIR if set, else ~/.claude.
            Agents → <dir>/agents. Available in every project for that
            profile.
  project   Install into ./.claude/agents (current repo only).

  --force   Overwrite existing files even if they aren't symlinks managed by us.
  -h        Show this help.

Notes:
  Claude Code resolves subagents from $CLAUDE_CONFIG_DIR when
  that env var is set (used by setups that run multiple Claude profiles via
  aliases like `CLAUDE_CONFIG_DIR=~/.claude-gp claude`). If your shell sets
  CLAUDE_CONFIG_DIR for the profile you intend to use, run this script under
  that same env so it installs into the right place.

  Restart your Claude Code session after install — subagents only resolve by
  name after a restart.

Examples:
  ./install.sh                        # symlink, user-level (honors CLAUDE_CONFIG_DIR)
  ./install.sh copy                   # copy, user-level
  ./install.sh symlink project        # symlink into ./.claude/agents
  CLAUDE_CONFIG_DIR=~/.claude-gp ./install.sh   # explicit profile
EOF
}

MODE="symlink"
SCOPE="user"
FORCE=0

for arg in "$@"; do
  case "$arg" in
    -h|--help)        usage; exit 0 ;;
    --force)          FORCE=1 ;;
    symlink|copy)     MODE="$arg" ;;
    user|project)     SCOPE="$arg" ;;
    *)                echo "Unknown argument: $arg" >&2; usage >&2; exit 1 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$SCOPE" in
  user)    DEST_ROOT="${CLAUDE_CONFIG_DIR:-$HOME/.claude}" ;;
  project) DEST_ROOT="$(pwd)/.claude" ;;
esac

linked=0
copied=0
skipped=0
clobbered=0

# install_dir <src-subdir> <dest-subdir> — install every *.md from
# $REPO_ROOT/<src-subdir> into $DEST_ROOT/<dest-subdir>, honoring MODE/FORCE.
# Updates the global counters. No-ops if the source dir has no *.md.
install_dir() {
  local subdir="$1" dest_sub="$2"
  local src="$REPO_ROOT/$subdir"
  local dest="$DEST_ROOT/$dest_sub"

  if [ ! -d "$src" ] || ! ls "$src"/*.md >/dev/null 2>&1; then
    return 0
  fi

  mkdir -p "$dest"
  echo "Installing $subdir/ -> $dest"

  local f name target current
  for f in "$src"/*.md; do
    name="$(basename "$f")"
    target="$dest/$name"

    if [ -L "$target" ]; then
      current="$(readlink "$target")"
      if [ "$current" = "$f" ]; then
        # Already pointing at this exact source — fast path.
        if [ "$MODE" = "symlink" ]; then
          printf '  ok      %s (already linked)\n' "$name"
          skipped=$((skipped + 1)); continue
        fi
        # MODE=copy: replace the self-symlink with a real file copy.
        rm "$target"
      elif [ "$FORCE" -eq 0 ]; then
        printf '  WARN    %s is a symlink to %s — skipping. Re-run with --force to replace.\n' "$name" "$current" >&2
        skipped=$((skipped + 1)); continue
      else
        rm "$target"
        clobbered=$((clobbered + 1))
      fi
    elif [ -e "$target" ]; then
      if [ "$FORCE" -eq 0 ]; then
        printf '  WARN    %s exists and is not managed by this script — skipping. Re-run with --force to overwrite.\n' "$name" >&2
        skipped=$((skipped + 1)); continue
      fi
      rm "$target"
      clobbered=$((clobbered + 1))
    fi

    case "$MODE" in
      symlink) ln -s "$f" "$target"; printf '  linked  %-32s -> %s\n' "$name" "$f"; linked=$((linked + 1)) ;;
      copy)    cp    "$f" "$target"; printf '  copied  %s\n' "$name"; copied=$((copied + 1)) ;;
    esac
  done
  echo
}

# Earlier versions symlinked commands/*.md into <dest>/commands; those files are
# skills now, and a leftover link would dangle or shadow the skill's name.
removed=0
if [ -d "$DEST_ROOT/commands" ]; then
  for link in "$DEST_ROOT/commands"/*.md; do
    [ -L "$link" ] || continue
    case "$(readlink "$link")" in
      "$REPO_ROOT/commands/"*)
        rm "$link"
        printf '  removed %s (now a skill)
' "$(basename "$link")"
        removed=$((removed + 1))
        ;;
    esac
  done
fi

install_dir agents agents

echo "Done. linked=$linked copied=$copied skipped=$skipped clobbered=$clobbered removed=$removed  (dest: $DEST_ROOT)"
echo
echo "Available subagents (dispatched by name from the runbooks skills):"
for f in "$REPO_ROOT/agents"/*.md; do
  printf '  %s
' "$(basename "$f" .md)"
done
echo
echo "The ClickUp skills read CLICKUP_API_KEY from scripts/.env (secrets, never"
echo "commit) and CLICKUP_TEAM_ID, CLICKUP_LIST_ID from books/.env."
echo
echo "Restart your Claude Code session to pick up the subagents."
