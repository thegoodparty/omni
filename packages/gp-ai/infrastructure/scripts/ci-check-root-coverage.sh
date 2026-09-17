#!/usr/bin/env bash
#
# Checks that the release train actually deploys every terraform root.
#
# Adding a root is two edits in two files, and nothing connected them: a root
# directory under environments/<env>, and an apply step in release.yml. Miss the
# second and the root is never deployed, silently, because no job enumerated the
# directory to notice it was unclaimed.
#
# That is not hypothetical. prod/alert-filter merged with no apply step, so its
# state was never written; prod/shared-infra reads that state, and
# `terraform_remote_state` against a key with no object is a hard plan failure
# rather than an empty result. Every release then failed at
# `apply prod/shared-infra`, which blocked ALL prod gp-ai infrastructure changes
# for a day rather than just the new root's.
#
# The PR-time guard could not have caught it: `TF plan (dev)` plans dev roots
# only, and that root is deliberately prod-only, so it had zero coverage at
# review time. This check reads the files instead, needs no AWS and no
# terraform, and fails the PR that introduces the gap.
#
# Both directions are checked, because deleting a root is the same bug mirrored:
# a step left behind fails on a missing directory.
#
# WHAT THIS DELIBERATELY DOES NOT CHECK is that a root is applied before the
# roots that read its state, which is the more obvious reading of the failure
# above. That invariant cannot hold: the dependency graph contains cycles —
# broker and pmf-engine-control-plane read each other, as do broker and
# pmf-engine-fargate — so no apply order satisfies it, and a check demanding one
# fails on twenty pre-existing pairs that are all working fine.
#
# They work because every apply runs with `background: true` and reads whatever
# the PREVIOUS release wrote. Cross-root reads are one release stale by design,
# and the reverify pass plus the convergence check are what detect a graph that
# has stopped settling. Stale state is therefore fine and absent state is fatal,
# which makes "has this root ever been applied" the only question worth asking
# here — and the only one with an answer that generalizes.
#
set -euo pipefail

cd "$(dirname "$0")/../../../.."
WORKFLOW=.github/workflows/release.yml
ENVIRONMENTS_DIR=packages/gp-ai/infrastructure/environments

fail=0
note() {
  echo "::error::$1"
  fail=1
}

has_step() {
  grep -q "^      - name: $1\$" "$WORKFLOW"
}

count_step() {
  grep -c "^      - name: $1\$" "$WORKFLOW" || true
}

for env in dev prod; do
  env_dir="$ENVIRONMENTS_DIR/$env"
  [ -d "$env_dir" ] || continue

  while IFS= read -r root; do
    has_step "apply $env/$root" ||
      note "$env/$root exists but no 'apply $env/$root' step deploys it, so it is never applied and anything reading its state cannot plan"

    # Not a lesser version of the same check: the convergence check compares a
    # count of re-plan results against a count of root directories, so a missing
    # reverify fails the release on an off-by-one whose message names no root.
    has_step "reverify $env/$root" ||
      note "$env/$root has no 'reverify $env/$root' step, so its convergence is never confirmed and the convergence check fails on the count"

    # Counting, not just asking whether one exists, because "at least one" is
    # what let a duplicate through. Two people fixed the missing
    # prod/alert-filter step at the same time, in different places in the file,
    # so git merged both cleanly and the presence check above was satisfied
    # twice over. The result applies the root twice per release and re-plans it
    # twice, with both re-plans appending to one $PLAN_DIR/<root>.txt and racing
    # to write one <root>.code that the convergence check then reads.
    for step in apply reverify; do
      n=$(count_step "$step $env/$root")
      [ "$n" -le 1 ] ||
        note "'$step $env/$root' appears $n times; the root is deployed more than once per release and its plan output is written by whichever copy finishes last"
    done
  done < <(find "$env_dir" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort)

  for step in apply reverify; do
    while IFS= read -r named; do
      [ -n "$named" ] || continue
      [ -d "$env_dir/$named" ] ||
        note "'$step $env/$named' names a root that does not exist under $env_dir; it will fail on a missing directory"
    done < <(grep -o "^      - name: $step $env/[a-z0-9-]*" "$WORKFLOW" | awk '{print $NF}' | sed "s|^$env/||")
  done
done

if [ "$fail" -ne 0 ]; then
  echo "terraform root coverage check failed" >&2
  exit 1
fi

echo "every terraform root under $ENVIRONMENTS_DIR has an apply and a reverify step"
