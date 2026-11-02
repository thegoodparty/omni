import { appendFileSync } from 'node:fs'
import { RaceListItemArraySchema } from '@goodparty_org/contracts'
import { Headers, MimeTypes } from 'http-constants-ts'
import {
  RaceTimeframe,
  resolveFixtureRace,
} from '../../../testFixtures/util/fixtureRace.util'
import { JUDGE_USER_EMAIL } from './judgeFixtureIdentity'
import { JUDGE_ORG_SLUG_PREFIX, ORG_SLUG } from './runners/background'
import { JUDGE_FIXTURE_RACE } from './sweepFixture'

// THE THREE VALUES SIX BACKGROUND CASE LISTS CANNOT CARRY, made up per sweep.
//
// None of them is a live lookup by the agent (see sweepFixture.ts): the
// organization slug is echoed into the artifact and, because the dispatch pins
// it to `judge-*`, names an organization that does not exist; `race_id` is a
// trace and idempotency identifier; `user_email` is matched only against a
// roster inside the same params. So none of them has to name anything that
// exists, and nothing here needs a credential. The three agents that DO read
// gp-api never see this slug: they run as the seeded account in
// judgeFixtureIdentity.ts instead.
//
// Resolved once per sweep, by a step before either arm, and handed to both
// through step outputs: two arms with different values would be comparing two
// inputs.

// One per sweep, from the sweep id both arms already share. The organization
// does not exist, so the slug only has to be one nothing real uses; an eval
// run writes no `latest.json` under it, so nothing carries between runs.
export const judgeOrgSlug = (sweepId: string): string => {
  const slug = `${JUDGE_ORG_SLUG_PREFIX}${sweepId.replace(/^judge-/, '')}`
  if (!ORG_SLUG.test(slug)) {
    throw new Error(
      `sweep id ${JSON.stringify(sweepId)} does not make a dispatchable ` +
        'organization slug',
    )
  }
  return slug
}

// Dev or a local gp-api only, the judge's environment at every other layer.
// The race lookup is public, so nothing is sent but the zip; the allowlist is
// about not reading a race id from somewhere nobody checked.
const ALLOWED_API =
  /^(https:\/\/gp-api-dev\.goodparty\.org|http:\/\/localhost:\d+)$/

export const requireAllowedApi = (apiUrl: string | undefined): string => {
  if (apiUrl === undefined || !ALLOWED_API.test(apiUrl)) {
    throw new Error(
      `JUDGE_FIXTURE_API_URL is ${JSON.stringify(apiUrl ?? null)}; the judge ` +
        'reads its race from the dev gp-api or a local one only',
    )
  }
  return apiUrl
}

const RACES_BY_YEAR_PATH = '/v1/elections/races-by-year'

// The BallotReady id of the race the case lists name, read from gp-api's
// public races route (`@PublicAccess()`, no credential). A real id rather than
// a constant, because the field is documented as one. Resolved the way the
// test fixtures resolve their office: the next upcoming race, else the most
// recent past one, so the office's election passing never loses the id.
export const resolveRaceId = async (
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> => {
  const search = async (timeframe: RaceTimeframe) => {
    const url = new URL(RACES_BY_YEAR_PATH, baseUrl)
    url.searchParams.set('zipcode', JUDGE_FIXTURE_RACE.zip)
    if (timeframe === 'past') {
      url.searchParams.set('timeframe', timeframe)
    }
    const response = await fetchImpl(url, {
      headers: { [Headers.ACCEPT]: MimeTypes.APPLICATION_JSON },
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) {
      throw new Error(`GET ${RACES_BY_YEAR_PATH} answered ${response.status}`)
    }
    return RaceListItemArraySchema.parse(await response.json())
  }
  const match = await resolveFixtureRace(JUDGE_FIXTURE_RACE.office, search)
  if (match === undefined) {
    throw new Error(
      `no race named "${JUDGE_FIXTURE_RACE.office}" for zip ` +
        `${JUDGE_FIXTURE_RACE.zip}, so the race_id agents have no value`,
    )
  }
  return match.id
}

// What a sweep has to hand both arms. The race id alone can be missing: the
// slug and the address are made here, but the race is read from dev data, so
// it goes missing when that lookup fails or the office is gone from it.
export interface ResolvedIdentifiers {
  orgSlug: string
  userEmail: string
  raceId?: string
  // Why there is no race id, for the run log.
  raceUnavailable?: string
}

// AT MOST THREE LINES for $GITHUB_OUTPUT, and no race_id when there is none:
// an absent output reads as unset on the arms, so only the three agents that
// need a race are refused, by name, and the rest still run. A value with a
// line break is refused: in that file it would end its own line and start an
// output of its choosing.
export const identifierOutputLines = (ids: ResolvedIdentifiers): string => {
  const values = {
    org_slug: ids.orgSlug,
    ...(ids.raceId !== undefined && { race_id: ids.raceId }),
    user_email: ids.userEmail,
  }
  for (const [key, value] of Object.entries(values)) {
    if (/[\r\n]/.test(value)) {
      throw new Error(`the judge's ${key} contains a line break`)
    }
  }
  return Object.entries(values)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('')
}

export const resolveJudgeIdentifiers = async (
  sweepId: string,
  apiUrl: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ResolvedIdentifiers> => {
  const orgSlug = judgeOrgSlug(sweepId)
  const baseUrl = requireAllowedApi(apiUrl)
  try {
    return {
      orgSlug,
      userEmail: JUDGE_USER_EMAIL,
      raceId: await resolveRaceId(baseUrl, fetchImpl),
    }
  } catch (err) {
    return {
      orgSlug,
      userEmail: JUDGE_USER_EMAIL,
      raceUnavailable: err instanceof Error ? err.message : String(err),
    }
  }
}

// gp-api is CommonJS, so `require.main` is the house pattern.
//
//   JUDGE_SWEEP_ID=... JUDGE_FIXTURE_API_URL=... judgeIdentifiers.ts <out>
//
// Appends the outputs to <out>. A race it cannot read is a warning, not a
// failure: the outputs go without race_id. Exits non-zero with one sentence
// otherwise; judge.yml decides that a failure refuses the background agents
// and not the sweep.
export const runJudgeIdentifiersEntry = async (
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  io: {
    writeStdout: (text: string) => void
    writeStderr: (text: string) => void
  },
): Promise<number> => {
  const [out] = args
  const sweepId = env.JUDGE_SWEEP_ID
  try {
    if (!out || !sweepId) {
      throw new Error(
        'usage: JUDGE_SWEEP_ID=<id> JUDGE_FIXTURE_API_URL=<url> ' +
          'judgeIdentifiers.ts <path to append outputs to>',
      )
    }
    const ids = await resolveJudgeIdentifiers(
      sweepId,
      env.JUDGE_FIXTURE_API_URL,
    )
    appendFileSync(out, identifierOutputLines(ids))
    if (ids.raceUnavailable !== undefined) {
      // stdout, because that is where Actions reads workflow commands.
      io.writeStdout(
        `::warning::no race id for this sweep (${ids.raceUnavailable}), so ` +
          'the three background agents that need one are refused by name; ' +
          'the rest run\n',
      )
    }
    io.writeStderr(
      `background agents run as ${ids.orgSlug}, race ` +
        `${ids.raceId ?? 'none'}\n`,
    )
    return 0
  } catch (err) {
    io.writeStderr(`${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}

if (require.main === module) {
  void runJudgeIdentifiersEntry(process.argv.slice(2), process.env, {
    writeStdout: (text) => process.stdout.write(text),
    writeStderr: (text) => process.stderr.write(text),
  }).then((code) => {
    if (code !== 0) process.exit(code)
  })
}
