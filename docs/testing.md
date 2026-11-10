# Testing

## Conventions (all TypeScript packages)

- **Vitest**, not Jest. gp-api uses the SWC transform (required for NestJS decorator
  metadata).
- Test files are named **`*.test.ts`** — never `.spec.ts`, never `import 'node:test'`.
- Tests load `.env.test`; mocks are cleared between tests.

## What to test through, and what to test directly

For code that sits behind an HTTP route — controllers and the services they depend on
— **drive tests through the API using the project's test harness, not direct
instantiation with mocks.** Test the interface, not the unit. In gp-api that harness
is `useTestService()`, which boots the real app against a Postgres container and
exercises the full request pipeline.

A test at the interface checks what a caller actually sees, and it stays valid when
everything behind the route is refactored. A test that builds a controller or service
with mocks pins today's internal wiring and breaks on the next refactor.

The same goes for background work. Drive the trigger (the route that sends a
job, or the schedule), let the real workers run inside the test app, and
assert on outcomes, not on which method a worker calls. In gp-api that is
`useTestService({ jobs: true })` with `service.jobs.settle()` and
`runSchedule()`; see `packages/gp-api/src/jobs/AGENTS.md` § Tests.

Testing detailed behavior inside a service directly is fine, for example many cases
of one method that would each need heavy route setup. In gp-api, call the method on
the booted app so the database stays real. Pure logic with no API surface (utilities,
parsers, formatters, date projections, etc.) is fine to test directly too. Worked
examples live in `packages/gp-api/docs/writing-tests.md`.

## Running

```bash
npm run test -w gp-api                                  # vitest for a package
npm run verify -w gp-api                                # lint + tsc --noEmit + vitest (the gate)
npx vitest run packages/gp-api/src/path/to/file.test.ts # single file
npx vitest run --testNamePattern "name"                 # by test name
```

CI runs each package's validate job (lint, typecheck, test) on PRs that touch it.

gp-api caches transformed modules on disk between runs
(`packages/gp-api/.vitest-fs-module-cache/`), so its first run after a
lockfile, Node or `vitest.config.ts` change is slower than the ones after it.
If a run ever behaves as if it is running code that is no longer in the
source, clear the cache from `packages/gp-api` with `npx vitest --clearCache`
(or delete the directory) and run again.

## Docker for testcontainers (OrbStack, macOS)

`useTestService()` suites need Docker. Under OrbStack two exports are required, and
**non-interactive shells — agent shells, subagent shells, anything that isn't a
login shell — never inherit them**:

```bash
export PATH="$HOME/.orbstack/bin:$PATH"
export DOCKER_HOST="unix://$HOME/.orbstack/run/docker.sock"
```

The `docker` CLI lives in `~/.orbstack/bin`, and OrbStack has no
`/var/run/docker.sock` — testcontainers-node cannot resolve the OrbStack docker
context on its own.

Without them, docker and testcontainers **hang for minutes instead of failing
fast**, so an agent run just burns its watchdog timeout with no error to read.
Other symptoms: `Could not find a working container runtime strategy`, or
`docker info` reporting a missing socket. The same hang shows up after the machine
sleeps. **Don't restart OrbStack** — it is already running and `orb start` will
say so; exporting `DOCKER_HOST` fixes it immediately.

## Running without a Docker socket

Where testcontainers cannot run at all — an ECS Fargate task, for example —
point `OMNI_TEST_POSTGRES_URL` at a Postgres started alongside the tests and
gp-api's harness will use it instead of starting its
own. It has to be loopback and its maintenance database has to be named
`postgres`; anything else throws instead of silently falling back. Details and
the flags that server needs: `packages/gp-api/AGENTS.md` § Verify.

### In gp-pi

gp-pi's sandbox has no Docker socket either. From the host, give the instance a
test database once:

```bash
scripts/gp-pi-testdb.sh [gp-pi instance]
```

It starts the harness's Postgres as a `gp-pi sidecar` on the sandbox's own
loopback, and gp-pi re-creates it after the instance restarts. Then, inside the
sandbox:

```bash
export OMNI_TEST_POSTGRES_URL=postgresql://test_user:test_password@127.0.0.1:55432/postgres
```

If the harness says that address is unreachable, the engineer re-runs the
script on the host; an agent inside cannot.

`ECONNREFUSED 127.0.0.1:5432` is a different failure — that suite wants a _local_
Postgres, not a testcontainer.

## Local-build E2E trial

The PR Playwright suite runs against each PR's Vercel preview
(`.github/workflows/gp-webapp.yml`, the required `E2E` check). Every test starts
with a cold browser cache and downloads the whole bundle from Vercel, so E2E
traffic is most of gp-webapp's preview bandwidth. The trial measures whether
the same suite can run against a `next start` build inside the CI runner
instead, without changing anything that gates today.

`.github/workflows/gp-webapp-e2e-trial.yml` runs on every same-repo PR that
changes app code:

- **Local build** pulls the preview's env from Vercel, keeps only the public
  `NEXT_PUBLIC_*` values the env contract (`packages/gp-webapp/env.schema.ts`)
  names plus Clerk's public config, and builds with Segment, Amplitude, Faro
  and the HubSpot chat left unset. gp-webapp ships no Sentry SDK, so there is
  none to turn off. It builds while the preview deploys, then waits for the
  preview E2E to finish: both runs would share the PR's single gp-api task and
  the Clerk dev instance's rate limit.
- **Local shard (1 to 3)** start the build with `next start` on
  `localhost:4000` and run the same suite, filter and shard planner as the
  gate. VWO has no env switch, so its host is blocked on the runner; previews
  still load it.
- **Parity with the preview E2E** writes a job summary comparing pass/fail per
  test with the preview run on the same commit, and keeps an `e2e-trial-parity`
  record for 90 days.

Nothing in it is a required check, and its steps run with `continue-on-error`,
so its jobs stay green whatever the tests do. Read the result in the parity
job's summary. To turn it off without a PR, set the repository Actions
variable `E2E_LOCAL_TRIAL` to `off`.

The trial alone saves nothing. It adds runs; the preview runs as before. The
savings arrive with the switch below.

### Cut-over plan

**When to switch.** Aggregate the parity records:

```bash
mkdir -p parity
for id in $(gh run list -R thegoodparty/omni -w "gp-webapp E2E trial" -L 300 --json databaseId -q '.[].databaseId'); do
  gh run download "$id" -R thegoodparty/omni -n e2e-trial-parity -D "parity/$id" 2>/dev/null
done
node packages/gp-webapp/e2e-tests/scripts/e2e-parity.mjs aggregate parity
```

Switch when all of these hold over at least 2 weeks and at least 40 runs with
results from both sides, across at least 15 PRs that change `app/` code:

- Pass/fail differs on no more than 0.5% of tests compared, and every
  difference has a known cause.
- No regression the preview caught was missed locally: no test that failed on
  the preview because of the PR's own change passed on the local build.
- The local run needs a retry no more often than the preview run does.
- Every run compared the whole suite (no tests "not compared" from a missing
  shard) at least 95% of the time.
- The local shards finish within 2 minutes of the preview shards at the shard
  count the switch will use.

**What the switch PR changes.**

- `gp-webapp.yml`: the full suite runs against the local build, which becomes
  the gate. The `E2E` job keeps its name and fail-gate, so the main ruleset
  needs no change.
- The preview run is trimmed to a short smoke set (sign-in, the auth redirect
  for a signed-out dashboard visit, one page that goes through the `/api`
  rewrite to gp-api, one flag override), still part of the `E2E` gate. That
  keeps Vercel's Edge middleware and the real deployed artifact exercised on
  every PR.
- Shard count set from the trial's timings, and the trial workflow and
  `e2e-parity.mjs` deleted.
- Read the preview-or-local target from a repository variable for the first
  weeks, so a fallback to the full preview run needs no PR.
- An architecture decision record for the switch (`docs/adr/`).

**Rolling back.** Set that variable back to the preview, or revert the switch
PR. One revert restores the full preview run, and the required check names
never change.

**The release train.** Its E2E against `dev.goodparty.org` is about 20% of
preview bytes. Leave it on Vercel at the switch: once PRs run only a smoke set
on Vercel, it is the one full run against the real deployed build before prod.
Revisit after the PR switch has been stable for 4 weeks. Moving it to a local
build against `gp-api-dev` with a smoke run against `dev.goodparty.org` is
reasonable only if no Vercel-only failure has appeared in the PR smoke runs by
then.
