#!/usr/bin/env bash
# Plan one terraform root for CI, recording the result to files instead of
# signalling through the exit code.
#
# Called once per root as a `background: true` step so all roots plan
# concurrently inside a single job. It ALWAYS exits 0 on purpose: `wait-all`
# short-circuits every following step if any background step fails, and we still
# want the assemble step to run and post a comment covering every root, including
# the ones that errored. The assemble step reads the .code files and decides the
# job's outcome.
#
# Usage: ci-plan-root.sh <env>/<root>      e.g. ci-plan-root.sh dev/broker
#   optional 3rd arg: a second image tag, for the one root (autopilot-agent-fargate)
#   with a second, Playwright-installed image variant — passed as
#   -var docker_image_tag_playwright=<tag>. Every other root ignores it.
# Writes to $PLAN_DIR (default /tmp/tfplans):
#   <slug>.txt    human-readable plan output (or the error)
#   <slug>.code   0 = no changes, 2 = changes, 1 = error
#   <slug>.destroy  count of resources the plan would delete
#   <slug>.replace  count of resources the plan would replace
#   <slug>.json   `terraform show -json` of the plan (present whenever a
#                 planfile exists, i.e. code 0 or 2, AND `terraform show
#                 -json` itself succeeded). Never written on code 1 (the
#                 init/plan-invocation-failed case), and if `terraform show
#                 -json` fails despite a successful plan, .code is overwritten
#                 to 1 so that failure surfaces instead of a missing/empty
#                 plan JSON reading as "no changes". Consumed by
#                 ci-simulate-apply-perms.sh to predict apply-time IAM calls.
set -uo pipefail

root="${1:?usage: ci-plan-root.sh <env>/<root> [image-tag] [image-tag-playwright]}"
image_tag="${2:-}"
image_tag_playwright="${3:-}"
slug="${root//\//-}"
plan_dir="${PLAN_DIR:-/tmp/tfplans}"
mkdir -p "$plan_dir"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dir="$here/environments/$root"

if [ ! -d "$dir" ]; then
  echo "no such root: $root" >"$plan_dir/$slug.txt"
  echo 1 >"$plan_dir/$slug.code"
  echo 0 >"$plan_dir/$slug.destroy"
  echo 0 >"$plan_dir/$slug.replace"
  exit 0
fi

# Guarded because this script deliberately omits `set -e` (see header). An
# unchecked cd that fails would leave terraform running in whatever directory we
# happened to be in — quite possibly a different root — and report that plan
# under this root's name. -d above tests existence, not traversability.
if ! cd "$dir"; then
  echo "cannot cd into $dir" >"$plan_dir/$slug.txt"
  echo 1 >"$plan_dir/$slug.code"
  echo 0 >"$plan_dir/$slug.destroy"
  echo 0 >"$plan_dir/$slug.replace"
  exit 0
fi

# Providers are pinned by the committed .terraform.lock.hcl in each env wrapper,
# so init is reproducible. -input=false so a missing variable fails instead of
# hanging on a prompt.
if ! terraform init -input=false -no-color >"$plan_dir/$slug.txt" 2>&1; then
  echo 1 >"$plan_dir/$slug.code"
  echo 0 >"$plan_dir/$slug.destroy"
  echo 0 >"$plan_dir/$slug.replace"
  exit 0
fi

# -lock=false: this is a throwaway plan for the PR diff comment and never writes
# state, so it must not contend for the exclusive state lock with a real apply
# (from the release train) on the same root. Terraform has no shared/read lock,
# so without this a concurrent apply fails the plan on "Error acquiring the
# state lock" — the plan can safely read against state an apply is mutating.
plan_args=(-input=false -no-color -detailed-exitcode -out=tfplan -lock=false)
[ -n "$image_tag" ] && plan_args+=(-var "docker_image_tag=$image_tag")
[ -n "$image_tag_playwright" ] && plan_args+=(-var "docker_image_tag_playwright=$image_tag_playwright")
terraform plan "${plan_args[@]}" >>"$plan_dir/$slug.txt" 2>&1
code=$?
echo "$code" >"$plan_dir/$slug.code"

# Count deletions so the comment can flag them. Destroys are never applied
# automatically, so surfacing them on the PR is the whole point.
#
# A pure delete is actions == ["delete"]. A REPLACE is ["delete","create"] (or
# ["create","delete"] for create_before_destroy), which is destructive in its own
# right — it can drop data and cause downtime — but is not a removal, so the two
# are counted separately rather than lumped together under "to DESTROY".
destroys=0
replaces=0
# Gated on code 0/2, not just `-f tfplan`: a failed `terraform plan` (code 1)
# does not (re)write the -out=tfplan file, so an unguarded `-f tfplan` check
# can pick up a STALE planfile left on disk by an earlier successful run in
# this same root — this repo's checkouts are shared across sessions/agents
# (see CLAUDE.md § Worktrees), so that stale file is a real, not theoretical,
# risk. Reading it would hand ci-simulate-apply-perms.sh a plan JSON that
# doesn't correspond to this run's actual (failed) plan attempt.
if [ -f tfplan ] && { [ "$code" = "0" ] || [ "$code" = "2" ]; }; then
  # No `|| echo '{}'` fallback here on purpose: that swallowed `terraform show
  # -json` failures into a fake empty plan, which ci-simulate-apply-perms.sh
  # then reads as "no resource changes" — a root whose plan was never actually
  # inspected silently passes the IAM-permission guard. Write no .json at all
  # on failure, and flip this root's .code to 1 (error) so the existing
  # "Post consolidated plan comment" step's `errored` handling — which
  # already core.setFailed()s the job for any non-0/2 code — catches it,
  # instead of adding a second, parallel failure path.
  if json=$(terraform show -json tfplan 2>>"$plan_dir/$slug.txt"); then
    # Written for both code 0 (no changes) and code 2 (changes) so the simulate-apply-perms
    # guard has a plan JSON for every root that produced a planfile, not just the
    # ones with diffs.
    echo "$json" >"$plan_dir/$slug.json"
    if [ "$code" = "2" ]; then
      destroys=$(jq '[.resource_changes[]? | select(.change.actions == ["delete"])] | length' <<<"$json" 2>/dev/null || echo 0)
      # Excludes aws_ecs_task_definition: an image-tag change always replaces the
      # revision, so counting it would fire the destroy/replace warning on every
      # single deploy and train reviewers to ignore the banner.
      replaces=$(jq '[.resource_changes[]?
                      | select(.type != "aws_ecs_task_definition")
                      | select((.change.actions | index("delete")) and (.change.actions | index("create")))]
                     | length' <<<"$json" 2>/dev/null || echo 0)
    fi
  else
    echo "::error::$root: terraform show -json failed; not writing a plan JSON (see $slug.txt)" >&2
    code=1
    echo "$code" >"$plan_dir/$slug.code"
  fi
fi
echo "${destroys:-0}" >"$plan_dir/$slug.destroy"
echo "${replaces:-0}" >"$plan_dir/$slug.replace"

exit 0
