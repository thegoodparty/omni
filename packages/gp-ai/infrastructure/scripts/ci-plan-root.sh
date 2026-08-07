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
# Writes to $PLAN_DIR (default /tmp/tfplans):
#   <slug>.txt    human-readable plan output (or the error)
#   <slug>.code   0 = no changes, 2 = changes, 1 = error
#   <slug>.destroy  count of resources the plan would delete
set -uo pipefail

root="${1:?usage: ci-plan-root.sh <env>/<root>}"
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

terraform plan -input=false -no-color -detailed-exitcode -out=tfplan \
  >>"$plan_dir/$slug.txt" 2>&1
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
if [ "$code" = "2" ] && [ -f tfplan ]; then
  json=$(terraform show -json tfplan 2>/dev/null || echo '{}')
  destroys=$(jq '[.resource_changes[]? | select(.change.actions == ["delete"])] | length' <<<"$json" 2>/dev/null || echo 0)
  replaces=$(jq '[.resource_changes[]?
                  | select((.change.actions | index("delete")) and (.change.actions | index("create")))]
                 | length' <<<"$json" 2>/dev/null || echo 0)
fi
echo "${destroys:-0}" >"$plan_dir/$slug.destroy"
echo "${replaces:-0}" >"$plan_dir/$slug.replace"

exit 0
