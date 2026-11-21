#!/usr/bin/env bash
# The path-matched floor for the PR judge guard (judge-guard.yml).
#
# Reads `git diff --name-status -M` lines on stdin (status, then one path, or
# two for a rename: old then new). Prints a comma-separated, de-duplicated list
# of the suites the diff reaches, in first-touched order; empty when none.
#
# A suite is a `packages/gp-api/src/**/<suite>.eval.ts` file. It is reached
# when the diff touches that file or any path under that file's directory. The
# eval files are those on main plus the diff's own additions and renames, minus
# its deletions, so a renamed file reaches the suite under its new name and a
# deleted one reaches nothing.
#
# `--eval-files` prints the eval files at the PR head instead, one per line.
# JUDGE_MAIN_EVAL_FILES (newline-separated) replaces `git ls-files` for tests.
set -euo pipefail

if [ -n "${JUDGE_MAIN_EVAL_FILES+x}" ]; then
  main_files="$JUDGE_MAIN_EVAL_FILES"
else
  main_files="$(git ls-files 'packages/gp-api/src/*.eval.ts')"
fi

is_eval() { case "$1" in packages/gp-api/src/*.eval.ts) return 0 ;; *) return 1 ;; esac; }

diff_lines="$(cat)"
head_files="$main_files"
reached_paths=""

while IFS=$'\t' read -r status first second; do
  [ -n "${status:-}" ] || continue
  case "$status" in
    D)
      if is_eval "$first"; then
        head_files="$(printf '%s\n' "$head_files" | grep -vFx -- "$first" || true)"
      else
        reached_paths="${reached_paths}${first}"$'\n'
      fi
      ;;
    R* | C*)
      if [ "${status:0:1}" = R ]; then
        head_files="$(printf '%s\n' "$head_files" | grep -vFx -- "$first" || true)"
        is_eval "$first" || reached_paths="${reached_paths}${first}"$'\n'
      fi
      if is_eval "$second"; then
        head_files="${head_files}"$'\n'"${second}"
      fi
      reached_paths="${reached_paths}${second}"$'\n'
      ;;
    *)
      if is_eval "$first"; then
        head_files="${head_files}"$'\n'"${first}"
      fi
      reached_paths="${reached_paths}${first}"$'\n'
      ;;
  esac
done <<< "$diff_lines"

head_files="$(printf '%s\n' "$head_files" | sed '/^$/d' | sort -u)"

if [ "${1:-}" = "--eval-files" ]; then
  printf '%s\n' "$head_files"
  exit 0
fi

touched=""
while IFS= read -r path; do
  [ -n "$path" ] || continue
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    dir="${file%/*}/"
    case "$path" in
      "$file" | "$dir"*)
        stem="${file##*/}"
        stem="${stem%.eval.ts}"
        case ",$touched," in *",$stem,"*) ;; *) touched="${touched:+$touched,}$stem" ;; esac
        ;;
    esac
  done <<< "$head_files"
done <<< "$reached_paths"

printf '%s' "$touched"
