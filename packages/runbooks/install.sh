#!/usr/bin/env bash
# install.sh — Install runbooks slash commands and subagents into a Claude Code config dir.
#
# Slash commands are an *optional* on-ramp to the runbooks procedures. The books
# in books/ are the source of truth; the files in commands/ are thin wrappers
# that resolve the runbooks repo path and delegate to the corresponding book.
# Books work without any install — agents read them directly. Install commands
# only if you want `/clickup-epic-create` (etc.) to work from any project.
#
# Subagents in agents/ are the named worker definitions some commands dispatch
# (e.g. /work-on-clickup's gp-coder + reviewer panel). They install into the
# Claude Code agents/ dir the same way commands do, and resolve by name once the
# session is restarted.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: install.sh [symlink|copy] [user|project] [--force] [-h|--help]

  symlink   (default) Symlink each command/agent into the destination — picks
            up updates automatically when the repo is bumped.
  copy      Copy each file. No auto-update.

  user      (default) Install into $CLAUDE_CONFIG_DIR if set, else ~/.claude.
            Commands → <dir>/commands, agents → <dir>/agents. Available in
            every project for that profile.
  project   Install into ./.claude (current repo only): ./.claude/commands and
            ./.claude/agents.

  --force   Overwrite existing files even if they aren't symlinks managed by us.
  -h        Show this help.

Notes:
  Claude Code resolves slash commands and subagents from $CLAUDE_CONFIG_DIR when
  that env var is set (used by setups that run multiple Claude profiles via
  aliases like `CLAUDE_CONFIG_DIR=~/.claude-gp claude`). If your shell sets
  CLAUDE_CONFIG_DIR for the profile you intend to use, run this script under
  that same env so it installs into the right place.

  Restart your Claude Code session after install so new commands AND subagents
  are picked up — subagents only resolve by name after a restart.

  After install, set $RUNBOOKS_DIR in your shell profile so the slash commands
  can find this repo from any working directory. The exact line to add (with
  this repo's absolute path baked in) is printed at the end of install. It
  looks like:

    export RUNBOOKS_DIR="/absolute/path/to/runbooks"

  Do NOT use a $(dirname "${BASH_SOURCE[0]}") trick in your shell profile —
  inside ~/.zshrc or ~/.bashrc that resolves to the profile's own directory
  (typically $HOME), not this repo.

Examples:
  ./install.sh                        # symlink, user-level (honors CLAUDE_CONFIG_DIR)
  ./install.sh copy                   # copy, user-level
  ./install.sh symlink project        # symlink into ./.claude/{commands,agents}
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

if [ ! -d "$REPO_ROOT/commands" ] || ! ls "$REPO_ROOT/commands"/*.md >/dev/null 2>&1; then
  echo "No command files found in $REPO_ROOT/commands" >&2
  exit 1
fi

install_dir commands commands
install_dir agents agents

echo "Done. linked=$linked copied=$copied skipped=$skipped clobbered=$clobbered  (dest: $DEST_ROOT)"
echo
echo "Available commands:"
for f in "$REPO_ROOT/commands"/*.md; do
  printf '  /%s\n' "$(basename "$f" .md)"
done
if [ -d "$REPO_ROOT/agents" ] && ls "$REPO_ROOT/agents"/*.md >/dev/null 2>&1; then
  echo
  echo "Available subagents (dispatched by name from commands):"
  for f in "$REPO_ROOT/agents"/*.md; do
    printf '  %s\n' "$(basename "$f" .md)"
  done
fi
echo
echo "Add this to your shell profile so the commands can find this repo:"
echo "  export RUNBOOKS_DIR=\"$REPO_ROOT\""
echo
echo "Then in a new shell, ensure your other env is set:"
echo "  CLICKUP_API_KEY in scripts/.env  (secrets — never commit)"
echo "  CLICKUP_TEAM_ID, CLICKUP_LIST_ID in books/.env  (non-secrets)"
echo
echo "Restart your Claude Code session to pick up the new commands and subagents."
