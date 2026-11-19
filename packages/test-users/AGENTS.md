# test-users/

`@goodparty_org/test-users` — creates signed-in GoodParty test users entirely
through the API. No browser, no Playwright. Two consumers:

- `packages/gp-webapp/e2e-tests/` — the specs and the cohort scripts,
- `packages/judge/` — one fresh user per agent run, on two base URLs at once.

| File                    | What                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/config.ts`         | `resolveApiBaseUrl`, `apiUrlFor`, `requireClerkSecretKey`, `vercelBypassHeaders`                          |
| `src/clerk.ts`          | The Clerk backend client, `mintApiToken` (1h), `mintSignInTicket` (the `__clerk_ticket`)                  |
| `src/throttle.ts`       | `clerkThrottle`: the shared Clerk Backend API budget                                                      |
| `src/api.ts`            | `createApiClient`, `withGatewayRetry`                                                                     |
| `src/identifiers.ts`    | `generateTestUserData`, `uniquePhone`                                                                     |
| `src/race.ts`           | `DEFAULT_TEST_RACE`, `resolveTestRace`, `DEFAULT_ELECTION_PRESET`, `applyElectionPreset`, `TestRace`      |
| `src/createTestUser.ts` | `createTestUser({ product: 'win' \| 'serve', ... })`: the whole provisioning path                         |
| `src/serve.ts`          | Serve leads and prefilled offices: `createServeLeadUser`, `mintServeTicket`, `seedPrefilledElectedOffice` |

## Provision through the API before any browser session

The rule the e2e suite already had, and the reason this package exists in this
shape. gp-api has no user row for a freshly created Clerk identity; the first
authenticated request JIT-provisions it, and `SessionGuard` asks Clerk's Backend
API who the `clerkId` belongs to. That budget is per Clerk **instance** (100
req/10s), shared by every PR preview, every CI shard, gp-api dev's own lookups
and the test-user sweep. The moment a browser holds a Clerk session for an
unprovisioned user, the app fans out ~8 concurrent authenticated calls, each
racing to provision the same identity through that budget; Clerk answers 429,
gp-api turns the failed lookup into a bare 401, and the fan-out fails with no
retry.

So `createTestUser` creates the user, the campaign (or elected office) and the
org through the API client FIRST. A caller that needs a signed-in browser signs
it in LAST — `api-registration.ts` is the one that does. If setup fails with
`AxiosError: Request failed with status code 401` on a first authenticated
call, suspect a third concurrent consumer of the
Clerk budget before touching the throttle.

## Environment

`CLERK_SECRET_KEY` (the dev Clerk instance secret) and one of `API_BASE_URL`
(which alone covers every headless path) or `BASE_URL`. `createTestUser` also
takes an explicit `apiBaseUrl`, because the judge provisions users on two base
URLs in one process and cannot have a process-wide one.

Created users are not deleted: gp-api's hourly `sweepTestUsers` removes
`@test.goodparty.org` users older than 3 hours.

## Provenance

The e2e suite's `tests/utils/headless-user.ts` and `src/helpers/serve.helper.ts`
re-export from here under the names the specs already use, so there is one
implementation of the provisioning path rather than two.
