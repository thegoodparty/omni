#!/usr/bin/env bash
#
# setup.sh — one idempotent command from fresh clone to a running, seeded
# local stack (gp-api on :3000, gp-webapp on :4000). Phase 1 of the bootstrap
# epic: secrets come from `--from <path-to-a-working-checkout>`; a later
# phase replaces that with a vending endpoint WITHOUT changing anything else
# in this script.
#
# Usage:
#   scripts/setup.sh [--from <path>] [--force] [--secrets-only]
#
#   --from <path>     A working omni checkout to copy real .env values from.
#                     Required only when this checkout has no valid .env yet.
#   --force           Overwrite an existing-but-invalid .env, and skip the
#                     confirmation prompt before wiping a non-empty local DB.
#   --secrets-only    Run only the secrets step (plan/copy/merge/validate/
#                     write .env files), then exit 0 — no npm ci, no docker,
#                     no migrate, no dev.sh. Lets another script (e.g.
#                     scripts/worktree-setup.sh) reuse this step without
#                     re-implementing it. Assumes node_modules already exists
#                     (the caller's own install step, not this one, provides
#                     it) since the secrets step shells out via `npx tsx`.
#
# What "idempotent" means here: re-running with everything already in place
# should be fast and should not touch anything that's already correct (see
# each step below for what "already correct" means for it).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# The packages this script provisions locally: gp-api and gp-webapp, spelled
# out per-package below rather than looped over an associative array — macOS
# ships bash 3.2 (no `declare -A`), and every engineer's Mac is exactly the
# machine this script has to run on. election-api is deliberately excluded —
# gp-webapp talks to the deployed dev election-api URL it already defaults to
# (see packages/election-api/src/shared/env/env.schema.ts), and nothing here
# runs it. gp-admin is out of scope for the same reason: it is not part of
# the stack scripts/dev.sh boots.
#
# Next.js only reads .env.local (gitignored) locally, never .env — see
# docs/development.md and gp-webapp/package.json's `dev` script.
GP_API_ENV="$ROOT/packages/gp-api/.env"
GP_WEBAPP_ENV="$ROOT/packages/gp-webapp/.env.local"

FROM=""
FORCE=false
SECRETS_ONLY=false
while [ $# -gt 0 ]; do
  case "$1" in
    --from)
      FROM="$2"
      shift 2
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --secrets-only)
      SECRETS_ONLY=true
      shift
      ;;
    -h | --help)
      sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

log() { echo "==> $*"; }
indent() { echo "    $*"; }

# --- cleanup: never leave a temp dir behind, never leave the dev stack ------
# running past a failed/interrupted run. DEV_PID is only set once step 7
# launches scripts/dev.sh; on the success path we `wait` on it below instead
# of reaching this trap, so a normal Ctrl+C after boot still routes through
# here and tears the stack down the same way.
TMP_ENV_DIR=""
DEV_PID=""
cleanup() {
  local exit_code=$?
  if [ -n "$TMP_ENV_DIR" ] && [ -d "$TMP_ENV_DIR" ]; then
    rm -rf "$TMP_ENV_DIR"
  fi
  if [ -n "$DEV_PID" ] && kill -0 "$DEV_PID" 2>/dev/null; then
    echo
    log "Shutting down dev stack (scripts/dev.sh, pid $DEV_PID)..."
    # Best-effort: signal dev.sh's own children (it traps INT/TERM and does
    # `kill 0` itself), then the process itself. Never touch anything else on
    # 3000/4000/5432 — this checkout is shared with other agents' worktrees,
    # and killing a foreign process by port is exactly what we must not do.
    pkill -TERM -P "$DEV_PID" 2>/dev/null || true
    kill -TERM "$DEV_PID" 2>/dev/null || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# --- 1/8: preflight ----------------------------------------------------------
# Skipped entirely in --secrets-only mode: that mode exists for a caller
# (scripts/worktree-setup.sh) that already owns its own install step, and it
# needs node_modules to already be in place for exactly the reason the npm ci
# comment below explains.
if [ "$SECRETS_ONLY" != true ]; then
  log "[1/8] Preflight"

  pinned_node="$(tr -d '[:space:]' <"$ROOT/.nvmrc")"
  have_node="$(node -v | tr -d 'v')"
  # MAJOR only, deliberately — see contracts/scripts/assert-node-version.ts's
  # reasoning. .nvmrc pins a patch version nobody's local nvm actually matches.
  if [ "${pinned_node%%.*}" != "${have_node%%.*}" ]; then
    echo "ERROR: Node ${have_node} is running; this repo pins ${pinned_node} (.nvmrc)." >&2
    echo "Fix: nvm use" >&2
    exit 1
  fi
  indent "node ${have_node} OK (pinned ${pinned_node})"

  if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: docker not found on PATH." >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "ERROR: docker daemon not reachable." >&2
    echo "Hint: colima users need DOCKER_HOST exported (colima status --json | grep docker_host)," >&2
    echo "and colima itself needs to be running (colima start)." >&2
    exit 1
  fi
  indent "docker OK"

  if [ -z "$(ls -A "$ROOT/ai-rules" 2>/dev/null)" ]; then
    indent "ai-rules/ submodule empty; initializing"
    git -C "$ROOT" submodule update --init --recursive
  fi
  indent "ai-rules/ OK"

  # `npm ci` runs here rather than with the rest of step 4's build commands: the
  # secrets step below shells out to `npx tsx` against a schema module that
  # imports zod, and on a genuinely fresh clone there is no node_modules yet for
  # that import to resolve. Prisma generation later in step 4 still needs the
  # env files step 3 writes first (its schema declares `url = env("DATABASE_URL")`,
  # and `prisma generate` fails fast if that resolves to nothing) — so only this
  # one command moves, not the whole step.
  log "[dependencies] npm ci"
  npm ci --prefer-offline
fi

# --- 2/8 + 3/8: secrets + env files ------------------------------------------
# Plan every package's action before writing anything ("no partial writes"):
# skip (existing .env already valid), or write (build one from copied +
# local-only + placeholder values). An existing-but-invalid file only gets
# rebuilt with --force; otherwise it's left alone and we refuse to guess.
log "[2/8] Secrets"

# Sets $PLAN_ACTION to "skip" or "write". Runs in the current shell (not a
# `$(...)` subshell) so its `exit 1` on an invalid-without-force file actually
# ends the script instead of just the subshell.
plan_action() {
  local pkg="$1" path="$2"
  if [ -f "$path" ] && npx tsx "$ROOT/scripts/setup/lib/cli.ts" check "$pkg" "$path" >/dev/null 2>&1; then
    PLAN_ACTION="skip"
    return
  fi
  if [ -f "$path" ] && [ "$FORCE" != true ]; then
    echo "ERROR: $path exists but fails schema validation:" >&2
    npx tsx "$ROOT/scripts/setup/lib/cli.ts" check "$pkg" "$path" >&2 || true
    echo "Fix it by hand, or re-run with --force to let setup.sh rebuild it (this OVERWRITES the file)." >&2
    exit 1
  fi
  PLAN_ACTION="write"
}

plan_action gp-api "$GP_API_ENV"
GP_API_ACTION="$PLAN_ACTION"
indent "packages/gp-api/.env: $GP_API_ACTION"

plan_action gp-webapp "$GP_WEBAPP_ENV"
GP_WEBAPP_ACTION="$PLAN_ACTION"
indent "packages/gp-webapp/.env.local: $GP_WEBAPP_ACTION"

need_from=false
[ "$GP_API_ACTION" = "write" ] && need_from=true
[ "$GP_WEBAPP_ACTION" = "write" ] && need_from=true

if [ "$need_from" = true ] && [ -z "$FROM" ]; then
  missing=""
  [ "$GP_API_ACTION" = "write" ] && missing="$missing gp-api"
  [ "$GP_WEBAPP_ACTION" = "write" ] && missing="$missing gp-webapp"
  echo "ERROR: no valid .env for:$missing — and no --from given." >&2
  echo "Provide --from <path-to-a-working-checkout> — a teammate's omni checkout" >&2
  echo "that already has real vendor keys in its .env files, e.g.:" >&2
  echo "  npm run setup -- --from ~/dev/omni" >&2
  echo "No files were written." >&2
  exit 1
fi

if [ "$need_from" = true ]; then
  indent "copying untracked .env files from $FROM"
  # Mirrors scripts/worktree-setup.sh, one level deeper (e2e-tests/.env):
  # untracked .env* only
  # (tracked ones — .env.test, .env.example — already arrived via git), and
  # never overwrites a file already present at the destination.
  for dir in "$FROM" "$FROM"/packages/* "$FROM"/packages/*/*; do
    [ -d "$dir" ] || continue
    for src in "$dir"/.env "$dir"/.env.*; do
      [ -f "$src" ] || continue
      rel="${src#"$FROM"/}"
      if git -C "$FROM" ls-files --error-unmatch "$rel" >/dev/null 2>&1; then
        continue
      fi
      if [ -e "$ROOT/$rel" ]; then
        indent "keep  $rel (already present)"
      else
        mkdir -p "$(dirname "$ROOT/$rel")" && cp "$src" "$ROOT/$rel"
        indent "copy  $rel"
      fi
    done
  done
fi

log "[3/8] Writing/completing .env files"
TMP_ENV_DIR="$(mktemp -d)"

# Builds into a temp file and validates, but does not move it into place yet
# — exits the whole script (see plan_action's comment above) if the merged
# env still doesn't validate, before anything real has been touched.
build_one() {
  local pkg="$1" path="$2" out="$3" copied="-"
  [ -f "$path" ] && copied="$path"
  if ! npx tsx "$ROOT/scripts/setup/lib/cli.ts" build "$pkg" "$copied" "$out"; then
    echo "ERROR: could not build a valid env for $pkg (missing vars above)." >&2
    echo "No files were written." >&2
    exit 1
  fi
}

[ "$GP_API_ACTION" = "write" ] && build_one gp-api "$GP_API_ENV" "$TMP_ENV_DIR/gp-api.env"
[ "$GP_WEBAPP_ACTION" = "write" ] && build_one gp-webapp "$GP_WEBAPP_ENV" "$TMP_ENV_DIR/gp-webapp.env"

# Only move into place once every package that needed writing has validated —
# a later package failing above must not leave an earlier one half-applied.
if [ "$GP_API_ACTION" = "write" ]; then
  mv "$TMP_ENV_DIR/gp-api.env" "$GP_API_ENV"
  indent "wrote packages/gp-api/.env"
fi
if [ "$GP_WEBAPP_ACTION" = "write" ]; then
  mv "$TMP_ENV_DIR/gp-webapp.env" "$GP_WEBAPP_ENV"
  indent "wrote packages/gp-webapp/.env.local"
fi
rm -rf "$TMP_ENV_DIR"
TMP_ENV_DIR=""

if [ "$SECRETS_ONLY" = true ]; then
  indent "--secrets-only: env files ready; skipping install/build/postgres/migrate/launch"
  exit 0
fi

# --- 4/8: build workspace-internal packages -----------------------------------
log "[4/8] Build"
npm run build -w packages/contracts
npm run build -w packages/nest-common
npm run generate -w packages/gp-api

# --- 5/8: postgres ------------------------------------------------------------
log "[5/8] Postgres"
(cd "$ROOT/packages/gp-api" && docker compose up -d)
indent "waiting for postgres on :5432"
pg_ready=false
for _ in $(seq 1 30); do
  if (cd "$ROOT/packages/gp-api" && docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1); then
    pg_ready=true
    break
  fi
  sleep 1
done
if [ "$pg_ready" != true ]; then
  echo "ERROR: postgres did not become ready on :5432 within 30s." >&2
  echo "If something else on this machine already owns :5432, docker compose" >&2
  echo "up above would have failed to bind it — check with: lsof -i :5432" >&2
  exit 1
fi
indent "postgres ready"

# --- 6/8: migrate + seed ------------------------------------------------------
log "[6/8] Migrate + seed"
table_count="$(
  cd "$ROOT/packages/gp-api" && docker compose exec -T postgres \
    psql -U postgres -d gpdb -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" \
    2>/dev/null | tr -d '[:space:]'
)"
skip_reset=false
if [ -n "$table_count" ] && [ "$table_count" != "0" ]; then
  if [ "$FORCE" = true ]; then
    indent "DB has $table_count existing tables; --force given, wiping"
  elif [ -t 0 ]; then
    read -r -p "    DB already has $table_count tables. migrate:reset WIPES it (factory seeds aren't idempotent). Continue? [y/N] " reply
    case "$reply" in
      [yY]*) ;;
      *)
        indent "Skipping migrate:reset; DB left as-is."
        skip_reset=true
        ;;
    esac
  else
    echo "ERROR: DB is non-empty ($table_count tables) and this run is non-interactive." >&2
    echo "Re-run with --force to wipe it, or run migrate:reset by hand once you've" >&2
    echo "confirmed that's what you want." >&2
    exit 1
  fi
fi
if [ "$skip_reset" != true ]; then
  npm run migrate:reset -w gp-api
fi

# --- 7/8: launch + wait healthy ----------------------------------------------
log "[7/8] Launching dev stack"
DEV_LOG="$(mktemp -t omni-dev-log)"
indent "scripts/dev.sh started; combined output -> $DEV_LOG"
"$ROOT/scripts/dev.sh" >"$DEV_LOG" 2>&1 &
DEV_PID=$!

api_ok=false
webapp_ok=false
# 450 * 2s = 15min, matching the setup-smoke job's outer poll budget: a cold
# first boot compiles gp-webapp + gp-api on a 2-core CI runner, and this
# inner gate must never give up before the workflow's own deadline does.
timeout_iters=450
for _ in $(seq 1 "$timeout_iters"); do
  if [ "$api_ok" != true ] && curl -fsS "http://localhost:3000/v1/health" >/dev/null 2>&1; then
    api_ok=true
  fi
  if [ "$webapp_ok" != true ] && curl -fsS "http://localhost:4000" >/dev/null 2>&1; then
    webapp_ok=true
  fi
  if [ "$api_ok" = true ] && [ "$webapp_ok" = true ]; then
    break
  fi
  if ! kill -0 "$DEV_PID" 2>/dev/null; then
    echo "ERROR: scripts/dev.sh exited early." >&2
    tail -n 80 "$DEV_LOG" >&2
    exit 1
  fi
  sleep 2
done

if [ "$api_ok" != true ] || [ "$webapp_ok" != true ]; then
  echo "ERROR: timed out waiting for gp-api :3000 and/or gp-webapp :4000." >&2
  echo "gp-api healthy: $api_ok   gp-webapp healthy: $webapp_ok" >&2
  echo "--- tail of scripts/dev.sh combined log (gp-api + gp-webapp interleaved) ---" >&2
  tail -n 80 "$DEV_LOG" >&2
  exit 1
fi

# --- 8/8: summary --------------------------------------------------------------
log "[8/8] Summary"
cat <<SUMMARY

==================== omni bootstrap: ready ====================
  preflight            ok  (node ${have_node}, docker, ai-rules)
  secrets              $([ "$need_from" = true ] && echo "copied from $FROM" || echo "already present")
  env files            gp-api=${GP_API_ACTION}  gp-webapp=${GP_WEBAPP_ACTION}
  install/build        ok
  postgres             ok   http://localhost:5432
  migrate/seed         ok
  gp-api               ok   http://localhost:3000   (GET /v1/health -> 200)
  gp-webapp            ok   http://localhost:4000
=================================================================

Press Ctrl+C to stop the stack.
SUMMARY

wait "$DEV_PID"
