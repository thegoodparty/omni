# Writing tests

We use **Vitest** with SWC (required for NestJS decorator metadata). Test files end in `.test.ts` (never `.spec.ts`). Loads `.env.test`; `clearMocks: true`.

We treat every test as a unit test. There is no separate "integration" tier and no e2e tier. What varies is how much of the app the test exercises and where the seams are mocked.

## Picking an approach

Three patterns, in increasing cost:

1. **Direct instantiation** — `new Controller(mockDeps)`. Fastest. Use for controller logic (not pass-through, see "Pass-through and propagation tests") and any service whose dependencies you can hand-roll in a few lines.
2. **`Test.createTestingModule`** — Nest's DI container with mock providers. Use when the unit under test reaches for things via DI in a way that's awkward to construct manually (lots of providers, decorators that need module wiring).
3. **`useTestService()`** — boots the real app against a real Postgres (testcontainers). Use when the value of the test depends on the real database doing real things: SQL behavior, Prisma constraints, transaction semantics, race conditions, raw queries, the global Zod response interceptor, the auth guards.

`useTestService()` is not a fallback or a heavyweight integration harness — it's a unit-testing tool for the parts of the system whose contract _is_ the database or the full request pipeline. Reach for it when mocking would force you to re-implement Postgres, Prisma, or our framework in the test, because at that point the test verifies the mocks rather than the code.

## Pattern 1: Direct instantiation

Best for small services and controllers with logic of their own. Hand-roll the deps inline.

```ts
import { describe, expect, it, vi } from 'vitest'

const mockService: Partial<CampaignsService> = {
  findMany: vi.fn().mockResolvedValue([]),
}

const controller = new CampaignsController(
  mockService as CampaignsService,
  mockAnalytics as AnalyticsService,
)

it('returns an empty list', async () => {
  const result = await controller.list()
  expect(result).toEqual([])
})
```

For services backed by `createPrismaBase`, override the internal client:

```ts
Object.defineProperty(service, '_prisma', { get: () => mockClient })
```

## Pattern 2: `Test.createTestingModule`

Reach for this when the unit pulls in enough providers that hand-rolling them gets noisy. Provide mocks for everything the constructor touches.

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

## Pattern 3: `useTestService()`

Spins up a real Postgres in Docker, runs migrations, bootstraps the full Nest app, and exposes an authed Axios client plus a Prisma client. Each test file gets its own database; every table is emptied between tests. Default authenticated user id is `123`.

```ts
import { useTestService } from '@/test-service'

const service = useTestService()

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

Use the HTTP client when the test's value lies in the request pipeline (validation, guards, interceptors, response shape):

```ts
const result = await service.client.post('/v1/campaigns', { slug: 'foo' })
expect(result.status).toBe(201)
```

Use `service.prisma` to seed the database directly — bypassing the API is fine for setup. Override providers per-test by grabbing them off the app and mocking with `vi.spyOn`:

```ts
const contacts = service.app.get(ContactsService)
vi.spyOn(contacts, 'getDistrictStats').mockResolvedValue({ ... })
```

See `src/users/services/users.service.test.ts` and `src/polls/polls.test.ts` for representative examples.

**No schedules run.** The harness boots the app with no `@Cron`, `@Interval` or `@Timeout` registered, so no job fires on a real timer mid-suite and writes rows a test is counting (ENG-11423: an hourly cron claimed a `cron_run` row during a table-wide count). Test a job by calling its method on the service, as `outreachInboundSweep.service.test.ts` does. A suite that needs the real scheduler, for example to assert what `SchedulerRegistry` holds, passes `useTestService({ scheduler: true })`; every job then fires on real timers, so scope each assertion to rows the test owns. `src/test-service.scheduler.test.ts` covers both.

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
- **A `createPrismaBase` service:** override `_prisma` (Pattern 1), never mock `prisma.util`.
- **A module-level config object:** set the field in `beforeEach` and restore it in `afterEach` (`campaignPlanQueueConfig` in `aiGeneration.service.test.ts`).
- **An env var read at import:** move the `process.env` read into the method that uses it, then `vi.stubEnv` it (`shouldEnableDomainPurchase`, `CallhubBaseConfig.apiKey`).
- **A library you want to test against:** leave it real. A `vi.mock('slugify')` made the slugify tests assert the mock.

Delete a `vi.mock` that no assertion reads. If one `describe` truly needs a module mock, move it to its own small file so the rest of the suite stays in `shared-modules` (`paymentEventsService.webhooksNotConfigured.test.ts`). An export of an externalized package (`getSignedUrl` from `@aws-sdk/s3-request-presigner`) is a real ESM namespace and cannot be spied, so that case keeps `vi.mock`.

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

- Do not write a controller unit test for a route that a route test (`service.client` against `useTestService()`) already covers, unless the controller has logic of its own: a role or ownership branch, a response mapping, an SSE loop. To pin the forwarded arguments or the response body, add that assertion to the existing route test, as `electionServiceReadRoutes.test.ts` does.
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

## Test cost

In CI, `src/test-cost-reporter.ts` fails the run when a test costs more than it should. The budget and allowlist are in `test-cost-budget.json`. Local runs are not gated; `CI=1 npx vitest run <file>` checks one.

- **One test over 10s, or one file over 30s, fails.** Make it cheaper: cross a limit with a few rows (Limits and caps above); call a CLI entry point in-process instead of spawning it; use fake timers instead of waiting. Add a `slowTests` or `slowFiles` entry only when it cannot be cheaper, with a `reason` the reviewer accepts.
- **The allowlist only shrinks.** An entry that runs under a third of its ceiling fails until you delete it, and so does one whose file or test is gone.
- **A median `useTestService()` boot over 3s fails.** Keep I/O and heavy work out of `onModuleInit` and provider constructors.
- **`freshModulesFiles` only goes down.** It counts files that call `vi.mock`, `vi.doMock`, `vi.unmock` or `vi.resetModules`. Adding one fails; use the replacements in Module mocks above. Removing one fails until you lower the number to match.

Each `Test` shard's job summary lists its per-file times and median boot.

## Running tests

```bash
npm test                                            # full suite
npx vitest run src/path/to/file.test.ts             # single file
npx vitest run --testNamePattern "case-insensitive" # by name
npm run verify                                      # lint + tsc + tests
```

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
