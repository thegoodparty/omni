import { appendFileSync } from 'node:fs'
import { Headers, MimeTypes } from 'http-constants-ts'
import { z } from 'zod'
import {
  createFixtureApi,
  deleteJudgeFixture,
  mintJudgeFixture,
  type JudgeFixture,
} from './sweepFixture'

// THE PER-SWEEP ORGANIZATION EVERY BACKGROUND DISPATCH NEEDS, minted once for
// both arms and deleted after.
//
// Every background dispatch runs against a `judge-` organization, and
// `backgroundRunInputFor` refuses one with none — so until this runs, every
// background agent is refused by name. The minting itself lives in
// sweepFixture.ts and is tested there against a stub; this is the edge that
// judge.yml calls, once before the arms and once after.
//
// Two processes, so the identifiers travel through $GITHUB_OUTPUT the way the
// mart's Delta version does: an arm that minted its own would compare two
// organizations, and every verdict would be an artifact of the fixture.

// Dev and a local gp-api only. The test-fixtures endpoint already 404s outside
// dev and preview, but the judge is dev-only at every other layer — the IAM
// policy, the dispatch Lambda, the broker — and a bearer token for a machine
// that can mint users is not something to send to an address nobody checked.
const ALLOWED_API =
  /^(https:\/\/gp-api-dev\.goodparty\.org|http:\/\/localhost:\d+)$/

const CLERK_M2M_TOKENS_URL = 'https://api.clerk.com/v1/m2m_tokens'

// Long enough for a mint at the start and a delete at the end of a sweep job,
// which is capped at three hours; each step mints its own, so this only has
// to outlast one request.
const TOKEN_SECONDS = 600

const M2MTokenSchema = z.object({ token: z.string().min(1) })

// The same exchange scripts/setup/lib/seedLogin.ts makes for local setup: the
// machine secret buys a short-lived M2M token, which gp-api verifies against
// its own machine. The secret never leaves this process.
export const mintM2MToken = async (
  machineSecret: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> => {
  const response = await fetchImpl(CLERK_M2M_TOKENS_URL, {
    method: 'POST',
    headers: {
      [Headers.AUTHORIZATION]: `Bearer ${machineSecret}`,
      [Headers.CONTENT_TYPE]: MimeTypes.APPLICATION_JSON,
    },
    body: JSON.stringify({ seconds_until_expiration: TOKEN_SECONDS }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    // The status only. Clerk's error body is not echoed: this runs in a log a
    // public repository's readers can see, and it is one hop from a secret.
    throw new Error(
      `Clerk refused to mint an M2M token: HTTP ${response.status}. Check ` +
        'that JUDGE_CLERK_MACHINE_SECRET is the judge machine’s secret and ' +
        'that the machine is granted access to gp-api’s.',
    )
  }
  return M2MTokenSchema.parse(await response.json()).token
}

// EXACTLY FOUR LINES, and none of them a credential. The fixture response
// carries the test user's password, a session token and a single-use Clerk
// sign-in ticket (src/testFixtures/AGENTS.md); $GITHUB_OUTPUT reaches every
// later step and can surface in logs, so only the identifiers an arm reads and
// the id the delete step needs ever leave this function.
export const fixtureOutputLines = (fixture: JudgeFixture): string =>
  `org_slug=${fixture.identifiers.orgSlug}\n` +
  `race_id=${fixture.identifiers.raceId}\n` +
  `user_email=${fixture.identifiers.userEmail}\n` +
  `user_id=${fixture.userId}\n`

// The id the delete step is handed back through $GITHUB_OUTPUT. A positive
// whole number or a refusal: coercion would read "" as 0 and "1e3" as a
// thousand, and a delete aimed at the wrong id reclaims someone else's fixture.
export const parseUserId = (raw: string | undefined): number => {
  if (raw === undefined || !/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(
      `the fixture user id is ${JSON.stringify(raw ?? null)}, which is not ` +
        'a positive whole number; it comes from the mint step, so the mint ' +
        'either did not run or wrote something unexpected',
    )
  }
  return Number(raw)
}

export const requireAllowedApi = (apiUrl: string | undefined): string => {
  if (apiUrl === undefined || !ALLOWED_API.test(apiUrl)) {
    throw new Error(
      `JUDGE_FIXTURE_API_URL is ${JSON.stringify(apiUrl ?? null)}; the judge ` +
        'mints fixtures against the dev gp-api or a local one only',
    )
  }
  return apiUrl
}

// gp-api is CommonJS, so `require.main` is the house pattern.
//
//   judgeFixture.ts mint <path to append outputs to>
//   judgeFixture.ts delete <user id>
//
// Both read JUDGE_CLERK_MACHINE_SECRET and JUDGE_FIXTURE_API_URL. Exits
// non-zero on any failure with one sentence and no stack; judge.yml decides
// what a failure means for the sweep.
if (require.main === module) {
  const [command, argument] = process.argv.slice(2)
  const run = async (): Promise<void> => {
    const secret = process.env.JUDGE_CLERK_MACHINE_SECRET
    if (!secret) {
      throw new Error(
        'JUDGE_CLERK_MACHINE_SECRET is not set, so no fixture can be minted',
      )
    }
    const api = createFixtureApi({
      baseUrl: requireAllowedApi(process.env.JUDGE_FIXTURE_API_URL),
      token: await mintM2MToken(secret),
    })
    if (command === 'mint' && argument) {
      const fixture = await mintJudgeFixture(api)
      appendFileSync(argument, fixtureOutputLines(fixture))
      process.stderr.write(
        `minted fixture organization ${fixture.identifiers.orgSlug}\n`,
      )
      return
    }
    if (command === 'delete' && argument) {
      await deleteJudgeFixture(api, { userId: parseUserId(argument) })
      process.stderr.write(`deleted fixture user ${argument}\n`)
      return
    }
    throw new Error('usage: judgeFixture.ts mint <out> | delete <user id>')
  }
  run().catch((err: unknown) => {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  })
}
