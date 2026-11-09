# Writing tests

We use **Vitest** with SWC (required for NestJS decorator metadata). Test files end in `.test.ts` (never `.spec.ts`). Loads `.env.test`; `clearMocks: true`.

We treat every test as a unit test. There is no separate "integration" tier and no e2e tier. What varies is how much of the app the test exercises and where the seams are mocked.

## Picking an approach

**Test through the API wherever you can.** For code behind an HTTP route, meaning controllers and the services they call, write a route test: boot the app with `useTestService()` and call the route with `service.client`. A route test checks what a caller of the API actually sees, and it stays valid when everything behind the route is refactored. A test that builds a controller or service with mocks pins today's internal wiring and breaks on the next refactor.

Go below the route only when the route is the wrong tool:

- **Detailed behavior inside a service.** Many cases of one service method that would each need heavy route setup, or code no route reaches, such as a job or a queue handler. Call the method on the booted app, `service.app.get(ThingService)`, so Postgres and the real providers stay real.
- **Pure logic with no API surface.** Utilities, parsers, formatters, date math. Import it and call it.
- **Code with no route that needs neither the database nor the app.** Build it directly with hand-rolled deps (Pattern 2), or with `Test.createTestingModule` when the DI graph is too big to hand-roll (Pattern 3).

Do not test a controller by building it with mocks. Test its logic, such as a role or ownership branch or a response mapping, through its route. Build a controller directly only for logic a route test cannot reach, such as an SSE loop.

## Pattern 1: `useTestService()`

Spins up a real Postgres in Docker, runs migrations, bootstraps the full Nest app, and exposes an authed Axios client plus a Prisma client. Each test file gets its own database; every table is emptied between tests. Default authenticated user id is `123`.

The default is a route test through the HTTP client. It covers validation, guards, interceptors and the response shape along with the service behind them:

```ts
import { useTestService } from '@/test-service'

const service = useTestService()

it('creates a campaign', async () => {
  const result = await service.client.post('/v1/campaigns', { slug: 'foo' })
  expect(result.status).toBe(201)
})
```

For detailed behavior inside a service, call the service on the booted app:

```ts
describe('UsersService', () => {
  let usersService: UsersService

  beforeEach(() => {
    usersService = service.app.get(UsersService)
  })

  it('finds a user by email case-insensitively', async () => {
    const user = await usersService.findUserByEmail('TESTS@GOODPARTY.ORG')
    expect(user?.id).toBe(service.user.id)
  })
})
```

Use `service.prisma` to seed the database directly — bypassing the API is fine for setup. Override providers per-test by grabbing them off the app and mocking with `vi.spyOn`:

```ts
const contacts = service.app.get(ContactsService)
vi.spyOn(contacts, 'getDistrictStats').mockResolvedValue({ ... })
```

See `src/users/services/users.service.test.ts` and `src/polls/polls.test.ts` for representative examples.

**No schedules run.** The harness boots the app with no `@Cron`, `@Interval` or `@Timeout` registered, so no job fires on a real timer mid-suite and writes rows a test is counting (ENG-11423: an hourly cron claimed a `cron_run` row during a table-wide count). Test a job by calling its method on the service, as `outreachInboundSweep.service.test.ts` does. A suite that needs the real scheduler, for example to assert what `SchedulerRegistry` holds, passes `useTestService({ scheduler: true })`; every job then fires on real timers, so scope each assertion to rows the test owns. `src/test-service.scheduler.test.ts` covers both.

## Pattern 2: Direct instantiation

For code with no route that you can build with a few hand-rolled deps.

```ts
import { describe, expect, it, vi } from 'vitest'

const mockUsers: Partial<UsersService> = {
  findUser: vi.fn().mockResolvedValue(null),
}

const thing = new ThingService(mockUsers as UsersService, createMockLogger())

it('returns null for an unknown user', async () => {
  expect(await thing.ownerOf(1)).toBeNull()
})
```

For services backed by `createPrismaBase`, override the internal client:

```ts
Object.defineProperty(service, '_prisma', { get: () => mockClient })
```

## Pattern 3: `Test.createTestingModule`

For code with no route whose providers are too many to hand-roll. Provide mocks for everything the constructor touches.

```ts
const module = await Test.createTestingModule({
  providers: [
    AnalyticsService,
    { provide: SegmentService, useValue: mockSegment },
    { provide: UsersService, useValue: mockUsersService },
    { provide: PinoLogger, useValue: createMockLogger() },
  ],
}).compile()

const service = module.get(AnalyticsService)
```

See `src/analytics/analytics.service.test.ts` for a worked example.

## Helpers

Under `src/shared/test-utils/`:

- `createMockLogger()` — a fully-stubbed `PinoLogger`
- `createMockClerkEnricher()` — stub for `ClerkUserEnricherService`
- `createMockUser()`, `createMockCampaign()`, etc. — factories under `factories/`
- `appEnvOverrides`, `useAppEnvOverrides()`, `disableVendorCrons()` — flip the deploy-env constants in `appEnvironment.util` (`IS_NON_PROD_DEPLOY`, `VENDOR_MODE`, `VENDOR_CRONS_ENABLED`, `APP_ROOT`, `WEBAPP_ROOT`), plus the id-filter cap `MAX_RESOLVED_ID_SET_SIZE`

Prefer these over re-rolling stubs.

## Module mocks

Avoid `vi.mock`. Any file that calls it (or `vi.doMock`, `vi.unmock`, `vi.resetModules`) runs in the `fresh-modules` project and re-imports the whole app graph, ~5s per file; see `## Verify` in `../AGENTS.md`. Spy instead:

```ts
vi.spyOn(service.app.get(S3Service), 'getFile').mockResolvedValue(body)

import * as sleepUtil from '@/shared/util/sleep.util'
vi.spyOn(sleepUtil, 'sleep').mockResolvedValue(undefined)
```

The deploy-env constants are evaluated at import, so `vi.stubEnv` can't flip them. `src/test-app-env-mock.ts` mocks `appEnvironment.util` once for every `shared-modules` file, with getters that read `appEnvOverrides` first:

```ts
import {
  appEnvOverrides,
  useAppEnvOverrides,
} from '@/shared/test-utils/appEnvOverrides'

useAppEnvOverrides({ IS_NON_PROD_DEPLOY: true }) // file default, set before the app boots

it('404s on a prod deploy', async () => {
  appEnvOverrides.IS_NON_PROD_DEPLOY = false // this test only
})
```

Overrides reset after every test and every file. They reach code that reads the constant when it runs; a value captured at import (the Vercel client and Peerly config resolve `vendorBaseUrl` at import) still needs `vi.mock`.

What to use instead of a module mock:

- **A function from one of our modules:** `import * as mod` and `vi.spyOn(mod, 'fn')`. The code under test sees the spy. The exception is `appEnvironment.util`: its mock is rebuilt for every file, so a spy on it misses code an earlier file already loaded. Examples: `vendorSchema.metrics` in `parseVendorResponse.test.ts`, `pollBiasPrompt.util` in `pollBiasAnalysis.service.test.ts`, `pdf.extractor` in `chatAttachmentsLink.service.test.ts`.
- **A sleep or retry delay:** call `sleep` from `@/shared/util/sleep.util` and spy on it, as `campaignTasks.service.test.ts` and `cvStatusPoll.service.test.ts` do. Fake timers do not reach `timers/promises`, so do not import `setTimeout` from it in app code.
- **A vendor SDK client:** spy on the prototype, `vi.spyOn(TranscribeClient.prototype, 'send')` (`robocallTranscription.service.test.ts`), or swap the instance field, `Object.defineProperty(service, 'graphQLClient', ...)` (`ballotReady.service.test.ts`). A lazy client such as a `pg` `Pool` is safe to build for real: spy on `service['pool'].connect` (`pollResponsesDownload.service.test.ts`).
- **A third-party default export that is a plain object:** spy on it, `vi.spyOn(zipcodes, 'lookup')`.
- **A collaborator class:** inject a stub through the constructor or the `Test.createTestingModule` provider. Do not mock the module the service imports it from (`outreach.service.test.ts` stubs `AreaCodeFromZipService`).
- **A `createPrismaBase` service:** override `_prisma` (Pattern 2), never mock `prisma.util`.
- **A module-level config object:** set the field in `beforeEach` and restore it in `afterEach` (`campaignPlanQueueConfig` in `aiGeneration.service.test.ts`).
- **An env var read at import:** move the `process.env` read into the method that uses it, then `vi.stubEnv` it (`shouldEnableDomainPurchase`, `CallhubBaseConfig.apiKey`).
- **A library you want to test against:** leave it real. A `vi.mock('slugify')` made the slugify tests assert the mock.

Delete a `vi.mock` that no assertion reads. If one `describe` truly needs a module mock, move it to its own small file so the rest of the suite stays in `shared-modules` (`paymentEventsService.webhooksNotConfigured.test.ts`). An export of an externalized package (`getSignedUrl` from `@aws-sdk/s3-request-presigner`) is a real ESM namespace and cannot be spied, so that case keeps `vi.mock`.

## Environment variables

Change env with `vi.stubEnv`, never by assigning or deleting a `process.env` key. `vi.stubEnv('KEY', undefined)` unsets one. A stub lasts until the file ends; call `vi.unstubAllEnvs()` in `afterEach` if a later test needs the original back. For the deploy-env constants in `appEnvironment.util`, use `appEnvOverrides` (see "Module mocks").

`src/test-file-cleanup.ts` resets `process.env` to the worker's starting env before each file, so a write cannot leak into the next file. Inside a file it still reaches every later test. Tests never see `packages/gp-api/.env` or a shell `AWS_PROFILE`, which CI does not have either.

## Limits and caps

Never seed bulk rows, or build a huge array, to cross a limit. Make the limit overridable and cross a small one with a few rows. Seeding 200k rows to trip `MAX_RESOLVED_ID_SET_SIZE` cost 10-15s per test; a cap of 3 costs milliseconds.

- For a module constant, give it its own module, add the key to `AppEnvOverrides`, and add a getter in `src/test-app-env-mock.ts` that reads `appEnvOverrides` first, as `src/contactInteraction/resolvedIdSetCap.const.ts` does. A module mock only changes what importers see, so code in the constant's own file would keep the real value.
- Test both sides of the boundary: at the cap passes, one past it fails.

```ts
it('throws when the resolved set exceeds the cap', async () => {
  appEnvOverrides.MAX_RESOLVED_ID_SET_SIZE = 3
  await seedTexts(org, 4)
  await expect(resolution.resolveIdFilter(org, conditions)).rejects.toThrow()
})
```

If the real value matters (a customer hit it), pin it once with a plain assertion on the constant, as `intersectIdFilterResolutions.test.ts` does for ENG-11424.

## Pass-through and propagation tests

- Do not write a controller unit test. Test the controller's logic through its route (`service.client` against `useTestService()`). To pin the forwarded arguments or the response body, add that assertion to the route test, as `electionServiceReadRoutes.test.ts` does.
- Do not write "propagates X from <dependency>" tests, where a mock throws X and the test asserts X. Assert the error where it is thrown, or through a route test that reaches it.
- Do not test the same pass-through at every layer ("delegates", "forwards", "returns what the service returns"). Test the layer that does the work, or the route.

## CLI entry points

Call a script's entry in-process, never through a subprocess per test. Spawning `tsx` costs ~3s a test. Export the `require.main === module` body as a function that takes its args, env and output writers and returns the exit code, and leave the `require.main` block calling only that:

```ts
export const runArmBudgetEntry = (args, env, writeStderr): number => { ... }

if (require.main === module) {
  const code = runArmBudgetEntry(process.argv.slice(2), process.env, (text) =>
    process.stderr.write(text),
  )
  if (code !== 0) process.exit(code)
}
```

Keep at most one subprocess test per entry, to prove the `require.main` wiring. See `src/chats/evals/judge/armBudget.test.ts`.

## Prompt and copy text

Do not write tests that assert fixed wording in an LLM system prompt, a tool description, or the instructions for generated copy. A test that builds a prompt from default inputs and checks it contains a sentence, or uses `not.toContain` to check old wording is gone, fails on every rewording and catches no bug. Judge prompt wording with an eval, not a unit test.

Test the logic around the prompt instead:

- A section that appears only when a tool, flag, mode or input is set: build the prompt both ways and assert the section is in one and not the other. Use its heading, not its sentences.
- Values the code computes into the prompt: dates, counts, term math, records rendered from input.
- Invariants over every prompt: no em dash, and Win and Serve audience nouns (`docs/product-vocabulary.md` at the repo root).
- A shared constant another component depends on, such as a guardrail line, a marker the app sends, or an enum a tool returns: assert with the imported constant, never a pasted copy of its text.

## Atomicity, locks, and races

Never mock `$transaction`, `$queryRaw`/`$executeRaw`, or a Prisma model to test a transaction, a compare-and-swap claim, an advisory or row lock, or a race. A mocked `$transaction` that runs the callback has no rollback and no isolation, and a matched SQL string passes whether or not the query is right. Use `useTestService()`, in an existing suite for that area rather than a new file, and:

- Race real calls with `Promise.all` and assert on the rows: exactly one winner, the loser's row untouched.
- Force the overlap instead of hoping for it: a barrier in a `vi.spyOn` on a step both callers pass before the claim, or a `pg_sleep` trigger that holds the winner's transaction open. Drop the trigger in `afterEach`.
- Prove a rollback by making Postgres fail the write with a `RAISE EXCEPTION` trigger, then assert the earlier writes in the same transaction did not land.
- Check the test fails with the lock, the `WHERE` guard, or the transaction removed.

Examples: `redeemFreeTexts` in `src/campaigns/campaigns.update.integration.test.ts`, the domain purchase lock at the end of `src/websites/services/domains.service.test.ts`, and the claims in `src/onboarding/services/localNews.service.test.ts`.

## Running tests

```bash
npm test                                            # full suite
npx vitest run src/path/to/file.test.ts             # single file
npx vitest run --testNamePattern "case-insensitive" # by name
npm run verify                                      # lint + tsc + tests
```

Transformed modules are cached in `.vitest-fs-module-cache/`, so a repeat run skips the swc transform. If a run executes code that is no longer in the source, run `npx vitest --clearCache`; don't turn the cache off.

`useTestService()` tests need Docker running locally. The first run pulls `postgres:16-alpine`; subsequent runs reuse the container. On OrbStack, non-interactive shells need `PATH`/`DOCKER_HOST` exported or docker hangs rather than failing — see `docs/testing.md` § Docker for testcontainers (repo root).

## Dead and one-shot code

A test earns its place by catching a future bug in code that still runs. These cannot, so don't write them, and delete any you find:

- A test that replays a migration's SQL, or tests a one-shot script (backfill, data repair). Once merged and run, the code never runs again. Delete the test after merge, and the script once it has run.
- A test that a deleted route still 404s. Deleting the controller method is the whole change.
- A benchmark or perf model that imports no product code. Put the numbers in the PR body.
- A test whose only caller is the test. Delete the dead export, method or service with it rather than keep it alive for coverage. Grep for non-test callers before adding a test to old code.
- A test of a library or Node built-in (`AsyncLocalStorage`, `p-map`). Test the code of ours that uses it.

## Anti-patterns

- Mocking Prisma to test SQL behavior. If the test's purpose is "does this query return what I think it returns", use `useTestService()` — a mock just asserts the mock.
- Asserting on private methods. Test the public surface (controller route, service method).
- Sharing mutable state between tests in a file. Reset in `beforeEach`. With `useTestService()`, tables are already emptied for you.
- Adding a new pattern. If none of the three above fit, raise it before inventing a fourth.
