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

Pure logic with no API surface (utilities, parsers, formatters, date projections,
etc.) is fine to test directly.

gp-api offers three patterns in increasing cost: direct instantiation,
`Test.createTestingModule`, and `useTestService()`. Reach for `useTestService()` when
the test's value depends on Postgres, Prisma, or the real pipeline doing real work —
not as a fallback when mocking gets awkward. Worked examples live in
`packages/gp-api/docs/writing-tests.md`.

## Running

```bash
npm run test -w gp-api                                  # vitest for a package
npm run verify -w gp-api                                # lint + tsc --noEmit + vitest (the gate)
npx vitest run packages/gp-api/src/path/to/file.test.ts # single file
npx vitest run --testNamePattern "name"                 # by test name
```

CI runs each package's validate job (lint, typecheck, test) on PRs that touch it.

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

`ECONNREFUSED 127.0.0.1:5432` is a different failure — that suite wants a _local_
Postgres, not a testcontainer.
