#!/usr/bin/env bash
#
# setup.sh — one idempotent command from fresh clone to a running, seeded
# local stack (gp-api on :3000, gp-webapp on :4000). Secrets default to the
# GitHub OAuth device flow (read:org) against gp-api's dev-env vending
# endpoint, so a fresh laptop needs zero human credential hand-off;
# `--from <path>` remains as an escape hatch and still takes precedence.
#
# Usage:
#   scripts/setup.sh [--from <path>] [--api-url <url>] [--force]
#                    [--secrets-only] [--refresh] [--user-state <state>]
#
#   --from <path>     A working omni checkout to copy real .env values from,
#                     instead of the GitHub device flow (takes precedence).
#   --api-url <url>   Dev gp-api base URL the device flow vends bundles
#                     from. Defaults to https://gp-api-dev.goodparty.org.
#   --force           Overwrite an existing-but-invalid .env, and skip the
#                     confirmation prompt before wiping a non-empty local DB.
#   --secrets-only    Run only the secrets step (plan/copy-or-vend/merge/
#                     validate/write .env files), then exit 0 — no npm ci,
#                     no docker, no migrate, no dev.sh. Lets another script
#                     (e.g. scripts/worktree-setup.sh) reuse this step
#                     without re-implementing it. Assumes node_modules
#                     already exists (the caller's own install step, not
#                     this one, provides it) since the secrets step shells
#                     out via `npx tsx`.
#   --refresh         Fetch the LOCAL_DEV_ENV bundle again and rebuild the
#                     .env files even when they already validate, so keys
#                     an admin added after your first run reach you. Bundle
#                     values replace yours; every other value you set is
#                     kept. Device flow only, so not with --from. Also
#                     re-vends the Grafana MCP token into .env.mcp.local.
#   --user-state <state>
#                     Product state for the login this script seeds at the
#                     end (default free-win; see
#                     packages/gp-api/src/testFixtures/AGENTS.md for the
#                     full list). No effect if
#                     LOCAL_SETUP_CLERK_MACHINE_SECRET isn't set.
#
# What "idempotent" means here: re-running with everything already in place
# should be fast and should not touch anything that's already correct (see
# each step below for what "already correct" means for it).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck source=scripts/setup-config.sh
source "$ROOT/scripts/setup-config.sh"

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
# Not a package: the repo's MCP servers' tokens, read by scripts/mcp/*.sh.
# Gitignored by *.local; worktree-setup.sh's root .env.* copy carries it.
MCP_ENV="$ROOT/.env.mcp.local"

FROM=""
API_URL="https://gp-api-dev.goodparty.org"
FORCE=false
SECRETS_ONLY=false
REFRESH=false
USER_STATE="free-win"
while [ $# -gt 0 ]; do
  case "$1" in
    --from)
      FROM="$2"
      shift 2
      ;;
    --api-url)
      API_URL="$2"
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
    --refresh)
      REFRESH=true
      shift
      ;;
    --user-state)
      USER_STATE="$2"
      shift 2
      ;;
    -h | --help)
      sed -n '2,37p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ "$REFRESH" = true ] && [ -n "$FROM" ]; then
  echo "--refresh re-fetches the LOCAL_DEV_ENV bundle; it can't be combined with --from." >&2
  exit 1
fi

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
    [ "$REFRESH" = true ] && PLAN_ACTION="write"
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

missing=""
[ "$GP_API_ACTION" = "write" ] && missing="$missing gp-api"
[ "$GP_WEBAPP_ACTION" = "write" ] && missing="$missing gp-webapp"

# TMP_ENV_DIR is created here (not at the top of 3/8) because the device
# flow below, when it runs, needs somewhere to stage vended bundles before
# 3/8's build_one merges them — same "nothing real touched until everything
# validates" invariant as 3/8 itself, just started one step earlier.
TMP_ENV_DIR="$(mktemp -d)"

# Where secrets for a package that needs (re)building come from, in order:
#   1. --from <path>     explicit escape hatch; still works, still wins.
#   2. GitHub device flow  the default — no human credential hand-off.
if [ "$need_from" = true ] && [ -n "$FROM" ]; then
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
elif [ "$need_from" = true ]; then
  if [ -z "$GITHUB_OAUTH_CLIENT_ID" ]; then
    echo "ERROR: no valid .env for:$missing — and no --from given." >&2
    echo "GitHub OAuth App not registered yet, so the device flow can't run." >&2
    echo "Provide --from <path-to-a-working-checkout> — a teammate's omni" >&2
    echo "checkout that already has real vendor keys in its .env files, e.g.:" >&2
    echo "  npm run setup -- --from ~/dev/omni" >&2
    echo "Or see the epic's ops prerequisites for registering the OAuth App." >&2
    echo "No files were written." >&2
    exit 1
  fi
  indent "no --from given; authorizing via the GitHub device flow for:$missing"
  # The device-flow CLI validates the vending response against
  # @goodparty_org/contracts, whose dist/ does not exist yet on a fresh
  # clone (the main build step comes later). Idempotent and ~seconds when
  # already built; only this branch needs it this early.
  indent "building contracts (the device flow validates against its schema)"
  npm run build -w packages/contracts >/dev/null
  # $missing is a bash word-split list of literal package names this script
  # built above ("gp-api gp-webapp"), never external input — safe unquoted.
  # mcp rides along on every device flow rather than starting one of its
  # own, so a blob with no mcp entry never re-prompts on each run.
  # shellcheck disable=SC2086
  if ! npx tsx "$ROOT/scripts/setup/lib/cli.ts" device-flow \
    "$GITHUB_OAUTH_CLIENT_ID" "$API_URL" "$TMP_ENV_DIR" $missing mcp; then
    echo "ERROR: could not fetch dev env bundles via the GitHub device flow." >&2
    echo "Re-run with --from <path-to-a-working-checkout> instead, or see" >&2
    echo "the epic's ops prerequisites for help." >&2
    echo "No files were written." >&2
    exit 1
  fi
fi

log "[3/8] Writing/completing .env files"

# Builds into a temp file and validates, but does not move it into place yet
# — exits the whole script (see plan_action's comment above) if the merged
# env still doesn't validate, before anything real has been touched.
# $device_file, when it exists, is the device flow's vended bundle for
# this package (staged above); it takes precedence over $path, which is
# only ever populated by the --from copy step. When both exist (--refresh,
# or --force over an invalid file), $path goes in underneath the bundle so
# a rebuild keeps whatever the bundle doesn't carry.
build_one() {
  local pkg="$1" path="$2" out="$3" device_file="${4:-}" copied="-" under=""
  if [ -n "$device_file" ] && [ -f "$device_file" ]; then
    copied="$device_file"
    [ -f "$path" ] && under="$path"
  elif [ -f "$path" ]; then
    copied="$path"
  fi
  if ! npx tsx "$ROOT/scripts/setup/lib/cli.ts" build "$pkg" "$copied" "$out" ${under:+"$under"}; then
    echo "ERROR: could not build a valid env for $pkg (missing vars above)." >&2
    echo "No files were written." >&2
    exit 1
  fi
}

[ "$GP_API_ACTION" = "write" ] && build_one gp-api "$GP_API_ENV" \
  "$TMP_ENV_DIR/gp-api.env" "$TMP_ENV_DIR/device-gp-api.env"
[ "$GP_WEBAPP_ACTION" = "write" ] && build_one gp-webapp "$GP_WEBAPP_ENV" \
  "$TMP_ENV_DIR/gp-webapp.env" "$TMP_ENV_DIR/device-gp-webapp.env"

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
# An empty vended token means LOCAL_DEV_ENV has no mcp entry yet; keep
# whatever token the file already holds rather than blanking it.
MCP_TOKEN_LINE='^GRAFANA_SERVICE_ACCOUNT_TOKEN=.'
if grep -q "$MCP_TOKEN_LINE" "$TMP_ENV_DIR/device-mcp.env" 2>/dev/null; then
  mv "$TMP_ENV_DIR/device-mcp.env" "$MCP_ENV"
  indent "wrote .env.mcp.local (Grafana MCP token; restart Claude Code to pick it up)"
elif ! grep -q "$MCP_TOKEN_LINE" "$MCP_ENV" 2>/dev/null; then
  indent "no Grafana MCP token yet: the grafana MCP stays off until an admin"
  indent "adds one to LOCAL_DEV_ENV, then run npm run setup -- --secrets-only --refresh"
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
# Best-effort probe: right after the port opens, gpdb may not accept
# queries yet (or not exist on a fresh volume — prisma creates it). Under
# set -e a failing substitution would kill the whole script with no
# output, so a failed probe must mean "treat as fresh", never death.
table_count="$(
  cd "$ROOT/packages/gp-api" && docker compose exec -T postgres \
    psql -U postgres -d gpdb -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" \
    2>/dev/null | tr -d '[:space:]' || true
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
# Portable across BSD and GNU mktemp: -t <prefix> is macOS-only; GNU
# requires an explicit XXXXXX template.
DEV_LOG="$(mktemp "${TMPDIR:-/tmp}/omni-dev-log.XXXXXX")"
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

# --- 8/8: summary (+ seed a login) -------------------------------------------
log "[8/8] Summary"
secrets_summary="already present"
if [ "$need_from" = true ]; then
  if [ -n "$FROM" ]; then
    secrets_summary="copied from $FROM"
  else
    secrets_summary="vended via GitHub device flow"
  fi
fi

# Best-effort finishing touch: mint a QA fixture user via gp-api's
# AdminOrM2MGuard-gated test-fixtures endpoint, so bootstrap ends with a
# working browser login instead of just a healthy stack (ENG-11191). Reads
# the machine secret back out of the .env file step 3 just wrote/validated
# (not straight off the shell env) because that's the one place --from's
# copy and .env.example's placeholder both flow through. Every step here is
# best-effort on purpose: `set -euo pipefail` means an unguarded non-zero
# exit would kill an otherwise-successful bootstrap over a step that is, by
# design, expected to be unavailable on most machines today (the Clerk
# machine ENG-11191 depends on is an ops prerequisite, not yet provisioned).
SEED_LOGIN_SUMMARY="skipped (LOCAL_SETUP_CLERK_MACHINE_SECRET not set)"
LOCAL_SETUP_SECRET="$(
  npx tsx "$ROOT/scripts/setup/lib/cli.ts" get-var "$GP_API_ENV" \
    LOCAL_SETUP_CLERK_MACHINE_SECRET
)" || LOCAL_SETUP_SECRET=""

if [ -n "$LOCAL_SETUP_SECRET" ]; then
  # Secret travels via the environment, never argv (argv is visible in ps).
  seed_result="$(
    LOCAL_SETUP_CLERK_MACHINE_SECRET="$LOCAL_SETUP_SECRET" \
      npx tsx "$ROOT/scripts/setup/lib/cli.ts" seed-login "$USER_STATE"
  )" || seed_result=""
  seed_status="${seed_result%%$'\t'*}"
  case "$seed_status" in
    OK)
      # Credentials print ONCE, to the terminal only, and only when this
      # script's own stdout IS a terminal — never into a file or a log. CI's
      # setup-smoke job backgrounds this script with `>setup.log 2>&1`, so
      # [ -t 1 ] is false there and the credential-bearing branch never runs.
      if [ -t 1 ]; then
        seed_email="$(printf '%s' "$seed_result" | cut -f2)"
        seed_password="$(printf '%s' "$seed_result" | cut -f3)"
        SEED_LOGIN_SUMMARY="ok
    url       http://localhost:4000
    email     ${seed_email}
    password  ${seed_password}"
      else
        SEED_LOGIN_SUMMARY="minted (credentials suppressed, non-interactive)"
      fi
      ;;
    FAILED)
      SEED_LOGIN_SUMMARY="failed (${seed_result#*$'\t'})"
      ;;
    SKIPPED)
      # Unreachable today — this block only runs when LOCAL_SETUP_SECRET is
      # non-empty, and that's the only input that makes runSeedLogin return
      # 'skipped' — but cli.ts's seed-login command accepts an empty secret
      # as a legitimate input on its own, so handle it explicitly rather
      # than falling into the generic default below and losing the reason.
      SEED_LOGIN_SUMMARY="skipped (${seed_result#*$'\t'})"
      ;;
    *)
      SEED_LOGIN_SUMMARY="skipped (unexpected seed-login output)"
      ;;
  esac
fi

cat <<SUMMARY

==================== omni bootstrap: ready ====================
  preflight            ok  (node ${have_node}, docker, ai-rules)
  secrets              $secrets_summary
  env files            gp-api=${GP_API_ACTION}  gp-webapp=${GP_WEBAPP_ACTION}
  install/build        ok
  postgres             ok   http://localhost:5432
  migrate/seed         ok
  gp-api               ok   http://localhost:3000   (GET /v1/health -> 200)
  gp-webapp            ok   http://localhost:4000
  login                ${SEED_LOGIN_SUMMARY}
=================================================================

Press Ctrl+C to stop the stack.
SUMMARY

wait "$DEV_PID"
