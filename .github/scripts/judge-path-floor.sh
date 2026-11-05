#!/usr/bin/env bash
# The path-matched floor for the Universal Judge guard (judge-guard.yml).
#
# MIRRORS, RATHER THAN SHARES, the `case "$path" in ... esac` table in
# .github/workflows/judge.yml's `plan` job, `Resolve the agent selection`
# step (the `auto` branch). That copy is entangled with judge.yml's own
# `explicit`/`all` handling and its `refuse()` comment-posting on a malformed
# selector or a reserved experiment-directory name — none of which the guard
# needs, since the guard never refuses a PR, it just asks "did this diff
# reach a known agent." Extracting a shared caller for both would mean
# threading that refusal plumbing through a function neither file fully
# wants, so this is a deliberate, tested mirror rather than a shared callee.
#
# KEEP THIS IN SYNC WITH JUDGE.YML'S TABLE. A path added to one and not the
# other is the drift ENG-11590 exists to avoid. judge.yml's own table carries
# a comment pointing back here, and judge-path-floor.self-test.sh diffs the
# two tables on every run so drift fails CI instead of going unnoticed.
#
# Reads newline-separated repo paths on stdin (the shape `gh pr diff
# --name-only` prints). Prints a comma-separated, de-duplicated list of
# matched agent ids to stdout, in first-touched order — empty when nothing
# matched.
set -euo pipefail

touched=""
add() { case ",$touched," in *",$1,"*) ;; *) touched="${touched:+$touched,}$1" ;; esac; }

while IFS= read -r path; do
  [ -n "$path" ] || continue
  case "$path" in
    # Chat agents. The directory name is kebab-case and the agent id is the
    # Prisma ChatScope value, and for campaign-manager the two do not match,
    # which is why this is a table and not a tr. Same five prefixes, same
    # ids, as judge.yml.
    packages/gp-api/src/chats/general/chief-of-staff/*)   add chief_of_staff ;;
    packages/gp-api/src/chats/general/campaign-manager/*) add campaign_assistant ;;
    packages/gp-api/src/chats/general/ordinance-flow/*)   add ordinance_flow ;;
    packages/gp-api/src/chats/general/priority-flow/*)    add priority_flow ;;
    packages/gp-api/src/chats/briefing-chats/*)           add briefing_annotation ;;
    # Background agents. One directory per published experiment, and the
    # directory name IS the agent id.
    packages/runbooks/experiments/_schema/*) ;;
    packages/runbooks/experiments/*/*)
      id="${path#packages/runbooks/experiments/}"
      id="${id%%/*}"
      # `all`/`auto` are judge.yml's reserved selectors, not agent ids.
      # judge.yml's own select step refuses a PR that adds a directory with
      # one of these names, because it is about to pass the name on as a
      # selector; the guard never passes anything on, it only reports which
      # known agents the floor reached, so a reserved name here is simply
      # not a match rather than a refusal.
      case "$id" in
        all | auto) ;;
        *) add "$id" ;;
      esac
      ;;
  esac
done

printf '%s' "$touched"
