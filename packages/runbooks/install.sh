#!/usr/bin/env bash
# install.sh — Install runbooks slash commands into a Claude Code commands dir.
#
# Slash commands are an *optional* on-ramp to the runbooks procedures. The books
# in books/ are the source of truth; the files in commands/ are thin wrappers
# that resolve the runbooks repo path and delegate to the corresponding book.
# Books work without any install — agents read them directly. Install commands
# only if you want `/clickup-epic-create` (etc.) to work from any project.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: install.sh [symlink|copy] [user|project] [--force] [-h|--help]

  symlink   (default) Symlink each command into the destination — picks up
            updates automatically when the repo is bumped.
  copy      Copy each command. No auto-update.

  user      (default) Install into $CLAUDE_CONFIG_DIR/commands if set, else
            ~/.claude/commands. Available in every project for that profile.
  project   Install into ./.claude/commands (current repo only).

  --force   Overwrite existing files even if they aren't symlinks managed by us.
  -h        Show this help.

Notes:
  Claude Code resolves slash commands from $CLAUDE_CONFIG_DIR/commands when
  that env var is set (used by setups that run multiple Claude profiles via
  aliases like `CLAUDE_CONFIG_DIR=~/.claude-gp claude`). If your shell sets
  CLAUDE_CONFIG_DIR for the profile you intend to use, run this script under
  that same env so it installs into the right place.

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
  ./install.sh symlink project        # symlink into ./.claude/commands
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
SRC="$REPO_ROOT/commands"

case "$SCOPE" in
  user)    DEST="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/commands" ;;
  project) DEST="$(pwd)/.claude/commands" ;;
esac

if [ ! -d "$SRC" ] || ! ls "$SRC"/*.md >/dev/null 2>&1; then
  echo "No command files found in $SRC" >&2
  exit 1
fi

mkdir -p "$DEST"

linked=0
copied=0
skipped=0
clobbered=0

for f in "$SRC"/*.md; do
  name="$(basename "$f")"
  target="$DEST/$name"

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
echo "Done. linked=$linked copied=$copied skipped=$skipped clobbered=$clobbered  (dest: $DEST)"
echo
echo "Available commands:"
for f in "$SRC"/*.md; do
  printf '  /%s\n' "$(basename "$f" .md)"
done
echo
echo "Add this to your shell profile so the commands can find this repo:"
echo "  export RUNBOOKS_DIR=\"$REPO_ROOT\""
echo
echo "Then in a new shell, ensure your other env is set:"
echo "  CLICKUP_API_KEY in scripts/.env  (secrets — never commit)"
echo "  CLICKUP_TEAM_ID, CLICKUP_LIST_ID in books/.env  (non-secrets)"
echo
echo "Restart your Claude Code session to pick up the new commands."
